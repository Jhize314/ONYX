export function shouldCreatePlanWorkspaceFromPrompt(prompt: string): boolean {
	const text = prompt.trim().toLowerCase();

	const patterns = [
		'create plan workspace',
		'make a plan',
		'start a plan',
		'create onyx plan',
		'create a plan',
		'write a plan',
		'build a plan'
	];

	return patterns.some(pattern => text.includes(pattern));
}

export function shouldOpenExistingPlanFromPrompt(prompt: string): boolean {
	const text = prompt.trim().toLowerCase();

	const patterns = [
		'show me the plan',
		'open the plan',
		'open plan',
		'show the plan',
		'view the plan',
		'view plan'
	];

	return patterns.some(pattern => text.includes(pattern));
}