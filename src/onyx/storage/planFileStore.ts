import * as fs from 'fs';
import * as path from 'path';

export interface PlanFileStoreResult {
	markdownPath: string;
	absolutePath: string;
}

export class PlanFileStore {
	constructor(private readonly workspaceRoot: string) {}

	ensureTaskPlanFolder(taskId: string): string {
		const folder = path.join(this.workspaceRoot, '.onyx', 'tasks', taskId, 'plans');
		fs.mkdirSync(folder, { recursive: true });
		return folder;
	}

	getPlanFilename(version: number): string {
		return `plan_v${String(version).padStart(3, '0')}.md`;
	}

	writePlanMarkdown(taskId: string, version: number, markdown: string): PlanFileStoreResult {
		const folder = this.ensureTaskPlanFolder(taskId);
		const filename = this.getPlanFilename(version);
		const absolutePath = path.join(folder, filename);

		fs.writeFileSync(absolutePath, markdown, 'utf8');

		return {
			markdownPath: path.join('.onyx', 'tasks', taskId, 'plans', filename),
			absolutePath
		};
	}
}