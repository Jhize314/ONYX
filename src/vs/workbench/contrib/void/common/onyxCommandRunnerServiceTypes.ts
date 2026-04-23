/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface OnyxRunCommandParams {
	requestId: string;
	command: string;
	cwd: string;
	workspaceFolders: string[];
	timeoutMs: number;
	maxOutputChars: number;
}

export interface OnyxRunCommandResult {
	output: string;
	exitCode: number;
	timedOut: boolean;
}

export interface IOnyxCommandRunnerService {
	readonly _serviceBrand: undefined;
	runCommand(params: OnyxRunCommandParams): Promise<OnyxRunCommandResult>;
	abortCommand(requestId: string): Promise<void>;
}

export const IOnyxCommandRunnerService = createDecorator<IOnyxCommandRunnerService>('OnyxCommandRunnerService');
