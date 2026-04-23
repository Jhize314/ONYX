/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IOnyxCommandRunnerService, OnyxRunCommandParams, OnyxRunCommandResult } from '../common/onyxCommandRunnerServiceTypes.js';

class OnyxCommandRunnerService implements IOnyxCommandRunnerService {
	readonly _serviceBrand: undefined;
	private readonly commandRunner: IOnyxCommandRunnerService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this.commandRunner = ProxyChannel.toService<IOnyxCommandRunnerService>(mainProcessService.getChannel('void-channel-onyx-command-runner'));
	}

	runCommand(params: OnyxRunCommandParams): Promise<OnyxRunCommandResult> {
		return this.commandRunner.runCommand(params);
	}

	abortCommand(requestId: string): Promise<void> {
		return this.commandRunner.abortCommand(requestId);
	}
}

registerSingleton(IOnyxCommandRunnerService, OnyxCommandRunnerService, InstantiationType.Delayed);
