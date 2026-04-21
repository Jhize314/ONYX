/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';

import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { ILLMMessageService } from '../common/sendLLMMessageService.js';
import { chat_userMessageContent, isABuiltinToolName } from '../common/prompt/prompts.js';
import { AnthropicReasoning, getErrorMessage, RawToolCallObj, RawToolParamsObj } from '../common/sendLLMMessageTypes.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { FeatureName, ModelSelection, ModelSelectionOptions } from '../common/voidSettingsTypes.js';
import { IVoidSettingsService } from '../common/voidSettingsService.js';
import { approvalTypeOfBuiltinToolName, BuiltinToolCallParams, ToolCallParams, ToolName, ToolResult } from '../common/toolsServiceTypes.js';
import { IToolsService } from './toolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ChatMessage, CheckpointEntry, CodespanLocationLink, StagingSelectionItem, ToolMessage } from '../common/chatThreadServiceTypes.js';
import { Position } from '../../../../editor/common/core/position.js';
import { IMetricsService } from '../common/metricsService.js';
import { shorten } from '../../../../base/common/labels.js';
import { IVoidModelService } from '../common/voidModelService.js';
import { findLast, findLastIdx } from '../../../../base/common/arraysFind.js';
import { IEditCodeService } from './editCodeServiceInterface.js';
import { VoidFileSnapshot } from '../common/editCodeServiceTypes.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { truncate } from '../../../../base/common/strings.js';
import { THREAD_STORAGE_KEY } from '../common/storageKeys.js';
import { IConvertToLLMMessageService } from './convertToLLMMessageService.js';
import { timeout } from '../../../../base/common/async.js';
import { deepClone } from '../../../../base/common/objects.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IDirectoryStrService } from '../common/directoryStrService.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IMCPService } from '../common/mcpService.js';
import { RawMCPToolCall } from '../common/mcpServiceTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { OnyxPlanWorkspaceService } from '../../../../../onyx/plans/onyxPlanWorkspaceService.js';
import { shouldCreatePlanWorkspaceFromPrompt, shouldOpenExistingPlanFromPrompt } from '../../../../../onyx/plans/onyxPlanIntent.js';

// related to retrying when LLM message has error
const CHAT_RETRIES = 3;
const RETRY_DELAY = 2500;

const findStagingSelectionIndex = (currentSelections: StagingSelectionItem[] | undefined, newSelection: StagingSelectionItem): number | null => {
	if (!currentSelections) return null;

	for (let i = 0; i < currentSelections.length; i += 1) {
		const s = currentSelections[i];

		if (s.uri.fsPath !== newSelection.uri.fsPath) continue;

		if (s.type === 'File' && newSelection.type === 'File') {
			return i;
		}
		if (s.type === 'CodeSelection' && newSelection.type === 'CodeSelection') {
			if (s.uri.fsPath !== newSelection.uri.fsPath) continue;
			const [oldStart, oldEnd] = s.range;
			const [newStart, newEnd] = newSelection.range;
			if (oldStart !== newStart || oldEnd !== newEnd) continue;
			return i;
		}
		if (s.type === 'Folder' && newSelection.type === 'Folder') {
			return i;
		}
	}
	return null;
};

/*

Store a checkpoint of all "before" files on each x.
x's show up before user messages and LLM edit tool calls.

x     A          (edited A -> A')
(... user modified changes ...)
User message

x     A' B C     (edited A'->A'', B->B', C->C')
LLM Edit
x
LLM Edit
x
LLM Edit


INVARIANT:
A checkpoint appears before every LLM message, and before every user message (before user really means directly after LLM is done).
*/

type UserMessageType = ChatMessage & { role: 'user' };
type UserMessageState = UserMessageType['state'];
const defaultMessageState: UserMessageState = {
	stagingSelections: [],
	isBeingEdited: false,
};

// a 'thread' means a chat message history

type WhenMounted = {
	textAreaRef: { current: HTMLTextAreaElement | null };
	scrollToBottom: () => void;
};

export type ThreadType = {
	id: string;
	createdAt: string;
	lastModified: string;

	messages: ChatMessage[];
	filesWithUserChanges: Set<string>;

	state: {
		currCheckpointIdx: number | null;
		stagingSelections: StagingSelectionItem[];
		focusedMessageIdx: number | undefined;
		linksOfMessageIdx: {
			[messageIdx: number]: {
				[codespanName: string]: CodespanLocationLink
			}
		};

		mountedInfo?: {
			whenMounted: Promise<WhenMounted>;
			_whenMountedResolver: (res: WhenMounted) => void;
			mountedIsResolvedRef: { current: boolean };
		};
	};
};

type ChatThreads = {
	[id: string]: undefined | ThreadType;
};

export type ThreadsState = {
	allThreads: ChatThreads;
	currentThreadId: string;
};

export type IsRunningType =
	| 'LLM'
	| 'tool'
	| 'awaiting_user'
	| 'idle'
	| undefined;

export type ThreadStreamState = {
	[threadId: string]: undefined | {
		isRunning: undefined;
		error?: { message: string, fullError: Error | null };
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'LLM';
		error?: undefined;
		llmInfo: {
			displayContentSoFar: string;
			reasoningSoFar: string;
			toolCallSoFar: RawToolCallObj | null;
		};
		toolInfo?: undefined;
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'tool';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo: {
			toolName: ToolName;
			toolParams: ToolCallParams<ToolName>;
			id: string;
			content: string;
			rawParams: RawToolParamsObj;
			mcpServerName: string | undefined;
		};
		interrupt: Promise<() => void>;
	} | {
		isRunning: 'awaiting_user';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt?: undefined;
	} | {
		isRunning: 'idle';
		error?: undefined;
		llmInfo?: undefined;
		toolInfo?: undefined;
		interrupt: 'not_needed' | Promise<() => void>;
	}
};

const newThreadObject = () => {
	const now = new Date().toISOString();
	return {
		id: generateUuid(),
		createdAt: now,
		lastModified: now,
		messages: [],
		state: {
			currCheckpointIdx: null,
			stagingSelections: [],
			focusedMessageIdx: undefined,
			linksOfMessageIdx: {},
		},
		filesWithUserChanges: new Set()
	} satisfies ThreadType;
};

export interface IChatThreadService {
	readonly _serviceBrand: undefined;

	readonly state: ThreadsState;
	readonly streamState: ThreadStreamState;

	onDidChangeCurrentThread: Event<void>;
	onDidChangeStreamState: Event<{ threadId: string }>;

	getCurrentThread(): ThreadType;
	openNewThread(): void;
	switchToThread(threadId: string): void;

	deleteThread(threadId: string): void;
	duplicateThread(threadId: string): void;

