import { nowIso, makePlanId, makeStepId, makeTaskId } from '../../core/contracts/ids.js';
import type { Task } from '../../core/contracts/task.js';
import type { Plan } from '../../core/contracts/plan.js';
import type { PlanStep } from '../../core/contracts/planStep.js';
import { serializePlanToMarkdown } from '../../plans/planMarkdownSerializer.js';
import { sha256Text } from '../../storage/contentHash.js';
import { PlanFileStore } from '../../storage/planFileStore.js';
import { PlanRepository } from '../../storage/planRepository.js';
import { TaskRepository } from '../../storage/taskRepository.js';

export interface CreateInitialPlanInput {
	workspaceRoot: string;
	taskTitle: string;
	intent: string;
}

export class PlanWorkspaceService {
	private static taskCounter = 1;
	private static planCounter = 1;

	constructor(
		private readonly taskRepository: TaskRepository,
		private readonly planRepository: PlanRepository
	) {}

	async createInitialTaskAndPlan(input: CreateInitialPlanInput): Promise<{ task: Task; plan: Plan; absolutePath: string }> {
		const taskId = makeTaskId(PlanWorkspaceService.taskCounter++);
		const planId = makePlanId(PlanWorkspaceService.planCounter++);
		const createdAt = nowIso();

		const task: Task = {
			taskId,
			title: input.taskTitle,
			intent: input.intent,
			status: 'planned',
			currentPlanVersion: 1,
			createdAt,
			updatedAt: createdAt
		};

		const defaultSteps: PlanStep[] = [
			{
				stepId: makeStepId(1),
				title: 'Define implementation approach',
				type: 'design',
				dependsOn: [],
				approvalClass: 'ReadOnly',
				expectedOutputs: ['implementation approach summary'],
				status: 'pending'
			},
			{
				stepId: makeStepId(2),
				title: 'Identify files and system surfaces to change',
				type: 'collection',
				dependsOn: [makeStepId(1)],
				approvalClass: 'ReadOnly',
				expectedOutputs: ['candidate file list'],
				status: 'pending'
			},
			{
				stepId: makeStepId(3),
				title: 'Prepare implementation changes',
				type: 'implementation',
				dependsOn: [makeStepId(2)],
				approvalClass: 'LocalMutation',
				expectedOutputs: ['file diffs', 'updated files'],
				status: 'pending'
			}
		];

		const draftPlanBase: Omit<Plan, 'markdownPath' | 'contentHash'> = {
			taskId,
			planId,
			version: 1,
			status: 'draft',
			parentVersion: null,
			title: input.taskTitle,
			objective: input.intent,
			assumptions: [
				'ONYX remains local-first in V1',
				'No execution occurs without explicit approval'
			],
			scopeEnvelopeSummary: {
				allowedPaths: ['src/**', 'resources/**', '.onyx/**'],
				allowedOperations: ['read', 'write', 'diff'],
				restrictedOperations: ['delete outside workspace', 'network installs', 'git push']
			},
			steps: defaultSteps,
			risks: [
				'Scope drift if plan changes are not versioned',
				'UI clutter if plan rendering is not structured'
			],
			revisionNotes: 'Initial version',
			createdAt,
			updatedAt: createdAt
		};

		const tempPlan: Plan = {
			...draftPlanBase,
			markdownPath: '',
			contentHash: ''
		};

		const markdown = serializePlanToMarkdown(tempPlan);
		const fileStore = new PlanFileStore(input.workspaceRoot);
		const { markdownPath, absolutePath } = fileStore.writePlanMarkdown(taskId, 1, markdown);
		const contentHash = await sha256Text(markdown);

		const finalPlan: Plan = {
			...draftPlanBase,
			markdownPath,
			contentHash
		};

		this.taskRepository.save(task);
		this.planRepository.save(finalPlan);

		return { task, plan: finalPlan, absolutePath };
	}
}