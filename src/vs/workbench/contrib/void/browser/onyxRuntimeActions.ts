/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { localize2 } from '../../../../nls.js';
import { MenuId, MenuRegistry, registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { VOID_VIEW_ID } from './sidebarPane.js';
import { ONYX_OPEN_RUNTIME_CONTROL_ACTION_ID, ONYX_OPEN_RUNTIME_FILES_ACTION_ID, ONYX_START_RUNTIME_ACTION_ID } from '../common/onyxRuntimeActionIds.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { VOID_OPEN_SETTINGS_ACTION_ID } from './voidSettingsPane.js';
import { ITerminalService } from '../../terminal/browser/terminal.js';
import { TerminalLocation } from '../../../../platform/terminal/common/terminal.js';
import { isWindows } from '../../../../base/common/platform.js';

const ONYX_RUNTIME_FILES = [
	'AGENTS.md',
	'HEARTBEAT.md',
	'IDENTITY.md',
	'SOUL.md',
	'TOOLS.md',
	'USER.md',
] as const;

const createStartRuntimeCommand = () => {
	if (!isWindows) {
		return 'openclaw gateway run --force --auth none --port 18789';
	}

	return [
		"$ErrorActionPreference='Stop'",
		"$minimum=[version]'22.12.0'",
		"function Get-OnyxRuntimeNodeVersion { try { [version](node -p 'process.versions.node') } catch { $null } }",
		'$current=Get-OnyxRuntimeNodeVersion',
		'if (!$current -or $current -lt $minimum) {',
		'$nvmHome=$env:NVM_HOME',
		'$candidate=$null',
		"if ($nvmHome -and (Test-Path -LiteralPath $nvmHome)) { $candidate=Get-ChildItem -LiteralPath $nvmHome -Directory -Filter 'v*' | ForEach-Object { try { [pscustomobject]@{ Version=[version]$_.Name.TrimStart('v'); Path=$_.FullName } } catch {} } | Where-Object { $_.Version -ge $minimum } | Sort-Object Version -Descending | Select-Object -First 1 }",
		"if (!$candidate) { throw 'ONYX Runtime requires Node.js 22.12+; install Node 22+ with nvm.' }",
		'$env:PATH="$($candidate.Path);$env:PATH"',
		'}',
		'openclaw gateway run --force --auth none --port 18789'
	].join('; ');
};

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ONYX_OPEN_RUNTIME_CONTROL_ACTION_ID,
			title: localize2('onyxOpenRuntimeControl', 'ONYX: Open Runtime Control'),
			f1: true,
			icon: { id: 'globe' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID) }]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		await commandService.executeCommand(VOID_OPEN_SETTINGS_ACTION_ID);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ONYX_START_RUNTIME_ACTION_ID,
			title: localize2('onyxStartRuntime', 'ONYX: Start Runtime'),
			f1: true,
			icon: { id: 'play' }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const notificationService = accessor.get(INotificationService);
		const terminalService = accessor.get(ITerminalService);

		const firstFolder = workspaceContextService.getWorkspace().folders[0];
		if (!firstFolder) {
			notificationService.warn('ONYX Runtime requires an open workspace folder.');
			return;
		}

		const terminal = await terminalService.createTerminal({
			location: TerminalLocation.Panel,
			cwd: firstFolder.uri,
			config: {
				name: 'ONYX Runtime',
				executable: isWindows ? 'powershell.exe' : undefined,
				args: isWindows ? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass'] : undefined,
				isTransient: true,
			},
			skipContributedProfileCheck: true,
		});

		terminalService.setActiveInstance(terminal);
		await terminalService.revealTerminal(terminal);
		await terminal.sendText(createStartRuntimeCommand(), true);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ONYX_OPEN_RUNTIME_FILES_ACTION_ID,
			title: localize2('onyxOpenRuntimeFiles', 'ONYX: Open Runtime Files'),
			f1: true,
			icon: { id: 'files' }
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const editorService = accessor.get(IEditorService);
		const notificationService = accessor.get(INotificationService);

		const firstFolder = workspaceContextService.getWorkspace().folders[0];
		if (!firstFolder) {
			notificationService.warn('ONYX runtime files require an open workspace folder.');
			return;
		}

		await editorService.openEditors(ONYX_RUNTIME_FILES.map((fileName) => ({
			resource: URI.joinPath(firstFolder.uri, fileName),
			options: { pinned: true }
		})));
	}
});

MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
	group: '0_command',
	command: {
		id: ONYX_OPEN_RUNTIME_CONTROL_ACTION_ID,
		title: localize2('onyxOpenRuntimeControlActivity', 'ONYX Runtime')
	},
	order: 2
});
