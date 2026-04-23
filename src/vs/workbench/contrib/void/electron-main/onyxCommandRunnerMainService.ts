/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ChildProcessWithoutNullStreams, spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { validateOnyxCommandPathReferences } from '../common/onyxCommandPolicy.js';
import { IOnyxCommandRunnerService, OnyxRunCommandParams, OnyxRunCommandResult } from '../common/onyxCommandRunnerServiceTypes.js';

const normalizeForCompare = (fsPath: string) => {
	const resolved = path.resolve(fsPath);
	return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};

const isEqualOrInside = (candidate: string, root: string) => {
	const normalizedCandidate = normalizeForCompare(candidate);
	const normalizedRoot = normalizeForCompare(root);
	const relative = path.relative(normalizedRoot, normalizedCandidate);
	return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
};

const isAbsoluteShellPath = (value: string) => {
	return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\/]+[\\/]/.test(value);
};

const commandPathTokenToPath = (raw: string, cwd: string, forceRelative = false) => {
	if (raw.toLowerCase().startsWith('file://')) {
		return fileURLToPath(raw);
	}
	if (raw.includes('://')) {
		return null;
	}
	if (!forceRelative && isAbsoluteShellPath(raw)) {
		return path.resolve(raw);
	}
	return path.resolve(cwd, raw);
};

const assertInsideWorkspace = (candidate: string, workspaceFolders: readonly string[], operation: string) => {
	if (!workspaceFolders.some(folder => isEqualOrInside(candidate, folder))) {
		throw new Error(`ONYX command runner can only ${operation} paths inside the current workspace. Refusing: ${candidate}.`);
	}
};

const validateCommandReferences = (command: string, cwd: string, workspaceFolders: readonly string[]) => {
	validateOnyxCommandPathReferences(command, {
		resolvePathToken: (token, { forceRelative }) => commandPathTokenToPath(token, cwd, forceRelative),
		assertInsideWorkspace: (candidate, operation) => assertInsideWorkspace(candidate, workspaceFolders, operation),
	});
};

const truncateOutput = (output: string, maxOutputChars: number) => {
	if (output.length <= maxOutputChars) {
		return output;
	}
	const half = Math.floor(maxOutputChars / 2);
	return `${output.slice(0, half)}\n...\n${output.slice(output.length - half)}`;
};

const killProcessTree = (child: ChildProcessWithoutNullStreams) => {
	if (!child.pid) {
		child.kill();
		return;
	}
	if (process.platform === 'win32') {
		const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
			windowsHide: true,
			stdio: 'ignore',
		});
		killer.unref();
		return;
	}
	child.kill();
};

export class OnyxCommandRunnerMainService implements IOnyxCommandRunnerService {
	readonly _serviceBrand: undefined;
	private readonly runningProcesses = new Map<string, ChildProcessWithoutNullStreams>();

	async runCommand(params: OnyxRunCommandParams): Promise<OnyxRunCommandResult> {
		this.validateParams(params);

		return new Promise<OnyxRunCommandResult>((resolve, reject) => {
			let output = '';
			let settled = false;
			let timedOut = false;
			let inactivityTimer: ReturnType<typeof setTimeout> | undefined;

			const finish = (result: OnyxRunCommandResult) => {
				if (settled) {
					return;
				}
				settled = true;
				if (inactivityTimer) {
					clearTimeout(inactivityTimer);
				}
				this.runningProcesses.delete(params.requestId);
				resolve({ ...result, output: truncateOutput(result.output, params.maxOutputChars) });
			};

			const resetTimer = () => {
				if (inactivityTimer) {
					clearTimeout(inactivityTimer);
				}
				inactivityTimer = setTimeout(() => {
					timedOut = true;
					const child = this.runningProcesses.get(params.requestId);
					if (child) {
						killProcessTree(child);
					}
					finish({ output, exitCode: -1, timedOut: true });
				}, params.timeoutMs);
			};

			const child = spawn(params.command, {
				cwd: params.cwd,
				env: process.env,
				shell: true,
				windowsHide: true,
			});

			this.runningProcesses.set(params.requestId, child);
			resetTimer();

			child.stdout.on('data', chunk => {
				output += chunk.toString();
				resetTimer();
			});

			child.stderr.on('data', chunk => {
				output += chunk.toString();
				resetTimer();
			});

			child.on('error', error => {
				if (settled) {
					return;
				}
				if (inactivityTimer) {
					clearTimeout(inactivityTimer);
				}
				this.runningProcesses.delete(params.requestId);
				reject(error);
			});

			child.on('close', code => {
				if (timedOut) {
					return;
				}
				finish({ output, exitCode: code ?? -1, timedOut: false });
			});
		});
	}

	async abortCommand(requestId: string): Promise<void> {
		const child = this.runningProcesses.get(requestId);
		if (!child) {
			return;
		}
		killProcessTree(child);
		this.runningProcesses.delete(requestId);
	}

	private validateParams(params: OnyxRunCommandParams): void {
		if (!params.requestId || !params.command || !params.cwd) {
			throw new Error('ONYX command runner requires requestId, command, and cwd.');
		}
		if (!params.workspaceFolders.length) {
			throw new Error('ONYX command runner requires at least one workspace folder.');
		}
		if (!params.workspaceFolders.some(folder => isEqualOrInside(params.cwd, folder))) {
			throw new Error(`ONYX command runner refused cwd outside the workspace: ${params.cwd}`);
		}
		validateCommandReferences(params.command, params.cwd, params.workspaceFolders);
	}
}
