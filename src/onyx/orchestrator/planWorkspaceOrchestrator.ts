import { PlanRepository } from '../storage/planRepository.js';
import { TaskRepository } from '../storage/taskRepository.js';
import { PlanWorkspaceService } from '../ui/plans/planWorkspaceService.js';
import { renderPlanBlock, type PlanBlockViewModel } from '../ui/chat/planBlockRenderer.js';

export interface CreatePlanWorkspaceResult {
	taskId: string;
	planVersion: number;
	planMarkdownAbsolutePath: string;
	planBlock: PlanBlockViewModel;
}

export class PlanWorkspaceOrchestrator {
	private readonly taskRepository = new TaskRepository();
	private readonly planRepository = new PlanRepository();
	private readonly planWorkspaceService = new PlanWorkspaceService(
		this.taskRepository,
		this.planRepository
	);

	async createInitialPlanWorkspace(workspaceRoot: string, taskTitle: string, intent: string): Promise<CreatePlanWorkspaceResult> {
		const { task, plan, absolutePath } = await this.planWorkspaceService.createInitialTaskAndPlan({
			workspaceRoot,
			taskTitle,
			intent
		});

		return {
			taskId: task.taskId,
			planVersion: plan.version,
			planMarkdownAbsolutePath: absolutePath,
			planBlock: renderPlanBlock(plan)
		};
	}
}