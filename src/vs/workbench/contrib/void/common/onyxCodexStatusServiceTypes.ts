/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export interface OnyxCodexRateLimitWindow {
	usedPercent: number;
	windowMinutes: number;
	resetsAt: number | null;
}

export interface OnyxCodexCredits {
	hasCredits: boolean;
	unlimited: boolean;
	balance: string | null;
}

export type OnyxCodexRateLimitsResult = {
	status: 'available';
	capturedAt: number | null;
	primary: OnyxCodexRateLimitWindow | null;
	secondary: OnyxCodexRateLimitWindow | null;
	credits: OnyxCodexCredits | null;
} | {
	status: 'unavailable';
	detail: string;
};

export interface IOnyxCodexStatusService {
	readonly _serviceBrand: undefined;
	getRateLimits(): Promise<OnyxCodexRateLimitsResult>;
}

export const IOnyxCodexStatusService = createDecorator<IOnyxCodexStatusService>('OnyxCodexStatusService');
