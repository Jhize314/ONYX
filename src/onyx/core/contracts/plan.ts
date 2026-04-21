import type { PlanStep } from './planStep.js';

export type PlanStatus =
	| 'draft'
	| 'revision_candidate'
	| 'approved'
	| 'stale_approval'
	| 'executing'
	| 'executed'
	| 'failed';

export interface ScopeEnvelopeSummary {
	allowedPaths: string[];
	allowedOperations: string[];
	restrictedOperations: string[];
}

export interface Plan {
	taskId: string;
	planId: string;
	version: number;
	status: PlanStatus;
	parentVersion: number | null;
	title: string;
	objective: string;
	assumptions: string[];
	scopeEnvelopeSummary: ScopeEnvelopeSummary;
	steps: PlanStep[];
	risks: string[];
	revisionNotes: string;
	createdAt: string;
	updatedAt: string;
	markdownPath: string;
	contentHash: string;
}