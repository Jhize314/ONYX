export type TaskStatus =
	| 'draft'
	| 'planned'
	| 'collecting'
	| 'analyzing'
	| 'awaiting_approval'
	| 'approved'
	| 'executing'
	| 'reporting'
	| 'complete'
	| 'failed'
	| 'blocked';

export interface Task {
	taskId: string;
	title: string;
	intent: string;
	status: TaskStatus;
	currentPlanVersion: number | null;
	createdAt: string;
	updatedAt: string;
}