	getCurrentMessageState: (messageIdx: number) => UserMessageState;
	setCurrentMessageState: (messageIdx: number, newState: Partial<UserMessageState>) => void;
	getCurrentThreadState: () => ThreadType['state'];
	setCurrentThreadState: (newState: Partial<ThreadType['state']>) => void;

	getCurrentFocusedMessageIdx(): number | undefined;
	isCurrentlyFocusingMessage(): boolean;
	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined): void;

	popStagingSelections(numPops?: number): void;
	addNewStagingSelection(newSelection: StagingSelectionItem): void;

	dangerousSetState: (newState: ThreadsState) => void;
	resetState: () => void;

	getCodespanLink(opts: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined;
	addCodespanLink(opts: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }): void;
	generateCodespanLink(opts: { codespanStr: string, threadId: string }): Promise<CodespanLocationLink>;
	getRelativeStr(uri: URI): string | undefined;

	abortRunning(threadId: string): Promise<void>;
	dismissStreamError(threadId: string): void;

	editUserMessageAndStreamResponse({ userMessage, messageIdx, threadId }: { userMessage: string, messageIdx: number, threadId: string }): Promise<void>;
	addUserMessageAndStreamResponse({ userMessage, threadId }: { userMessage: string, threadId: string }): Promise<void>;

	approveLatestToolRequest(threadId: string): void;
	rejectLatestToolRequest(threadId: string): void;

	jumpToCheckpointBeforeMessageIdx(opts: { threadId: string, messageIdx: number, jumpToUserModified: boolean }): void;

	focusCurrentChat: () => Promise<void>;
	blurCurrentChat: () => Promise<void>;
}

export const IChatThreadService = createDecorator<IChatThreadService>('voidChatThreadService');

class ChatThreadService extends Disposable implements IChatThreadService {
	_serviceBrand: undefined;

	private readonly _onDidChangeCurrentThread = new Emitter<void>();
	readonly onDidChangeCurrentThread: Event<void> = this._onDidChangeCurrentThread.event;

	private readonly _onDidChangeStreamState = new Emitter<{ threadId: string }>();
	readonly onDidChangeStreamState: Event<{ threadId: string }> = this._onDidChangeStreamState.event;

	readonly streamState: ThreadStreamState = {};
	state: ThreadsState;

	constructor(
		@IStorageService private readonly _storageService: IStorageService,
		@IVoidModelService private readonly _voidModelService: IVoidModelService,
		@ILLMMessageService private readonly _llmMessageService: ILLMMessageService,
		@IToolsService private readonly _toolsService: IToolsService,
		@IVoidSettingsService private readonly _settingsService: IVoidSettingsService,
		@ILanguageFeaturesService private readonly _languageFeaturesService: ILanguageFeaturesService,
		@IEditorService private readonly _editorService: IEditorService,
		@IMetricsService private readonly _metricsService: IMetricsService,
		@IEditCodeService private readonly _editCodeService: IEditCodeService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IConvertToLLMMessageService private readonly _convertToLLMMessagesService: IConvertToLLMMessageService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IDirectoryStrService private readonly _directoryStringService: IDirectoryStrService,
		@IFileService private readonly _fileService: IFileService,
		@IMCPService private readonly _mcpService: IMCPService,
	) {
		super();
		this.state = { allThreads: {}, currentThreadId: null as unknown as string };

		const readThreads = this._readAllThreads() || {};
		this.state = {
			allThreads: readThreads,
			currentThreadId: null as unknown as string,
		};

		this.openNewThread();
	}

