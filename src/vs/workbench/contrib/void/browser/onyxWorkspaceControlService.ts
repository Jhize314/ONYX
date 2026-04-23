/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { isAbsolute } from '../../../../base/common/path.js';
import { extUriBiasedIgnorePathCase, normalizePath, resolvePath } from '../../../../base/common/resources.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { getOnyxCommandApprovalReason, getOnyxCommandRisk, validateOnyxCommandPathReferences, type OnyxCommandRisk } from '../common/onyxCommandPolicy.js';

export { getOnyxCommandApprovalReason, getOnyxCommandRisk };
export type { OnyxCommandRisk };

export interface OnyxWorkspaceScope {
	workspaceRoot: URI;
	workspaceFolders: URI[];
}

export interface IOnyxWorkspaceControlService {
	readonly _serviceBrand: undefined;

	getActiveScope(): OnyxWorkspaceScope;
	resolveToolUri(uriStr: unknown, opts?: { operation?: string; allowEmptyAsWorkspaceRoot?: boolean }): URI;
	resolveToolCwd(cwdStr: string | null): URI;
	validateCommand(command: string, opts?: { cwd?: URI }): void;
	ensureInsideWorkspace(uri: URI, operation?: string): URI;
	commandRisk(command: string): OnyxCommandRisk;
	commandApprovalReason(command: string): string | null;
}

export const IOnyxWorkspaceControlService = createDecorator<IOnyxWorkspaceControlService>('OnyxWorkspaceControlService');

const isEmptyToolValue = (value: unknown) => {
	return value === undefined || value === null || value === '' || value === 'null' || value === 'undefined';
};

export function ensureOnyxUriInsideWorkspace(uri: URI, workspaceFolders: readonly URI[], operation = 'access'): URI {
	const normalizedUri = normalizePath(uri);
	const workspaceFolder = workspaceFolders.find(folder => extUriBiasedIgnorePathCase.isEqualOrParent(normalizedUri, folder));

	if (!workspaceFolder) {
		const scopeDescription = workspaceFolders.map(folder => folder.fsPath || folder.toString()).join(', ');
		throw new Error(`ONYX can only ${operation} paths inside the current workspace. Refusing: ${normalizedUri.fsPath || normalizedUri.toString()}. Workspace: ${scopeDescription}`);
	}

	return normalizedUri;
}

export function resolveOnyxToolUriInWorkspace(
	uriStr: unknown,
	scope: OnyxWorkspaceScope,
	opts?: { operation?: string; allowEmptyAsWorkspaceRoot?: boolean }
): URI {
	if (isEmptyToolValue(uriStr)) {
		if (opts?.allowEmptyAsWorkspaceRoot) {
			return scope.workspaceRoot;
		}
		throw new Error('Invalid LLM output: uri must be provided.');
	}

	if (typeof uriStr !== 'string') {
		throw new Error(`Invalid LLM output format: uri must be a string, but its type is "${typeof uriStr}". Full value: ${JSON.stringify(uriStr)}.`);
	}

	const trimmedUri = uriStr.trim();
	const uri = trimmedUri.includes('://')
		? URI.parse(trimmedUri)
		: isAbsolute(trimmedUri)
			? URI.file(trimmedUri)
			: resolvePath(scope.workspaceRoot, trimmedUri);
	return ensureOnyxUriInsideWorkspace(uri, scope.workspaceFolders, opts?.operation);
}

const commandPathTokenToUri = (raw: string, scope: OnyxWorkspaceScope, cwd: URI | undefined, forceRelative = false) => {
	if (raw.toLowerCase().startsWith('file://')) {
		return URI.parse(raw);
	}
	if (raw.includes('://')) {
		return null;
	}
	if (!forceRelative && isAbsolute(raw)) {
		return URI.file(raw);
	}
	return resolvePath(cwd ?? scope.workspaceRoot, raw);
};

export function validateOnyxCommandInWorkspace(command: string, scope: OnyxWorkspaceScope, opts?: { cwd?: URI }): void {
	const cwd = opts?.cwd;
	validateOnyxCommandPathReferences(command, {
		resolvePathToken: (token, { forceRelative }) => commandPathTokenToUri(token, scope, cwd, forceRelative),
		assertInsideWorkspace: (uri, operation) => ensureOnyxUriInsideWorkspace(uri, scope.workspaceFolders, operation),
	});
}

class OnyxWorkspaceControlService implements IOnyxWorkspaceControlService {
	readonly _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
	) { }

	getActiveScope(): OnyxWorkspaceScope {
		const workspace = this.workspaceContextService.getWorkspace();
		const workspaceFolders = workspace.folders.map(folder => folder.uri);
		const activeResource = this.editorService.activeEditor?.resource;
		const activeWorkspaceFolder = activeResource ? this.workspaceContextService.getWorkspaceFolder(activeResource) : null;
		const workspaceRoot = activeWorkspaceFolder?.uri ?? workspaceFolders[0];

		if (!workspaceRoot) {
			throw new Error('ONYX needs an open workspace folder before it can control files or run commands.');
		}

		return { workspaceRoot, workspaceFolders };
	}

	resolveToolUri(uriStr: unknown, opts?: { operation?: string; allowEmptyAsWorkspaceRoot?: boolean }): URI {
		return resolveOnyxToolUriInWorkspace(uriStr, this.getActiveScope(), opts);
	}

	resolveToolCwd(cwdStr: string | null): URI {
		if (isEmptyToolValue(cwdStr)) {
			return this.getActiveScope().workspaceRoot;
		}
		return this.resolveToolUri(cwdStr, { operation: 'run terminal commands from' });
	}

	validateCommand(command: string, opts?: { cwd?: URI }): void {
		validateOnyxCommandInWorkspace(command, this.getActiveScope(), opts);
	}

	ensureInsideWorkspace(uri: URI, operation = 'access'): URI {
		const scope = this.getActiveScope();
		return ensureOnyxUriInsideWorkspace(uri, scope.workspaceFolders, operation);
	}

	commandRisk(command: string): OnyxCommandRisk {
		return getOnyxCommandRisk(command);
	}

	commandApprovalReason(command: string): string | null {
		return getOnyxCommandApprovalReason(command);
	}
}

registerSingleton(IOnyxWorkspaceControlService, OnyxWorkspaceControlService, InstantiationType.Eager);
