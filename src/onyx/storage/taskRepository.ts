import type { Task } from '../core/contracts/task.js';

export class TaskRepository {
	private readonly tasks = new Map<string, Task>();

	save(task: Task): void {
		this.tasks.set(task.taskId, task);
	}

	get(taskId: string): Task | null {
		return this.tasks.get(taskId) ?? null;
	}

	list(): Task[] {
		return [...this.tasks.values()];
	}
}