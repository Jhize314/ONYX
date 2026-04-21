/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';

import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';

import { ICodeEditorService } from '../../../../editor/browser/services/codeEditorService.js';
import { IRange } from '../../../../editor/common/core/range.js';
import { VOID_VIEW_CONTAINER_ID, VOID_VIEW_ID } from './sidebarPane.js';
import { IMetricsService } from '../common/metricsService.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { VOID_TOGGLE_SETTINGS_ACTION_ID } from './voidSettingsPane.js';
import { ONYX_CREATE_PLAN_WORKSPACE_ACTION_ID, VOID_CTRL_L_ACTION_ID } from './actionIDs.js';
import { localize2 } from '../../../../nls.js';
import { IChatThreadService } from './chatThreadService.js';
import { IViewsService } from '../../../services/views/common/viewsService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { OnyxPlanWorkspaceService } from '../../../../../onyx/plans/onyxPlanWorkspaceService.js';

// ---------- Register commands and keybindings ----------

export const roundRangeToLines = (range: IRange | null | undefined, options: { emptySelectionBehavior: 'null' | 'line' }) => {
	if (!range) {
		return null;
	}

	if (range.endColumn === range.startColumn && range.endLineNumber === range.startLineNumber) {
		if (options.emptySelectionBehavior === 'null') {
			return null;
		} else if (options.emptySelectionBehavior === 'line') {
			return {
				startLineNumber: range.startLineNumber,
				startColumn: 1,
				endLineNumber: range.startLineNumber,
				endColumn: 1
			};
		}
	}

	const endLine = range.endColumn === 1 ? range.endLineNumber - 1 : range.endLineNumber;
	const newRange: IRange = {
		startLineNumber: range.startLineNumber,
		startColumn: 1,
		endLineNumber: endLine,
		endColumn: Number.MAX_SAFE_INTEGER
	};
	return newRange;
};

const VOID_OPEN_SIDEBAR_ACTION_ID = 'void.sidebar.open';
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_OPEN_SIDEBAR_ACTION_ID,
			title: localize2('voidOpenSidebar', 'Void: Open Sidebar'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		const chatThreadsService = accessor.get(IChatThreadService);
		viewsService.openViewContainer(VOID_VIEW_CONTAINER_ID);
		await chatThreadsService.focusCurrentChat();
	}
});

// cmd/ctrl + L
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_CTRL_L_ACTION_ID,
			f1: true,
			title: localize2('voidCmdL', 'Void: Add Selection to Chat'),
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyL,
				weight: KeybindingWeight.VoidExtension
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		const viewsService = accessor.get(IViewsService);
		const metricsService = accessor.get(IMetricsService);
		const editorService = accessor.get(ICodeEditorService);
		const chatThreadService = accessor.get(IChatThreadService);

		metricsService.capture('Ctrl+L', {});

		const editor = editorService.getActiveCodeEditor();
		const model = editor?.getModel();
		if (!model) {
			return;
		}

		const selectionRange = roundRangeToLines(editor?.getSelection(), { emptySelectionBehavior: 'null' });

		const wasAlreadyOpen = viewsService.isViewContainerVisible(VOID_VIEW_CONTAINER_ID);
		if (!wasAlreadyOpen) {
			await commandService.executeCommand(VOID_OPEN_SIDEBAR_ACTION_ID);
		}

		if (selectionRange) {
			editor?.setSelection({
				startLineNumber: selectionRange.startLineNumber,
				endLineNumber: selectionRange.endLineNumber,
				startColumn: 1,
				endColumn: Number.MAX_SAFE_INTEGER
			});
			chatThreadService.addNewStagingSelection({
				type: 'CodeSelection',
				uri: model.uri,
				language: model.getLanguageId(),
				range: [selectionRange.startLineNumber, selectionRange.endLineNumber],
				state: { wasAddedAsCurrentFile: false }
			});
		} else {
			chatThreadService.addNewStagingSelection({
				type: 'File',
				uri: model.uri,
				language: model.getLanguageId(),
				state: { wasAddedAsCurrentFile: false }
			});
		}

		await chatThreadService.focusCurrentChat();
	}
});

