/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

export type OnyxCommandRisk = 'normal' | 'requiresApproval';

export function getOnyxCommandRisk(command: string): OnyxCommandRisk {
	return getOnyxCommandApprovalReason(command) ? 'requiresApproval' : 'normal';
}

export function getOnyxCommandApprovalReason(command: string): string | null {
	const normalizedCommand = command.trim().toLowerCase();
	const riskyPatterns = [
		{ pattern: /(^|[;&|]\s*)(rm|del|erase|rd|rmdir)\b/, reason: 'Destructive file deletion command.' },
		{ pattern: /(^|[;&|]\s*)(remove-item|ri)\b/, reason: 'Destructive PowerShell deletion command.' },
		{ pattern: /\bgit\s+(push|clean|reset|checkout|restore)\b/, reason: 'Git command can change history, discard work, or affect a remote.' },
		{ pattern: /\b(npm|pnpm|yarn)\s+(install|i|add|update|upgrade|remove|uninstall)\b/, reason: 'Package manager command can change dependencies or download code.' },
		{ pattern: /\b(pip|pip3|python\s+-m\s+pip|py\s+-m\s+pip)\s+install\b/, reason: 'Python package install can download and execute dependency code.' },
		{ pattern: /\b(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)\b/, reason: 'Network command can download or send data.' },
		{ pattern: /\b(choco|scoop|winget|brew|apt|apt-get|dnf|yum|pacman)\b/, reason: 'System package manager command can modify the machine.' },
		{ pattern: /\b(docker|podman|kubectl|sudo|su)\b/, reason: 'Privileged/container/orchestration command can affect resources outside the workspace.' },
		{ pattern: /(^|[;&|]\s*)(set-executionpolicy|stop-process|taskkill|shutdown|restart-computer|format-volume|clear-disk|remove-partition|reg|reg\.exe|icacls|takeown)\b/, reason: 'System-level command can affect processes, disks, permissions, or machine policy.' },
		{ pattern: /(^|[;&|]\s*)(new-item|ni|set-content|add-content|out-file|tee-object|copy-item|cp|move-item|mv|rename-item|ren)\b/, reason: 'Shell file-writing command requires review; prefer ONYX file tools for edits.' },
		{ pattern: /(^|[;&|]\s*)powershell\b.*\b(encodedcommand|executionpolicy)\b/, reason: 'PowerShell execution-policy or encoded-command usage requires review.' },
	];

	return riskyPatterns.find(({ pattern }) => pattern.test(normalizedCommand))?.reason ?? null;
}

const commandPathTokenPatterns = [
	/\bfile:\/\/[^\s"'`<>|;&)]+/gi,
	/(^|[\s"'`=({\[])([A-Za-z]:[\\/][^\s"'`<>|;&)]*)/g,
	/(^|[\s"'`=({\[])(\\\\[^\\/\s"'`<>|;&)]+[\\/][^\s"'`<>|;&)]*)/g,
	/(^|[\s"'`=({\[])(\/(?!\/)(?=[^\s"'`<>|;&)]*[\\/])[^\s"'`<>|;&)]*)/g,
	/(^|[\s"'`=({\[])(\.{2}(?:[\\/]|$)[^\s"'`<>|;&)]*)/g,
];

const cwdChangePattern = /(?:^|[;&|]\s*)(?:cd|chdir|pushd|sl|set-location)\s+(?:(?:-LiteralPath|-Path)\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/gi;

export const sanitizeOnyxCommandPathToken = (raw: string) => {
	return raw.trim().replace(/[,]+$/g, '');
};

const isDynamicShellPath = (value: string) => {
	return /[$%*?`]/.test(value) || value.includes('$(');
};

export interface OnyxCommandPathValidationHost<TResolvedPath> {
	resolvePathToken(token: string, opts: { forceRelative: boolean }): TResolvedPath | null;
	assertInsideWorkspace(path: TResolvedPath, operation: string): void;
}

const normalizeCommandPathToken = (raw: string) => {
	const token = sanitizeOnyxCommandPathToken(raw);
	if (!token || token === '-' || token === '~') {
		return null;
	}
	if (isDynamicShellPath(token)) {
		throw new Error(`ONYX cannot validate dynamic terminal path "${token}". Use an explicit workspace-relative path instead.`);
	}
	return token;
};

export function validateOnyxCommandPathReferences<TResolvedPath>(command: string, host: OnyxCommandPathValidationHost<TResolvedPath>): void {
	for (const match of command.matchAll(cwdChangePattern)) {
		const target = match[1] ?? match[2] ?? match[3];
		const token = normalizeCommandPathToken(target);
		if (!token) {
			continue;
		}

		const targetPath = host.resolvePathToken(token, { forceRelative: true });
		if (targetPath) {
			host.assertInsideWorkspace(targetPath, 'run terminal commands from');
		}
	}

	const seen = new Set<string>();
	for (const pattern of commandPathTokenPatterns) {
		pattern.lastIndex = 0;
		for (const match of command.matchAll(pattern)) {
			const token = normalizeCommandPathToken(match[2] ?? match[0]);
			if (!token || seen.has(token)) {
				continue;
			}
			seen.add(token);

			const candidatePath = host.resolvePathToken(token, { forceRelative: false });
			if (candidatePath) {
				host.assertInsideWorkspace(candidatePath, 'run terminal commands against');
			}
		}
	}
}
