/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { OnyxCommandRunnerMainService } from '../../electron-main/onyxCommandRunnerMainService.js';

suite('ONYX Command Runner Main Service', () => {
	let workspaceRoot: string;
	let outsidePath: string;

	setup(() => {
		workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-command-runner-'));
		outsidePath = path.join(path.dirname(workspaceRoot), `outside-${path.basename(workspaceRoot)}.txt`);
	});

	teardown(() => {
		fs.rmSync(workspaceRoot, { recursive: true, force: true });
		fs.rmSync(outsidePath, { force: true });
	});

	test('runs a harmless command inside the workspace', async () => {
		const service = new OnyxCommandRunnerMainService();
		const result = await service.runCommand({
			requestId: 'onyx-smoke-run',
			command: `node -e "console.log('onyx-smoke')"`,
			cwd: workspaceRoot,
			workspaceFolders: [workspaceRoot],
			timeoutMs: 5000,
			maxOutputChars: 1000,
		});

		assert.strictEqual(result.exitCode, 0);
		assert.strictEqual(result.timedOut, false);
		assert.ok(result.output.includes('onyx-smoke'));
	});

	test('rejects commands that reference paths outside the workspace', async () => {
		const service = new OnyxCommandRunnerMainService();

		await assert.rejects(
			() => service.runCommand({
				requestId: 'onyx-smoke-reject',
				command: `type "${outsidePath}"`,
				cwd: workspaceRoot,
				workspaceFolders: [workspaceRoot],
				timeoutMs: 5000,
				maxOutputChars: 1000,
			}),
			/current workspace/
		);
	});
});
