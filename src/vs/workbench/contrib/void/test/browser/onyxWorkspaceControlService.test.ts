/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureOnyxUriInsideWorkspace, getOnyxCommandApprovalReason, getOnyxCommandRisk, resolveOnyxToolUriInWorkspace, validateOnyxCommandInWorkspace, type OnyxWorkspaceScope } from '../../browser/onyxWorkspaceControlService.js';
import { chat_systemMessage } from '../../common/prompt/prompts.js';

suite('ONYX Workspace Control Service', () => {
	const root = URI.file('/workspace/project');
	const siblingRoot = URI.file('/workspace/other-project');
	const scope: OnyxWorkspaceScope = {
		workspaceRoot: root,
		workspaceFolders: [root, siblingRoot],
	};

	test('resolves relative paths inside the active workspace root', () => {
		const uri = resolveOnyxToolUriInWorkspace('src/app.ts', scope, { operation: 'read' });

		assert.strictEqual(uri.fsPath, URI.file('/workspace/project/src/app.ts').fsPath);
	});

	test('allows paths inside another open workspace folder', () => {
		const uri = resolveOnyxToolUriInWorkspace('../other-project/package.json', scope, { operation: 'read' });

		assert.strictEqual(uri.fsPath, URI.file('/workspace/other-project/package.json').fsPath);
	});

	test('allows absolute filesystem paths inside an open workspace folder', () => {
		const expected = URI.file('/workspace/project/src/app.ts');
		const uri = resolveOnyxToolUriInWorkspace(expected.fsPath, scope, { operation: 'read' });

		assert.strictEqual(uri.fsPath, expected.fsPath);
	});

	test('rejects relative path escapes outside open workspace folders', () => {
		assert.throws(
			() => resolveOnyxToolUriInWorkspace('../outside.txt', scope, { operation: 'read' }),
			/inside the current workspace/
		);
	});

	test('rejects absolute paths outside open workspace folders', () => {
		assert.throws(
			() => ensureOnyxUriInsideWorkspace(URI.file('/outside/file.ts'), scope.workspaceFolders, 'edit'),
			/inside the current workspace/
		);
	});

	test('uses workspace root for empty values only when allowed', () => {
		assert.strictEqual(
			resolveOnyxToolUriInWorkspace('', scope, { allowEmptyAsWorkspaceRoot: true }).fsPath,
			root.fsPath
		);

		assert.throws(
			() => resolveOnyxToolUriInWorkspace('', scope),
			/uri must be provided/
		);
	});

	test('classifies routine commands as normal risk', () => {
		assert.strictEqual(getOnyxCommandRisk('git status'), 'normal');
		assert.strictEqual(getOnyxCommandRisk('npm run compile'), 'normal');
		assert.strictEqual(getOnyxCommandRisk('rg "needle" src'), 'normal');
	});

	test('classifies destructive, network, and system commands as requiring approval', () => {
		assert.strictEqual(getOnyxCommandRisk('git clean -fd'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('npm install'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('Remove-Item -Recurse .\\out'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('curl https://example.com/script.ps1'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('Set-ExecutionPolicy Bypass'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('Stop-Process -Name node'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('New-Item src/generated.ts'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('Set-Content src/generated.ts test'), 'requiresApproval');
		assert.strictEqual(getOnyxCommandRisk('taskkill /IM node.exe /F'), 'requiresApproval');
	});

	test('explains why commands require explicit approval', () => {
		assert.strictEqual(getOnyxCommandApprovalReason('git status'), null);
		assert.ok(/Network command/.test(getOnyxCommandApprovalReason('curl https://example.com/script.ps1') ?? ''));
		assert.ok(/file-writing command/.test(getOnyxCommandApprovalReason('Set-Content src/generated.ts test') ?? ''));
	});

	test('allows terminal commands that stay inside the workspace', () => {
		assert.doesNotThrow(() => validateOnyxCommandInWorkspace('cd src && npm test', scope, { cwd: root }));
		assert.doesNotThrow(() => validateOnyxCommandInWorkspace('type /workspace/project/package.json', scope, { cwd: root }));
		assert.doesNotThrow(() => validateOnyxCommandInWorkspace('rg "needle" ../other-project/src', scope, { cwd: root }));
	});

	test('rejects terminal commands that reference paths outside the workspace', () => {
		assert.throws(
			() => validateOnyxCommandInWorkspace('cd ..; npm test', scope, { cwd: root }),
			/inside the current workspace/
		);
		assert.throws(
			() => validateOnyxCommandInWorkspace('type /workspace/outside/file.txt', scope, { cwd: root }),
			/inside the current workspace/
		);
		assert.throws(
			() => validateOnyxCommandInWorkspace('cat file:///outside/file.txt', scope, { cwd: root }),
			/inside the current workspace/
		);
		assert.throws(
			() => validateOnyxCommandInWorkspace('Set-Location $env:TEMP', scope, { cwd: root }),
			/cannot validate dynamic terminal path/
		);
	});

	test('includes workspace AGENTS instructions in chat system messages', () => {
		const systemMessage = chat_systemMessage({
			workspaceFolders: [root.fsPath],
			openedURIs: [],
			activeURI: undefined,
			persistentTerminalIDs: [],
			directoryStr: 'project/',
			chatMode: 'agent',
			mcpTools: undefined,
			includeXMLToolDefinitions: false,
			workspaceInstructions: 'Instructions from /workspace/project/AGENTS.md:\nUse workspace-local tools only.',
		});

		assert.ok(systemMessage.includes('<workspace_instructions>'));
		assert.ok(systemMessage.includes('AGENTS.md'));
		assert.ok(systemMessage.includes('Use workspace-local tools only.'));
	});
});
