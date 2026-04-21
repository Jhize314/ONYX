import type { Plan } from '../core/contracts/plan.js';

export class PlanRepository {
	private readonly plans = new Map<string, Plan[]>();

	save(plan: Plan): void {
		const key = plan.taskId;
		const existing = this.plans.get(key) ?? [];
		const withoutSameVersion = existing.filter(p => p.version !== plan.version);

		withoutSameVersion.push(plan);
		withoutSameVersion.sort((a, b) => a.version - b.version);

		this.plans.set(key, withoutSameVersion);
	}

	getByTask(taskId: string): Plan[] {
		return this.plans.get(taskId) ?? [];
	}

	getLatestByTask(taskId: string): Plan | null {
		const plans = this.plans.get(taskId) ?? [];
		return plans.length ? plans[plans.length - 1] : null;
	}

	getVersion(taskId: string, version: number): Plan | null {
		const plans = this.plans.get(taskId) ?? [];
		return plans.find(p => p.version === version) ?? null;
	}
}