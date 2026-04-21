export type PlanStepType =
	| 'design'
	| 'collection'
	| 'analysis'
	| 'implementation'
	| 'verification'
	| 'approval'
	| 'execution'
	| 'reporting';

export type ApprovalClass =
	| 'ReadOnly'
	| 'LocalMutation'
	| 'ShellExec'
	| 'ShellExecMutating'
	| 'GitSafeRead'
	| 'HighRisk';

export type PlanStepStatus =
	| 'pending'
	| 'ready'
	| 'blocked'
	| 'complete'
	| 'failed';

export interface PlanStep {
	stepId: string;
	title: string;
	type: PlanStepType;
	dependsOn: string[];
	approvalClass: ApprovalClass;
	expectedOutputs: string[];
	status: PlanStepStatus;
}