// New chat keybind + menu button
const VOID_CMD_SHIFT_L_ACTION_ID = 'void.cmdShiftL';
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: VOID_CMD_SHIFT_L_ACTION_ID,
			title: 'New Chat',
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyL,
				weight: KeybindingWeight.VoidExtension
			},
			icon: { id: 'add' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID) }]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const metricsService = accessor.get(IMetricsService);
		const chatThreadsService = accessor.get(IChatThreadService);
		const editorService = accessor.get(ICodeEditorService);

		metricsService.capture('Chat Navigation', { type: 'Start New Chat' });

		const oldThreadId = chatThreadsService.state.currentThreadId;
		const oldThread = chatThreadsService.state.allThreads[oldThreadId];

		const oldUI = await oldThread?.state.mountedInfo?.whenMounted;
		const oldSelns = oldThread?.state.stagingSelections;
		const oldVal = oldUI?.textAreaRef?.current?.value;

		chatThreadsService.openNewThread();
		await chatThreadsService.focusCurrentChat();

		const newThreadId = chatThreadsService.state.currentThreadId;
		const newThread = chatThreadsService.state.allThreads[newThreadId];

		const newUI = await newThread?.state.mountedInfo?.whenMounted;
		chatThreadsService.setCurrentThreadState({ stagingSelections: oldSelns });
		if (newUI?.textAreaRef?.current && oldVal) {
			newUI.textAreaRef.current.value = oldVal;
		}

		const editor = editorService.getActiveCodeEditor();
		const model = editor?.getModel();
		if (!model) {
			return;
		}

		const selectionRange = roundRangeToLines(editor?.getSelection(), { emptySelectionBehavior: 'null' });
		if (!selectionRange) {
			return;
		}

		editor?.setSelection({
			startLineNumber: selectionRange.startLineNumber,
			endLineNumber: selectionRange.endLineNumber,
			startColumn: 1,
			endColumn: Number.MAX_SAFE_INTEGER
		});
		chatThreadsService.addNewStagingSelection({
			type: 'CodeSelection',
			uri: model.uri,
			language: model.getLanguageId(),
			range: [selectionRange.startLineNumber, selectionRange.endLineNumber],
			state: { wasAddedAsCurrentFile: false }
		});
	}
});

// History menu button
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.historyAction',
			title: 'View Past Chats',
			icon: { id: 'history' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID) }]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const thread = accessor.get(IChatThreadService).getCurrentThread();
		if (thread.messages.length === 0) {
			return;
		}

		const metricsService = accessor.get(IMetricsService);
		const commandService = accessor.get(ICommandService);

		metricsService.capture('Chat Navigation', { type: 'History' });
		commandService.executeCommand(VOID_CMD_SHIFT_L_ACTION_ID);
	}
});

// Settings gear
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'void.settingsAction',
			title: 'ONYX Settings',
			icon: { id: 'settings-gear' },
			menu: [{ id: MenuId.ViewTitle, group: 'navigation', when: ContextKeyExpr.equals('view', VOID_VIEW_ID) }]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand(VOID_TOGGLE_SETTINGS_ACTION_ID);
	}
});

// ONYX Plan Workspace command
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: ONYX_CREATE_PLAN_WORKSPACE_ACTION_ID,
			title: localize2('onyxCreatePlanWorkspace', 'ONYX: Create Plan Workspace'),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		console.log('[ONYX] Create Plan Workspace triggered');

		const fileService = accessor.get(IFileService);
		const editorService = accessor.get(IEditorService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);

		const workspace = workspaceContextService.getWorkspace();
		const firstFolder = workspace.folders[0];

		if (!firstFolder) {
			alert('ONYX Plan Workspace requires an open folder or workspace.');
			return;
		}

		const planWorkspaceService = new OnyxPlanWorkspaceService(
			fileService,
			editorService
		);

		const fileUri = await planWorkspaceService.createInitialPlan(
			firstFolder.uri.fsPath,
			'create a general ONYX plan workspace'
		);

		console.log('[ONYX] Plan Workspace created at:', fileUri.toString());
	}
});