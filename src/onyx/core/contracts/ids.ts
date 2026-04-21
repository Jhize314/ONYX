export function nowIso(): string {
	return new Date().toISOString();
}

export function makeTaskId(counter: number): string {
	return `task_${String(counter).padStart(4, '0')}`;
}

export function makePlanId(counter: number): string {
	return `plan_${String(counter).padStart(4, '0')}`;
}

export function makeStepId(counter: number): string {
	return `step_${String(counter).padStart(3, '0')}`;
}