	async focusCurrentChat() {
		const threadId = this.state.currentThreadId;
		const thread = this.state.allThreads[threadId];
		if (!thread) return;
		const s = await thread.state.mountedInfo?.whenMounted;
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.focus();
		}
	}

	async blurCurrentChat() {
		const threadId = this.state.currentThreadId;
		const thread = this.state.allThreads[threadId];
		if (!thread) return;
		const s = await thread.state.mountedInfo?.whenMounted;
		if (!this.isCurrentlyFocusingMessage()) {
			s?.textAreaRef.current?.blur();
		}
	}

	dangerousSetState = (newState: ThreadsState) => {
		this.state = newState;
		this._onDidChangeCurrentThread.fire();
	};

	resetState = () => {
		this.state = { allThreads: {}, currentThreadId: null as unknown as string };
		this.openNewThread();
		this._onDidChangeCurrentThread.fire();
	};

	private _convertThreadDataFromStorage(threadsStr: string): ChatThreads {
		return JSON.parse(threadsStr, (key, value) => {
			if (value && typeof value === 'object' && value.$mid === 1) {
				return URI.from(value);
			}
			return value;
		});
	}

	private _readAllThreads(): ChatThreads | null {
		const threadsStr = this._storageService.get(THREAD_STORAGE_KEY, StorageScope.APPLICATION);
		if (!threadsStr) {
			return null;
		}
		return this._convertThreadDataFromStorage(threadsStr);
	}

	private _storeAllThreads(threads: ChatThreads) {
		const serializedThreads = JSON.stringify(threads);
		this._storageService.store(
			THREAD_STORAGE_KEY,
			serializedThreads,
			StorageScope.APPLICATION,
			StorageTarget.USER
		);
	}

	private _setState(state: Partial<ThreadsState>, doNotRefreshMountInfo?: boolean) {
		const newState = {
			...this.state,
			...state
		};

		this.state = newState;
		this._onDidChangeCurrentThread.fire();

		const threadId = newState.currentThreadId;
		const streamState = this.streamState[threadId];
		if (streamState?.isRunning === undefined && !streamState?.error) {
			const messages = newState.allThreads[threadId]?.messages;
			const lastMessage = messages && messages[messages.length - 1];

			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'tool_request') {
				this._setStreamState(threadId, { isRunning: 'awaiting_user' });
			}

			if (lastMessage && lastMessage.role === 'tool' && lastMessage.type === 'running_now') {
				this._updateLatestTool(threadId, {
					role: 'tool',
					type: 'rejected',
					content: lastMessage.content,
					id: lastMessage.id,
					rawParams: lastMessage.rawParams,
					result: null,
					name: lastMessage.name,
					params: lastMessage.params,
					mcpServerName: lastMessage.mcpServerName
				});
			}
		}

		if (doNotRefreshMountInfo) return;

		let whenMountedResolver!: (w: WhenMounted) => void;
		const whenMountedPromise = new Promise<WhenMounted>((res) => whenMountedResolver = res);

		this._setThreadState(threadId, {
			mountedInfo: {
				whenMounted: whenMountedPromise,
				mountedIsResolvedRef: { current: false },
				_whenMountedResolver: (w: WhenMounted) => {
					whenMountedResolver(w);
					const mountInfo = this.state.allThreads[threadId]?.state.mountedInfo;
					if (mountInfo) mountInfo.mountedIsResolvedRef.current = true;
				},
			}
		}, true);
	}

	private _setStreamState(threadId: string, state: ThreadStreamState[string]) {
		this.streamState[threadId] = state;
		this._onDidChangeStreamState.fire({ threadId });
	}

	private _currentModelSelectionProps = () => {
		const featureName: FeatureName = 'Chat';
		const modelSelection = this._settingsService.state.modelSelectionOfFeature[featureName];
		const modelSelectionOptions = modelSelection
			? this._settingsService.state.optionsOfModelSelection[featureName][modelSelection.providerName]?.[modelSelection.modelName]
			: undefined;
		return { modelSelection, modelSelectionOptions };
	};

	private _swapOutLatestStreamingToolWithResult = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const messages = this.state.allThreads[threadId]?.messages;
		if (!messages) return false;
		const lastMsg = messages[messages.length - 1];
		if (!lastMsg) return false;

		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			this._editMessageInThread(threadId, messages.length - 1, tool);
			return true;
		}
		return false;
	};

	private _updateLatestTool = (threadId: string, tool: ChatMessage & { role: 'tool' }) => {
		const swapped = this._swapOutLatestStreamingToolWithResult(threadId, tool);
		if (swapped) return;
		this._addMessageToThread(threadId, tool);
	};

	approveLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const lastMsg = thread.messages[thread.messages.length - 1];
		if (!(lastMsg.role === 'tool' && lastMsg.type === 'tool_request')) return;

		const callThisToolFirst: ToolMessage<ToolName> = lastMsg;

		this._wrapRunAgentToNotify(
			this._runChatAgent({ callThisToolFirst, threadId, ...this._currentModelSelectionProps() }),
			threadId
		);
	}

	rejectLatestToolRequest(threadId: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const lastMsg = thread.messages[thread.messages.length - 1];

		let params: ToolCallParams<ToolName>;
		if (lastMsg.role === 'tool' && lastMsg.type !== 'invalid_params') {
			params = lastMsg.params;
		} else {
			return;
		}

		const { name, id, rawParams, mcpServerName } = lastMsg;
		const errorMessage = this.toolErrMsgs.rejected;
		this._updateLatestTool(threadId, {
			role: 'tool',
			type: 'rejected',
			params,
			name,
			content: errorMessage,
			result: null,
			id,
			rawParams,
			mcpServerName
		});
		this._setStreamState(threadId, undefined);
	}

	private _computeMCPServerOfToolName = (toolName: string) => {
		return this._mcpService.getMCPTools()?.find(t => t.name === toolName)?.mcpServerName;
	};

	async abortRunning(threadId: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		if (this.streamState[threadId]?.isRunning === 'LLM') {
			const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId].llmInfo;
			this._addMessageToThread(threadId, {
				role: 'assistant',
				displayContent: displayContentSoFar,
				reasoning: reasoningSoFar,
				anthropicReasoning: null
			});
			if (toolCallSoFar) {
				this._addMessageToThread(threadId, {
					role: 'interrupted_streaming_tool',
					name: toolCallSoFar.name,
					mcpServerName: this._computeMCPServerOfToolName(toolCallSoFar.name)
				});
			}
		} else if (this.streamState[threadId]?.isRunning === 'tool') {
			const { toolName, toolParams, id, content: content_, rawParams, mcpServerName } = this.streamState[threadId].toolInfo;
			const content = content_ || this.toolErrMsgs.interrupted;
			this._updateLatestTool(threadId, {
				role: 'tool',
				name: toolName,
				params: toolParams,
				id,
				content,
				rawParams,
				type: 'rejected',
				result: null,
				mcpServerName
			});
		} else if (this.streamState[threadId]?.isRunning === 'awaiting_user') {
			this.rejectLatestToolRequest(threadId);
		}

		this._addUserCheckpoint({ threadId });

		const interrupt = await this.streamState[threadId]?.interrupt;
		if (typeof interrupt === 'function') {
			interrupt();
		}

		this._setStreamState(threadId, undefined);
	}

	private readonly toolErrMsgs = {
		rejected: 'Tool call was rejected by the user.',
		interrupted: 'Tool call was interrupted by the user.',
		errWhenStringifying: (error: any) => `Tool call succeeded, but there was an error stringifying the output.\n${getErrorMessage(error)}`
	};

	private _runToolCall = async (
		threadId: string,
		toolName: ToolName,
		toolId: string,
		mcpServerName: string | undefined,
		opts: { preapproved: true, unvalidatedToolParams: RawToolParamsObj, validatedParams: ToolCallParams<ToolName> } | { preapproved: false, unvalidatedToolParams: RawToolParamsObj },
	): Promise<{ awaitingUserApproval?: boolean, interrupted?: boolean }> => {
		let toolParams: ToolCallParams<ToolName>;
		let toolResult: ToolResult<ToolName>;
		let toolResultStr: string;

		const isBuiltInTool = isABuiltinToolName(toolName);

		if (!opts.preapproved) {
			try {
				if (isBuiltInTool) {
					toolParams = this._toolsService.validateParams[toolName](opts.unvalidatedToolParams);
				} else {
					toolParams = opts.unvalidatedToolParams;
				}
			} catch (error) {
				const errorMessage = getErrorMessage(error);
				this._addMessageToThread(threadId, {
					role: 'tool',
					type: 'invalid_params',
					rawParams: opts.unvalidatedToolParams,
					result: null,
					name: toolName,
					content: errorMessage,
					id: toolId,
					mcpServerName
				});
				return {};
			}

			if (toolName === 'edit_file') {
				this._addToolEditCheckpoint({ threadId, uri: (toolParams as BuiltinToolCallParams['edit_file']).uri });
			}
			if (toolName === 'rewrite_file') {
				this._addToolEditCheckpoint({ threadId, uri: (toolParams as BuiltinToolCallParams['rewrite_file']).uri });
			}

			const approvalType = isBuiltInTool ? approvalTypeOfBuiltinToolName[toolName] : 'MCP tools';
			if (approvalType) {
				const autoApprove = this._settingsService.state.globalSettings.autoApprove[approvalType];
				this._addMessageToThread(threadId, {
					role: 'tool',
					type: 'tool_request',
					content: '(Awaiting user permission...)',
					result: null,
					name: toolName,
					params: toolParams,
					id: toolId,
					rawParams: opts.unvalidatedToolParams,
					mcpServerName
				});
				if (!autoApprove) {
					return { awaitingUserApproval: true };
				}
			}
		} else {
			toolParams = opts.validatedParams;
		}

		const runningTool = {
			role: 'tool',
			type: 'running_now',
			name: toolName,
			params: toolParams,
			content: '(value not received yet...)',
			result: null,
			id: toolId,
			rawParams: opts.unvalidatedToolParams,
			mcpServerName
		} as const;
		this._updateLatestTool(threadId, runningTool);

		let interrupted = false;
		let resolveInterruptor: (r: () => void) => void = () => { };
		const interruptorPromise = new Promise<() => void>(res => { resolveInterruptor = res; });

		try {
			this._setStreamState(threadId, {
				isRunning: 'tool',
				interrupt: interruptorPromise,
				toolInfo: { toolName, toolParams, id: toolId, content: 'interrupted...', rawParams: opts.unvalidatedToolParams, mcpServerName }
			});

			if (isBuiltInTool) {
				const { result, interruptTool } = await this._toolsService.callTool[toolName](toolParams as any);
				const interruptor = () => { interrupted = true; interruptTool?.(); };
				resolveInterruptor(interruptor);
				toolResult = await result;
			} else {
				const mcpTools = this._mcpService.getMCPTools();
				const mcpTool = mcpTools?.find(t => t.name === toolName);
				if (!mcpTool) throw new Error(`MCP tool ${toolName} not found`);

				resolveInterruptor(() => { });

				toolResult = (await this._mcpService.callMCPTool({
					serverName: mcpTool.mcpServerName ?? 'unknown_mcp_server',
					toolName,
					params: toolParams
				})).result;
			}

			if (interrupted) return { interrupted: true };
		} catch (error) {
			resolveInterruptor(() => { });
			if (interrupted) return { interrupted: true };

			const errorMessage = getErrorMessage(error);
			this._updateLatestTool(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: toolParams,
				result: errorMessage,
				name: toolName,
				content: errorMessage,
				id: toolId,
				rawParams: opts.unvalidatedToolParams,
				mcpServerName
			});
			return {};
		}

		try {
			if (isBuiltInTool) {
				toolResultStr = this._toolsService.stringOfResult[toolName](toolParams as any, toolResult as any);
			} else {
				toolResultStr = this._mcpService.stringifyResult(toolResult as RawMCPToolCall);
			}
		} catch (error) {
			const errorMessage = this.toolErrMsgs.errWhenStringifying(error);
			this._updateLatestTool(threadId, {
				role: 'tool',
				type: 'tool_error',
				params: toolParams,
				result: errorMessage,
				name: toolName,
				content: errorMessage,
				id: toolId,
				rawParams: opts.unvalidatedToolParams,
				mcpServerName
			});
			return {};
		}

		this._updateLatestTool(threadId, {
			role: 'tool',
			type: 'success',
			params: toolParams,
			result: toolResult,
			name: toolName,
			content: toolResultStr,
			id: toolId,
			rawParams: opts.unvalidatedToolParams,
			mcpServerName
		});
		return {};
	};

	private async _runChatAgent({
		threadId,
		modelSelection,
		modelSelectionOptions,
		callThisToolFirst,
	}: {
		threadId: string,
		modelSelection: ModelSelection | null,
		modelSelectionOptions: ModelSelectionOptions | undefined,
		callThisToolFirst?: ToolMessage<ToolName> & { type: 'tool_request' }
	}) {
		let interruptedWhenIdle = false;
		const idleInterruptor = Promise.resolve(() => { interruptedWhenIdle = true; });

		const { chatMode } = this._settingsService.state.globalSettings;
		const { overridesOfModel } = this._settingsService.state;

		let nMessagesSent = 0;
		let shouldSendAnotherMessage = true;
		let isRunningWhenEnd: IsRunningType = undefined;

		if (callThisToolFirst) {
			const { interrupted } = await this._runToolCall(threadId, callThisToolFirst.name, callThisToolFirst.id, callThisToolFirst.mcpServerName, {
				preapproved: true,
				unvalidatedToolParams: callThisToolFirst.rawParams,
				validatedParams: callThisToolFirst.params
			});
			if (interrupted) {
				this._setStreamState(threadId, undefined);
				this._addUserCheckpoint({ threadId });
			}
		}
		this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });

		while (shouldSendAnotherMessage) {
			shouldSendAnotherMessage = false;
			isRunningWhenEnd = undefined;
			nMessagesSent += 1;

			this._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });

			const chatMessages = this.state.allThreads[threadId]?.messages ?? [];
			const { messages, separateSystemMessage } = await this._convertToLLMMessagesService.prepareLLMChatMessages({
				chatMessages,
				modelSelection,
				chatMode
			});

			if (interruptedWhenIdle) {
				this._setStreamState(threadId, undefined);
				return;
			}

			let shouldRetryLLM = true;
			let nAttempts = 0;

			while (shouldRetryLLM) {
				shouldRetryLLM = false;
				nAttempts += 1;

				type ResTypes =
					| { type: 'llmDone', toolCall?: RawToolCallObj, info: { fullText: string, fullReasoning: string, anthropicReasoning: AnthropicReasoning[] | null } }
					| { type: 'llmError', error?: { message: string; fullError: Error | null } }
					| { type: 'llmAborted' };

				let resMessageIsDonePromise!: (res: ResTypes) => void;
				const messageIsDonePromise = new Promise<ResTypes>((res) => { resMessageIsDonePromise = res; });

				const llmCancelToken = this._llmMessageService.sendLLMMessage({
					messagesType: 'chatMessages',
					chatMode,
					messages,
					modelSelection,
					modelSelectionOptions,
					overridesOfModel,
					logging: { loggingName: `Chat - ${chatMode}`, loggingExtras: { threadId, nMessagesSent, chatMode } },
					separateSystemMessage,
					onText: ({ fullText, fullReasoning, toolCall }) => {
						this._setStreamState(threadId, {
							isRunning: 'LLM',
							llmInfo: { displayContentSoFar: fullText, reasoningSoFar: fullReasoning, toolCallSoFar: toolCall ?? null },
							interrupt: Promise.resolve(() => { if (llmCancelToken) this._llmMessageService.abort(llmCancelToken); })
						});
					},
					onFinalMessage: async ({ fullText, fullReasoning, toolCall, anthropicReasoning }) => {
						resMessageIsDonePromise({ type: 'llmDone', toolCall, info: { fullText, fullReasoning, anthropicReasoning } });
					},
					onError: async (error) => {
						resMessageIsDonePromise({ type: 'llmError', error });
					},
					onAbort: () => {
						resMessageIsDonePromise({ type: 'llmAborted' });
						this._metricsService.capture('Agent Loop Done (Aborted)', { nMessagesSent, chatMode });
					},
				});

				if (!llmCancelToken) {
					this._setStreamState(threadId, {
						isRunning: undefined,
						error: { message: 'There was an unexpected error when sending your chat message.', fullError: null }
					});
					break;
				}

				this._setStreamState(threadId, {
					isRunning: 'LLM',
					llmInfo: { displayContentSoFar: '', reasoningSoFar: '', toolCallSoFar: null },
					interrupt: Promise.resolve(() => this._llmMessageService.abort(llmCancelToken))
				});

				const llmRes = await messageIsDonePromise;

				if (this.streamState[threadId]?.isRunning !== 'LLM') {
					return;
				}

				if (llmRes.type === 'llmAborted') {
					this._setStreamState(threadId, undefined);
					return;
				} else if (llmRes.type === 'llmError') {
					if (nAttempts < CHAT_RETRIES) {
						shouldRetryLLM = true;
						this._setStreamState(threadId, { isRunning: 'idle', interrupt: idleInterruptor });
						await timeout(RETRY_DELAY);
						if (interruptedWhenIdle) {
							this._setStreamState(threadId, undefined);
							return;
						} else {
							continue;
						}
					} else {
						const { error } = llmRes;
						const { displayContentSoFar, reasoningSoFar, toolCallSoFar } = this.streamState[threadId].llmInfo;
						this._addMessageToThread(threadId, {
							role: 'assistant',
							displayContent: displayContentSoFar,
							reasoning: reasoningSoFar,
							anthropicReasoning: null
						});
						if (toolCallSoFar) {
							this._addMessageToThread(threadId, {
								role: 'interrupted_streaming_tool',
								name: toolCallSoFar.name,
								mcpServerName: this._computeMCPServerOfToolName(toolCallSoFar.name)
							});
						}

						this._setStreamState(threadId, { isRunning: undefined, error });
						this._addUserCheckpoint({ threadId });
						return;
					}
				}

				const { toolCall, info } = llmRes;

				this._addMessageToThread(threadId, {
					role: 'assistant',
					displayContent: info.fullText,
					reasoning: info.fullReasoning,
					anthropicReasoning: info.anthropicReasoning
				});

				this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });

				if (toolCall) {
					const mcpTools = this._mcpService.getMCPTools();
					const mcpTool = mcpTools?.find(t => t.name === toolCall.name);

					const { awaitingUserApproval, interrupted } = await this._runToolCall(
						threadId,
						toolCall.name,
						toolCall.id,
						mcpTool?.mcpServerName,
						{ preapproved: false, unvalidatedToolParams: toolCall.rawParams }
					);

					if (interrupted) {
						this._setStreamState(threadId, undefined);
						return;
					}
					if (awaitingUserApproval) {
						isRunningWhenEnd = 'awaiting_user';
					} else {
						shouldSendAnotherMessage = true;
					}

					this._setStreamState(threadId, { isRunning: 'idle', interrupt: 'not_needed' });
				}
			}
		}

		this._setStreamState(threadId, { isRunning: isRunningWhenEnd });
		if (!isRunningWhenEnd) this._addUserCheckpoint({ threadId });
		this._metricsService.capture('Agent Loop Done', { nMessagesSent, chatMode });
	}

	private _addCheckpoint(threadId: string, checkpoint: CheckpointEntry) {
		this._addMessageToThread(threadId, checkpoint);
	}

	private _editMessageInThread(threadId: string, messageIdx: number, newMessage: ChatMessage) {
		const { allThreads } = this.state;
		const oldThread = allThreads[threadId];
		if (!oldThread) return;

		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages.slice(0, messageIdx),
					newMessage,
					...oldThread.messages.slice(messageIdx + 1, Infinity),
				],
			}
		};

		this._storeAllThreads(newThreads);
		this._setState({ allThreads: newThreads });
	}

	private _getCheckpointInfo = (checkpointMessage: ChatMessage & { role: 'checkpoint' }, fsPath: string, opts: { includeUserModifiedChanges: boolean }) => {
		const voidFileSnapshot = checkpointMessage.voidFileSnapshotOfURI ? checkpointMessage.voidFileSnapshotOfURI[fsPath] ?? null : null;
		if (!opts.includeUserModifiedChanges) {
			return { voidFileSnapshot };
		}

		const userModifiedVoidFileSnapshot = fsPath in checkpointMessage.userModifications.voidFileSnapshotOfURI
			? checkpointMessage.userModifications.voidFileSnapshotOfURI[fsPath] ?? null
			: null;

		return { voidFileSnapshot: userModifiedVoidFileSnapshot ?? voidFileSnapshot };
	};

	private _computeNewCheckpointInfo({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const lastCheckpointIdx = findLastIdx(thread.messages, (m) => m.role === 'checkpoint') ?? -1;
		if (lastCheckpointIdx === -1) return;

		const voidFileSnapshotOfURI: { [fsPath: string]: VoidFileSnapshot | undefined } = {};

		const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: 0, hiIdx: lastCheckpointIdx }) ?? {};
		for (const fsPath in lastIdxOfURI ?? {}) {
			const { model } = this._voidModelService.getModelFromFsPath(fsPath);
			if (!model) continue;
			const checkpoint2 = thread.messages[lastIdxOfURI[fsPath]] || null;
			if (!checkpoint2) continue;
			if (checkpoint2.role !== 'checkpoint') continue;
			const res = this._getCheckpointInfo(checkpoint2, fsPath, { includeUserModifiedChanges: false });
			if (!res) continue;
			const { voidFileSnapshot: oldVoidFileSnapshot } = res;

			const voidFileSnapshot = this._editCodeService.getVoidFileSnapshot(URI.file(fsPath));
			if (oldVoidFileSnapshot === voidFileSnapshot) continue;
			voidFileSnapshotOfURI[fsPath] = voidFileSnapshot;
		}

		return { voidFileSnapshotOfURI };
	}

	private _addUserCheckpoint({ threadId }: { threadId: string }) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {};
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'user_edit',
			voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {},
			userModifications: { voidFileSnapshotOfURI: {} },
		});
	}

	private _addToolEditCheckpoint({ threadId, uri }: { threadId: string, uri: URI }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;
		const { model } = this._voidModelService.getModel(uri);
		if (!model) return;
		const diffAreasSnapshot = this._editCodeService.getVoidFileSnapshot(uri);
		this._addCheckpoint(threadId, {
			role: 'checkpoint',
			type: 'tool_edit',
			voidFileSnapshotOfURI: { [uri.fsPath]: diffAreasSnapshot },
			userModifications: { voidFileSnapshotOfURI: {} },
		});
	}

	private _getCheckpointBeforeMessage = ({ threadId, messageIdx }: { threadId: string, messageIdx: number }): [CheckpointEntry, number] | undefined => {
		const thread = this.state.allThreads[threadId];
		if (!thread) return undefined;
		for (let i = messageIdx; i >= 0; i--) {
			const message = thread.messages[i];
			if (message.role === 'checkpoint') {
				return [message, i];
			}
		}
		return undefined;
	};

	private _getCheckpointsBetween({ threadId, loIdx, hiIdx }: { threadId: string, loIdx: number, hiIdx: number }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return { lastIdxOfURI: {} };
		const lastIdxOfURI: { [fsPath: string]: number } = {};
		for (let i = loIdx; i <= hiIdx; i += 1) {
			const message = thread.messages[i];
			if (message?.role !== 'checkpoint') continue;
			for (const fsPath in message.voidFileSnapshotOfURI) {
				lastIdxOfURI[fsPath] = i;
			}
		}
		return { lastIdxOfURI };
	}

	private _readCurrentCheckpoint(threadId: string): [CheckpointEntry, number] | undefined {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		const { currCheckpointIdx } = thread.state;
		if (currCheckpointIdx === null) return;

		const checkpoint = thread.messages[currCheckpointIdx];
		if (!checkpoint) return;
		if (checkpoint.role !== 'checkpoint') return;
		return [checkpoint, currCheckpointIdx];
	}

	private _addUserModificationsToCurrCheckpoint({ threadId }: { threadId: string }) {
		const { voidFileSnapshotOfURI } = this._computeNewCheckpointInfo({ threadId }) ?? {};
		const res = this._readCurrentCheckpoint(threadId);
		if (!res) return;
		const [checkpoint, checkpointIdx] = res;
		this._editMessageInThread(threadId, checkpointIdx, {
			...checkpoint,
			userModifications: { voidFileSnapshotOfURI: voidFileSnapshotOfURI ?? {} },
		});
	}

	private _makeUsStandOnCheckpoint({ threadId }: { threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;
		if (thread.state.currCheckpointIdx === null) {
			const lastMsg = thread.messages[thread.messages.length - 1];
			if (lastMsg?.role !== 'checkpoint') {
				this._addUserCheckpoint({ threadId });
			}
			this._setThreadState(threadId, { currCheckpointIdx: thread.messages.length - 1 });
		}
	}

	jumpToCheckpointBeforeMessageIdx({ threadId, messageIdx, jumpToUserModified }: { threadId: string, messageIdx: number, jumpToUserModified: boolean }) {
		this._makeUsStandOnCheckpoint({ threadId });

		const thread = this.state.allThreads[threadId];
		if (!thread) return;
		if (this.streamState[threadId]?.isRunning) return;

		const c = this._getCheckpointBeforeMessage({ threadId, messageIdx });
		if (c === undefined) return;

		const fromIdx = thread.state.currCheckpointIdx;
		if (fromIdx === null) return;

		const [, toIdx] = c;
		if (toIdx === fromIdx) return;

		this._addUserModificationsToCurrCheckpoint({ threadId });

		if (toIdx < fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: toIdx + 1, hiIdx: fromIdx });

			const idxes = function* () {
				for (let k = toIdx; k >= 0; k -= 1) {
					yield k;
				}
				for (let k = toIdx + 1; k < thread.messages.length; k += 1) {
					yield k;
				}
			};

			for (const fsPath in lastIdxOfURI) {
				for (const k of idxes()) {
					const message = thread.messages[k];
					if (message.role !== 'checkpoint') continue;
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified });
					if (!res) continue;
					const { voidFileSnapshot } = res;
					if (!voidFileSnapshot) continue;
					this._editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), voidFileSnapshot);
					break;
				}
			}
		}

		if (toIdx > fromIdx) {
			const { lastIdxOfURI } = this._getCheckpointsBetween({ threadId, loIdx: fromIdx + 1, hiIdx: toIdx });
			for (const fsPath in lastIdxOfURI) {
				for (let k = toIdx; k >= fromIdx + 1; k -= 1) {
					const message = thread.messages[k];
					if (message.role !== 'checkpoint') continue;
					const res = this._getCheckpointInfo(message, fsPath, { includeUserModifiedChanges: jumpToUserModified });
					if (!res) continue;
					const { voidFileSnapshot } = res;
					if (!voidFileSnapshot) continue;
					this._editCodeService.restoreVoidFileSnapshot(URI.file(fsPath), voidFileSnapshot);
					break;
				}
			}
		}

		this._setThreadState(threadId, { currCheckpointIdx: toIdx });
	}

	private _wrapRunAgentToNotify(p: Promise<void>, threadId: string) {
		const notify = ({ error }: { error: string | null }) => {
			const thread = this.state.allThreads[threadId];
			if (!thread) return;
			const userMsg = findLast(thread.messages, m => m.role === 'user');
			if (!userMsg) return;
			if (userMsg.role !== 'user') return;
			const messageContent = truncate(userMsg.displayContent, 50, '...');

			this._notificationService.notify({
				severity: error ? Severity.Warning : Severity.Info,
				message: error ? `Error: ${error} ` : `A new Chat result is ready.`,
				source: messageContent,
				sticky: true,
				actions: {
					primary: [{
						id: 'void.goToChat',
						enabled: true,
						label: 'Jump to Chat',
						tooltip: '',
						class: undefined,
						run: () => {
							this.switchToThread(threadId);
							this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
								m.scrollToBottom();
							});
						}
					}]
				},
			});
		};

		p.then(() => {
			if (threadId !== this.state.currentThreadId) notify({ error: null });
		}).catch((e) => {
			if (threadId !== this.state.currentThreadId) notify({ error: getErrorMessage(e) });
			throw e;
		});
	}

	dismissStreamError(threadId: string): void {
		this._setStreamState(threadId, undefined);
	}

	private async _addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId }: { userMessage: string, _chatSelections?: StagingSelectionItem[], threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		if (this.streamState[threadId]?.isRunning) {
			await this.abortRunning(threadId);
		}

		if (thread.messages.length === 0) {
			this._addUserCheckpoint({ threadId });
		}

		const instructions = userMessage;
		const currSelns: StagingSelectionItem[] = _chatSelections ?? thread.state.stagingSelections;

		const userMessageContent = await chat_userMessageContent(instructions, currSelns, {
			directoryStrService: this._directoryStringService,
			fileService: this._fileService
		});

		const userHistoryElt: ChatMessage = {
			role: 'user',
			content: userMessageContent,
			displayContent: instructions,
			selections: currSelns,
			state: defaultMessageState
		};

		this._addMessageToThread(threadId, userHistoryElt);
		this._setThreadState(threadId, { currCheckpointIdx: null });

		// ONYX local intent interception
		if (shouldCreatePlanWorkspaceFromPrompt(instructions) || shouldOpenExistingPlanFromPrompt(instructions)) {
			try {
				const workspace = this._workspaceContextService.getWorkspace();
				const firstFolder = workspace.folders[0];

				if (!firstFolder) {
					const onyxReply: ChatMessage = {
						role: 'assistant',
						displayContent: 'ONYX could not access an open workspace folder.',
						reasoning: '',
						anthropicReasoning: null
					};

					this._addMessageToThread(threadId, onyxReply);

					this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
						m.scrollToBottom();
					});

					return;
				}

				const planWorkspaceService = new OnyxPlanWorkspaceService(
					this._fileService,
					this._editorService
				);

				if (shouldCreatePlanWorkspaceFromPrompt(instructions)) {
					await planWorkspaceService.createInitialPlan(firstFolder.uri.fsPath, instructions);

					const onyxReply: ChatMessage = {
						role: 'assistant',
						displayContent: 'ONYX created and opened the plan workspace.',
						reasoning: '',
						anthropicReasoning: null
					};

					this._addMessageToThread(threadId, onyxReply);
				} else {
					await planWorkspaceService.openExistingPlan(firstFolder.uri.fsPath);

					const onyxReply: ChatMessage = {
						role: 'assistant',
						displayContent: 'ONYX opened the current plan workspace.',
						reasoning: '',
						anthropicReasoning: null
					};

					this._addMessageToThread(threadId, onyxReply);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);

				const onyxErrorReply: ChatMessage = {
					role: 'assistant',
					displayContent: `ONYX failed to handle the plan workspace request: ${message}`,
					reasoning: '',
					anthropicReasoning: null
				};

				this._addMessageToThread(threadId, onyxErrorReply);
			}

			this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
				m.scrollToBottom();
			});

			return;
		}

		this._wrapRunAgentToNotify(
			this._runChatAgent({ threadId, ...this._currentModelSelectionProps() }),
			threadId,
		);

		this.state.allThreads[threadId]?.state.mountedInfo?.whenMounted.then(m => {
			m.scrollToBottom();
		});
	}

	async addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId }: { userMessage: string, _chatSelections?: StagingSelectionItem[], threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		if (thread.state.currCheckpointIdx !== null) {
			const checkpointIdx = thread.state.currCheckpointIdx;
			const newMessages = thread.messages.slice(0, checkpointIdx + 1);

			const newThreads = {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					lastModified: new Date().toISOString(),
					messages: newMessages,
				}
			};
			this._storeAllThreads(newThreads);
			this._setState({ allThreads: newThreads });
		}

		await this._addUserMessageAndStreamResponse({ userMessage, _chatSelections, threadId });
	}

	editUserMessageAndStreamResponse: IChatThreadService['editUserMessageAndStreamResponse'] = async ({ userMessage, messageIdx, threadId }) => {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		if (thread.messages?.[messageIdx]?.role !== 'user') {
			throw new Error(`Error: editing a message with role !=='user'`);
		}

		const currSelns = thread.messages[messageIdx].state.stagingSelections || [];

		const slicedMessages = thread.messages.slice(0, messageIdx);
		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					messages: slicedMessages
				}
			}
		});

		this._addUserMessageAndStreamResponse({ userMessage, _chatSelections: currSelns, threadId });
	};

	private _getAllSeenFileURIs(threadId: string) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return [];

		const fsPathsSet = new Set<string>();
		const uris: URI[] = [];
		const addURI = (uri: URI) => {
			if (!fsPathsSet.has(uri.fsPath)) uris.push(uri);
			fsPathsSet.add(uri.fsPath);
			uris.push(uri);
		};

		for (const m of thread.messages) {
			if (m.role === 'user') {
				for (const sel of m.selections ?? []) {
					addURI(sel.uri);
				}
			} else if (m.role === 'tool' && m.type === 'success' && m.name === 'read_file') {
				const params = m.params as BuiltinToolCallParams['read_file'];
				addURI(params.uri);
			}
		}
		return uris;
	}

	getRelativeStr = (uri: URI) => {
		const isInside = this._workspaceContextService.isInsideWorkspace(uri);
		if (isInside) {
			const f = this._workspaceContextService.getWorkspace().folders.find(f => uri.fsPath.startsWith(f.uri.fsPath));
			if (f) {
				return uri.fsPath.replace(f.uri.fsPath, '');
			}
			return undefined;
		}
		return undefined;
	};

	generateCodespanLink: IChatThreadService['generateCodespanLink'] = async ({ codespanStr: _codespanStr, threadId }) => {
		const functionOrMethodPattern = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
		const functionParensPattern = /^([^\s(]+)\([^)]*\)$/;

		let target = _codespanStr;
		let codespanType: 'file-or-folder' | 'function-or-class';

		if (target.includes('.') || target.includes('/')) {
			codespanType = 'file-or-folder';
			target = _codespanStr;
		} else if (functionOrMethodPattern.test(target)) {
			codespanType = 'function-or-class';
			target = _codespanStr;
		} else if (functionParensPattern.test(target)) {
			const match = target.match(functionParensPattern);
			if (match && match[1]) {
				codespanType = 'function-or-class';
				target = match[1];
			} else {
				return null;
			}
		} else {
			return null;
		}

		const prevUris = this._getAllSeenFileURIs(threadId).reverse();

		if (codespanType === 'file-or-folder') {
			const doesUriMatchTarget = (uri: URI) => uri.path.includes(target);

			for (const [idx, uri] of prevUris.entries()) {
				if (doesUriMatchTarget(uri)) {
					const prevUriStrs = prevUris.map(uri => uri.fsPath);
					const shortenedUriStrs = shorten(prevUriStrs);
					let displayText = shortenedUriStrs[idx];
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2);
					}

					return { uri, displayText };
				}
			}

			let uris: URI[] = [];
			try {
				const { result } = await this._toolsService.callTool['search_pathnames_only']({ query: target, includePattern: null, pageNumber: 0 });
				const { uris: uris_ } = await result;
				uris = uris_;
			} catch {
				return null;
			}

			for (const [idx, uri] of uris.entries()) {
				if (doesUriMatchTarget(uri)) {
					const prevUriStrs = prevUris.map(uri => uri.fsPath);
					const shortenedUriStrs = shorten(prevUriStrs);
					let displayText = shortenedUriStrs[idx];
					const ellipsisIdx = displayText.lastIndexOf('…/');
					if (ellipsisIdx >= 0) {
						displayText = displayText.slice(ellipsisIdx + 2);
					}

					return { uri, displayText };
				}
			}
		}

		if (codespanType === 'function-or-class') {
			for (const uri of prevUris) {
				const modelRef = await this._voidModelService.getModelSafe(uri);
				const { model } = modelRef;
				if (!model) continue;

				const matches = model.findMatches(
					target,
					false,
					false,
					true,
					null,
					true
				);

				const firstThree = matches.slice(0, 3);

				for (const match of firstThree) {
					const position = new Position(match.range.startLineNumber, match.range.startColumn);
					const definitionProviders = this._languageFeaturesService.definitionProvider.ordered(model);

					for (const provider of definitionProviders) {
						const _definitions = await provider.provideDefinition(model, position, CancellationToken.None);
						if (!_definitions) continue;

						const definitions = Array.isArray(_definitions) ? _definitions : [_definitions];

						for (const definition of definitions) {
							return {
								uri: definition.uri,
								selection: {
									startLineNumber: definition.range.startLineNumber,
									startColumn: definition.range.startColumn,
									endLineNumber: definition.range.endLineNumber,
									endColumn: definition.range.endColumn,
								},
								displayText: _codespanStr,
							};
						}
					}
				}
			}
		}

		return null;
	};

	getCodespanLink({ codespanStr, messageIdx, threadId }: { codespanStr: string, messageIdx: number, threadId: string }): CodespanLocationLink | undefined {
		const thread = this.state.allThreads[threadId];
		if (!thread) return undefined;

		const links = thread.state.linksOfMessageIdx?.[messageIdx];
		if (!links) return undefined;

		return links[codespanStr];
	}

	async addCodespanLink({ newLinkText, newLinkLocation, messageIdx, threadId }: { newLinkText: string, newLinkLocation: CodespanLocationLink, messageIdx: number, threadId: string }) {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						linksOfMessageIdx: {
							...thread.state.linksOfMessageIdx,
							[messageIdx]: {
								...thread.state.linksOfMessageIdx?.[messageIdx],
								[newLinkText]: newLinkLocation
							}
						}
					}
				}
			}
		});
	}

	getCurrentThread(): ThreadType {
		const thread = this.state.allThreads[this.state.currentThreadId];
		if (!thread) throw new Error('Current thread should never be undefined');
		return thread;
	}

	getCurrentFocusedMessageIdx() {
		const thread = this.getCurrentThread();
		const focusedMessageIdx = thread.state.focusedMessageIdx;
		if (focusedMessageIdx === undefined) return;

		const focusedMessage = thread.messages[focusedMessageIdx];
		if (focusedMessage.role !== 'user') return;
		if (!focusedMessage.state) return;

		return focusedMessageIdx;
	}

	isCurrentlyFocusingMessage() {
		return this.getCurrentFocusedMessageIdx() !== undefined;
	}

	switchToThread(threadId: string) {
		this._setState({ currentThreadId: threadId });
	}

	openNewThread() {
		const { allThreads: currentThreads } = this.state;
		for (const threadId in currentThreads) {
			if (currentThreads[threadId]!.messages.length === 0) {
				this.switchToThread(threadId);
				return;
			}
		}

		const newThread = newThreadObject();
		const newThreads: ChatThreads = {
			...currentThreads,
			[newThread.id]: newThread
		};
		this._storeAllThreads(newThreads);
		this._setState({ allThreads: newThreads, currentThreadId: newThread.id });
	}

	deleteThread(threadId: string): void {
		const { allThreads: currentThreads } = this.state;
		const newThreads = { ...currentThreads };
		delete newThreads[threadId];
		this._storeAllThreads(newThreads);
		this._setState({ ...this.state, allThreads: newThreads });
	}

	duplicateThread(threadId: string) {
		const { allThreads: currentThreads } = this.state;
		const threadToDuplicate = currentThreads[threadId];
		if (!threadToDuplicate) return;

		const newThread = {
			...deepClone(threadToDuplicate),
			id: generateUuid(),
		};

		const newThreads = {
			...currentThreads,
			[newThread.id]: newThread,
		};

		this._storeAllThreads(newThreads);
		this._setState({ allThreads: newThreads });
	}

	private _addMessageToThread(threadId: string, message: ChatMessage) {
		const { allThreads } = this.state;
		const oldThread = allThreads[threadId];
		if (!oldThread) return;

		const newThreads = {
			...allThreads,
			[oldThread.id]: {
				...oldThread,
				lastModified: new Date().toISOString(),
				messages: [
					...oldThread.messages,
					message
				],
			}
		};

		this._storeAllThreads(newThreads);
		this._setState({ allThreads: newThreads });
	}

	setCurrentlyFocusedMessageIdx(messageIdx: number | undefined) {
		const threadId = this.state.currentThreadId;
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					state: {
						...thread.state,
						focusedMessageIdx: messageIdx,
					}
				}
			}
		});
	}

	addNewStagingSelection(newSelection: StagingSelectionItem): void {
		const focusedMessageIdx = this.getCurrentFocusedMessageIdx();

		let selections: StagingSelectionItem[] = [];
		let setSelections = (_s: StagingSelectionItem[]) => { };

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections;
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s });
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections;
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s });
		}

		const idx = findStagingSelectionIndex(selections, newSelection);
		if (idx !== null && idx !== -1) {
			setSelections([
				...selections.slice(0, idx),
				newSelection,
				...selections.slice(idx + 1, Infinity)
			]);
		} else {
			setSelections([...(selections ?? []), newSelection]);
		}
	}

	popStagingSelections(numPops: number): void {
		numPops = numPops ?? 1;

		const focusedMessageIdx = this.getCurrentFocusedMessageIdx();

		let selections: StagingSelectionItem[] = [];
		let setSelections = (_s: StagingSelectionItem[]) => { };

		if (focusedMessageIdx === undefined) {
			selections = this.getCurrentThreadState().stagingSelections;
			setSelections = (s: StagingSelectionItem[]) => this.setCurrentThreadState({ stagingSelections: s });
		} else {
			selections = this.getCurrentMessageState(focusedMessageIdx).stagingSelections;
			setSelections = (s) => this.setCurrentMessageState(focusedMessageIdx, { stagingSelections: s });
		}

		setSelections([
			...selections.slice(0, selections.length - numPops)
		]);
	}

	private _setCurrentMessageState(state: Partial<UserMessageState>, messageIdx: number): void {
		const threadId = this.state.currentThreadId;
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[threadId]: {
					...thread,
					messages: thread.messages.map((m, i) =>
						i === messageIdx && m.role === 'user'
							? {
								...m,
								state: {
									...m.state,
									...state
								},
							}
							: m
					)
				}
			}
		});
	}

	private _setThreadState(threadId: string, state: Partial<ThreadType['state']>, doNotRefreshMountInfo?: boolean): void {
		const thread = this.state.allThreads[threadId];
		if (!thread) return;

		this._setState({
			allThreads: {
				...this.state.allThreads,
				[thread.id]: {
					...thread,
					state: {
						...thread.state,
						...state
					}
				}
			}
		}, doNotRefreshMountInfo);
	}

	getCurrentThreadState = () => {
		return this.getCurrentThread().state;
	};

	setCurrentThreadState = (newState: Partial<ThreadType['state']>) => {
		this._setThreadState(this.state.currentThreadId, newState);
	};

	getCurrentMessageState(messageIdx: number): UserMessageState {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx];
		if (!currMessage || currMessage.role !== 'user') return defaultMessageState;
		return currMessage.state;
	}

	setCurrentMessageState(messageIdx: number, newState: Partial<UserMessageState>) {
		const currMessage = this.getCurrentThread()?.messages?.[messageIdx];
		if (!currMessage || currMessage.role !== 'user') return;
		this._setCurrentMessageState(newState, messageIdx);
	}
}

registerSingleton(IChatThreadService, ChatThreadService, InstantiationType.Eager);