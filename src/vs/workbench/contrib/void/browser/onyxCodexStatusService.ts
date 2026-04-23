/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { ProxyChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IMainProcessService } from '../../../../platform/ipc/common/mainProcessService.js';
import { IOnyxCodexStatusService, OnyxCodexRateLimitsResult } from '../common/onyxCodexStatusServiceTypes.js';

class OnyxCodexStatusService implements IOnyxCodexStatusService {
	readonly _serviceBrand: undefined;
	private readonly codexStatus: IOnyxCodexStatusService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
	) {
		this.codexStatus = ProxyChannel.toService<IOnyxCodexStatusService>(mainProcessService.getChannel('void-channel-onyx-codex-status'));
	}

	getRateLimits(): Promise<OnyxCodexRateLimitsResult> {
		return this.codexStatus.getRateLimits();
	}
}

registerSingleton(IOnyxCodexStatusService, OnyxCodexStatusService, InstantiationType.Delayed);
