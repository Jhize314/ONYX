/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { IOnyxCodexStatusService, OnyxCodexCredits, OnyxCodexRateLimitsResult, OnyxCodexRateLimitWindow } from '../common/onyxCodexStatusServiceTypes.js';

type RawRateLimitWindow = {
	used_percent?: unknown;
	window_minutes?: unknown;
	resets_at?: unknown;
	reset_at?: unknown;
};

type RawCredits = {
	has_credits?: unknown;
	unlimited?: unknown;
	balance?: unknown;
};

type RawRateLimits = {
	primary?: RawRateLimitWindow;
	secondary?: RawRateLimitWindow;
	credits?: RawCredits;
};

const MAX_FILES_TO_SCAN = 80;
const MAX_TAIL_BYTES = 4 * 1024 * 1024;

const toNumber = (value: unknown): number | null => {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
};

const normalizeWindow = (value: RawRateLimitWindow | undefined): OnyxCodexRateLimitWindow | null => {
	if (!value) {
		return null;
	}
	const usedPercent = toNumber(value.used_percent);
	const windowMinutes = toNumber(value.window_minutes);
	const resetsAt = toNumber(value.resets_at) ?? toNumber(value.reset_at);
	if (usedPercent === null || windowMinutes === null) {
		return null;
	}
	return {
		usedPercent,
		windowMinutes,
		resetsAt,
	};
};

const normalizeCredits = (value: RawCredits | undefined): OnyxCodexCredits | null => {
	if (!value) {
		return null;
	}
	return {
		hasCredits: value.has_credits === true,
		unlimited: value.unlimited === true,
		balance: typeof value.balance === 'string' ? value.balance : null,
	};
};

const isJsonlFile = (name: string) => name.toLowerCase().endsWith('.jsonl');

const collectJsonlFiles = async (dir: string, depth = 0): Promise<{ path: string; mtimeMs: number }[]> => {
	if (depth > 4) {
		return [];
	}
	let entries: import('fs').Dirent[];
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}

	const files: { path: string; mtimeMs: number }[] = [];
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await collectJsonlFiles(fullPath, depth + 1));
		} else if (entry.isFile() && isJsonlFile(entry.name)) {
			try {
				const stat = await fs.stat(fullPath);
				files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
			} catch {
				// Ignore files that rotate while we are scanning.
			}
		}
	}
	return files;
};

const readFileTail = async (filePath: string) => {
	const handle = await fs.open(filePath, 'r');
	try {
		const stat = await handle.stat();
		const length = Math.min(stat.size, MAX_TAIL_BYTES);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, stat.size - length);
		return buffer.toString('utf8');
	} finally {
		await handle.close();
	}
};

const readRateLimitsFromLine = (line: string): { rateLimits: RawRateLimits; capturedAt: number | null } | null => {
	let parsed: any;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	return readRateLimitsFromObject(parsed);
};

const readRateLimitsFromObject = (parsed: any): { rateLimits: RawRateLimits; capturedAt: number | null } | null => {
	const rateLimits = parsed?.payload?.rate_limits ?? parsed?.rate_limits;
	if (!rateLimits || typeof rateLimits !== 'object') {
		return null;
	}
	const timestamp = typeof parsed?.timestamp === 'string' ? Date.parse(parsed.timestamp) : NaN;
	return {
		rateLimits,
		capturedAt: Number.isFinite(timestamp) ? timestamp : null,
	};
};

const extractJsonObjectAt = (text: string, startIndex: number): string | null => {
	if (text[startIndex] !== '{') {
		return null;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = startIndex; i < text.length; i++) {
		const char = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === '\\') {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
		} else if (char === '{') {
			depth += 1;
		} else if (char === '}') {
			depth -= 1;
			if (depth === 0) {
				return text.slice(startIndex, i + 1);
			}
		}
	}
	return null;
};

const findLatestCodexRateLimitsJson = (text: string): any | null => {
	const marker = '"type":"codex.rate_limits"';
	let markerIndex = text.lastIndexOf(marker);
	while (markerIndex !== -1) {
		const startIndex = text.lastIndexOf('{', markerIndex);
		if (startIndex !== -1) {
			const json = extractJsonObjectAt(text, startIndex);
			if (json) {
				try {
					const parsed = JSON.parse(json);
					if (parsed?.type === 'codex.rate_limits') {
						return parsed;
					}
				} catch {
					// Keep looking; SQLite pages may contain partial historical text.
				}
			}
		}
		markerIndex = text.lastIndexOf(marker, markerIndex - 1);
	}
	return null;
};

const findLatestRateLimitsInCodexLog = async (filePath: string) => {
	let stat: import('fs').Stats;
	try {
		stat = await fs.stat(filePath);
	} catch {
		return null;
	}
	const text = await readFileTail(filePath);
	const parsed = findLatestCodexRateLimitsJson(text);
	const latest = readRateLimitsFromObject(parsed);
	return latest ? { ...latest, capturedAt: stat.mtimeMs } : null;
};

const findLatestRateLimitsInFile = async (filePath: string) => {
	const text = await readFileTail(filePath);
	const lines = text.split(/\r?\n/);
	for (let i = lines.length - 1; i >= 0; i--) {
		const match = readRateLimitsFromLine(lines[i]);
		if (match) {
			return match;
		}
	}
	return null;
};

export class OnyxCodexStatusMainService implements IOnyxCodexStatusService {
	readonly _serviceBrand: undefined;

	async getRateLimits(): Promise<OnyxCodexRateLimitsResult> {
		const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
		const codexLog = path.join(codexHome, 'logs_2.sqlite');
		try {
			const latest = await findLatestRateLimitsInCodexLog(codexLog);
			if (latest) {
				return {
					status: 'available',
					capturedAt: latest.capturedAt,
					primary: normalizeWindow(latest.rateLimits.primary),
					secondary: normalizeWindow(latest.rateLimits.secondary),
					credits: normalizeCredits(latest.rateLimits.credits),
				};
			}
		} catch {
			// Fall back to JSONL logs below.
		}

		const candidateDirs = [
			path.join(codexHome, 'sessions'),
			path.join(codexHome, 'archived_sessions'),
		];

		const files = (await Promise.all(candidateDirs.map(dir => collectJsonlFiles(dir))))
			.flat()
			.sort((a, b) => b.mtimeMs - a.mtimeMs)
			.slice(0, MAX_FILES_TO_SCAN);

		if (!files.length) {
			return { status: 'unavailable', detail: 'No Codex session logs found.' };
		}

		for (const file of files) {
			try {
				const latest = await findLatestRateLimitsInFile(file.path);
				if (!latest) {
					continue;
				}
				return {
					status: 'available',
					capturedAt: latest.capturedAt,
					primary: normalizeWindow(latest.rateLimits.primary),
					secondary: normalizeWindow(latest.rateLimits.secondary),
					credits: normalizeCredits(latest.rateLimits.credits),
				};
			} catch {
				// Continue scanning older logs if the newest file rotates mid-read.
			}
		}

		return { status: 'unavailable', detail: 'Codex has not recorded rate-limit data yet.' };
	}
}
