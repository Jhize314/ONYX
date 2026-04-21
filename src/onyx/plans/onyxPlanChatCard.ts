export interface OnyxPlanChatCard {
	kind: 'onyx_plan_workspace_created';
	title: string;
	path: string;
	message: string;
	actions: Array<'open_plan'>;
}

export function createOnyxPlanChatCard(path: string): OnyxPlanChatCard {
	return {
		kind: 'onyx_plan_workspace_created',
		title: 'Plan Workspace Created',
		path,
		message: 'ONYX created and opened the plan workspace.',
		actions: ['open_plan']
	};
}