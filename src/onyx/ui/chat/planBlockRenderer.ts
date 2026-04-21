import type { Plan } from '../../core/contracts/plan.js';

export interface PlanBlockViewModel {
	kind: 'plan_block';
	taskId: string;
	planId: string;
	version: number;
	title: string;
	objective: string;
	status: string;
	stepCount: number;
	markdownPath: string;
	actions: Array<'open_plan' | 'compare' | 'request_revision' | 'approve_plan'>;
}

export function renderPlanBlock(plan: Plan): PlanBlockViewModel {
	return {
		kind: 'plan_block',
		taskId: plan.taskId,
		planId: plan.planId,
		version: plan.version,
		title: plan.title,
		objective: plan.objective,
		status: plan.status,
		stepCount: plan.steps.length,
		markdownPath: plan.markdownPath,
		actions: ['open_plan', 'compare', 'request_revision', 'approve_plan']
	};
}