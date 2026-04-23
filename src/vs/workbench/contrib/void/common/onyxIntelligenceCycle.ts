/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import type { ChatMode } from './voidSettingsTypes.js';

export type OnyxIntelligencePhase = 'chat' | 'plan' | 'collect' | 'analyze' | 'report' | 'execute';

export interface OnyxModeResolution {
	selectedChatMode: ChatMode;
	activeChatMode: ChatMode;
	activePhase: OnyxIntelligencePhase;
	wasInferred: boolean;
	reason: string;
}

const phaseOfChatMode = {
	agent: 'execute',
	gather: 'collect',
	normal: 'chat',
	plan: 'plan',
	collect: 'collect',
	analyze: 'analyze',
	report: 'report',
} satisfies Record<ChatMode, OnyxIntelligencePhase>;

const phaseDisplayName = {
	chat: 'Chat',
	plan: 'Plan',
	collect: 'Collect',
	analyze: 'Analyze',
	report: 'Report',
	execute: 'Execute',
} satisfies Record<OnyxIntelligencePhase, string>;

const modeDisplayName = {
	agent: 'Execute',
	gather: 'Gather',
	normal: 'Chat',
	plan: 'Plan',
	collect: 'Collect',
	analyze: 'Analyze',
	report: 'Report',
} satisfies Record<ChatMode, string>;

function normalizePrompt(prompt: string): string {
	return prompt.trim().replace(/\s+/g, ' ').toLowerCase();
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
	return patterns.some(pattern => pattern.test(text));
}

const reportPatterns = [
	/\b(report|brief|write-?up|status update|executive summary|final answer|findings)\b/,
	/\b(what did (you|we) find|what changed|where (do|did) we land)\b/,
];

const analyzePatterns = [
	/\b(analy[sz]e|analysis|compare|evaluate|assess|rank|score|weigh|trade-?off|pros and cons|risk|risks|summari[sz]e|summary)\b/,
	/\b(best|better|strongest|weakest|recommend|recommendation|decide|decision|choose|which)\b/,
	/\b(narrow (this|these|them) down|shortlist|option|options|candidate|candidates)\b/,
];

const planPatterns = [
	/\b(plan|strategy|roadmap|approach|break down|decompose|sequence|milestone|scope|design)\b/,
	/\b(requirement|requirements|collection requirement|success criteria|next steps?)\b/,
	/\b(how should (we|i)|what'?s the path|before (we|i) start)\b/,
];

const collectPatterns = [
	/\b(collect|gather|find|search|look up|discover|locate|identify|source|retrieve|inspect|read|verify|research)\b/,
	/\b(api|apis|documentation|docs|resource|resources|evidence|sources|files|references)\b/,
];

const executePatterns = [
	/\b(execute|implement|make the change|make changes|apply the change|apply changes|do it|run it|start working|take action)\b/,
	/\b(fix|patch|edit|modify|delete|remove|rename|move|refactor|commit|push)\b/,
	/\b(run|write|create|update)\s+(the\s+)?(code|file|files|script|scripts|component|function|class|test|tests|repo|project|implementation|patch|command|commands)\b/,
];

const nextPatterns = [
	/\b(next|next step|continue|proceed|go ahead|move on|carry on|advance|keep going)\b/,
];

function inferActiveChatModeFromPrompt(prompt: string): { mode: ChatMode; reason: string } {
	const text = normalizePrompt(prompt);

	if (!text) {
		return { mode: 'normal', reason: 'No prompt content to classify.' };
	}

	if (matchesAny(text, executePatterns)) {
		return { mode: 'agent', reason: 'The request asks ONYX to execute, edit, run, or otherwise take action in the workspace.' };
	}

	if (matchesAny(text, reportPatterns)) {
		return { mode: 'report', reason: 'The request asks for a report, summary, findings, or final deliverable.' };
	}

	if (matchesAny(text, analyzePatterns)) {
		return { mode: 'analyze', reason: 'The request asks ONYX to compare, evaluate, rank, decide, or recommend.' };
	}

	if (matchesAny(text, planPatterns)) {
		return { mode: 'plan', reason: 'The request asks ONYX to plan, scope, sequence, or define requirements.' };
	}

	if (matchesAny(text, collectPatterns)) {
		return { mode: 'collect', reason: 'The request asks ONYX to gather, identify, verify, or inspect resources.' };
	}

	return { mode: 'normal', reason: 'The request fits ordinary chat.' };
}

function nextModeAfter(chatMode: ChatMode): ChatMode {
	if (chatMode === 'plan') return 'collect';
	if (chatMode === 'collect' || chatMode === 'gather') return 'analyze';
	if (chatMode === 'analyze') return 'report';
	if (chatMode === 'report') return 'agent';
	return 'agent';
}

function resolveExplicitModeTransition({
	selectedChatMode,
	userMessage,
}: {
	selectedChatMode: ChatMode;
	userMessage: string;
}): { mode: ChatMode; reason: string } | null {
	const text = normalizePrompt(userMessage);
	if (!text) {
		return null;
	}

	if (matchesAny(text, executePatterns)) {
		return {
			mode: 'agent',
			reason: `${getOnyxChatModeDisplayName(selectedChatMode)} mode received an execute/action request, so ONYX advanced to Execute with normal workspace approval gates.`,
		};
	}

	const inferred = inferActiveChatModeFromPrompt(userMessage);
	if (inferred.mode !== 'normal' && inferred.mode !== selectedChatMode) {
		return {
			mode: inferred.mode,
			reason: `${getOnyxChatModeDisplayName(selectedChatMode)} mode received a ${getOnyxChatModeDisplayName(inferred.mode)} request. ${inferred.reason}`,
		};
	}

	if (matchesAny(text, nextPatterns)) {
		const mode = nextModeAfter(selectedChatMode);
		return {
			mode,
			reason: `${getOnyxChatModeDisplayName(selectedChatMode)} mode received a next-step request, so ONYX advanced to ${getOnyxChatModeDisplayName(mode)}.`,
		};
	}

	return null;
}

export function getOnyxIntelligencePhase(chatMode: ChatMode): OnyxIntelligencePhase {
	return phaseOfChatMode[chatMode];
}

export function getOnyxPhaseDisplayName(phase: OnyxIntelligencePhase): string {
	return phaseDisplayName[phase];
}

export function getOnyxChatModeDisplayName(chatMode: ChatMode): string {
	return modeDisplayName[chatMode];
}

export function resolveOnyxChatMode({
	selectedChatMode,
	userMessage,
}: {
	selectedChatMode: ChatMode;
	userMessage: string;
}): OnyxModeResolution {
	if (selectedChatMode !== 'normal') {
		const transition = resolveExplicitModeTransition({ selectedChatMode, userMessage });
		if (transition) {
			return {
				selectedChatMode,
				activeChatMode: transition.mode,
				activePhase: getOnyxIntelligencePhase(transition.mode),
				wasInferred: transition.mode !== selectedChatMode,
				reason: transition.reason,
			};
		}

		return {
			selectedChatMode,
			activeChatMode: selectedChatMode,
			activePhase: getOnyxIntelligencePhase(selectedChatMode),
			wasInferred: false,
			reason: `${getOnyxChatModeDisplayName(selectedChatMode)} mode was selected explicitly.`,
		};
	}

	const inferred = inferActiveChatModeFromPrompt(userMessage);
	return {
		selectedChatMode,
		activeChatMode: inferred.mode,
		activePhase: getOnyxIntelligencePhase(inferred.mode),
		wasInferred: inferred.mode !== selectedChatMode,
		reason: inferred.reason,
	};
}
