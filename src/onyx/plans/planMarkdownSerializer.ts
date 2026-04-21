import type { Plan } from '../core/contracts/plan.js';

export function serializePlanToMarkdown(plan: Plan): string {
	const assumptions = plan.assumptions.length
		? plan.assumptions.map(a => `- ${a}`).join('\n')
		: '- None';

	const allowedPaths = plan.scopeEnvelopeSummary.allowedPaths.length
		? plan.scopeEnvelopeSummary.allowedPaths.map(p => `  - ${p}`).join('\n')
		: '  - none';

	const allowedOps = plan.scopeEnvelopeSummary.allowedOperations.length
		? plan.scopeEnvelopeSummary.allowedOperations.map(op => `  - ${op}`).join('\n')
		: '  - none';

	const restrictedOps = plan.scopeEnvelopeSummary.restrictedOperations.length
		? plan.scopeEnvelopeSummary.restrictedOperations.map(op => `  - ${op}`).join('\n')
		: '  - none';

	const steps = plan.steps.map((step, i) => {
		const dependsOn = step.dependsOn.length ? step.dependsOn.join(', ') : 'none';
		const outputs = step.expectedOutputs.length
			? step.expectedOutputs.map(o => `  - ${o}`).join('\n')
			: '  - none';

		return [
			`### Step ${i + 1}`,
			`- ID: ${step.stepId}`,
			`- Type: ${step.type}`,
			`- Title: ${step.title}`,
			`- Depends On: ${dependsOn}`,
			`- Approval Class: ${step.approvalClass}`,
			`- Status: ${step.status}`,
			`- Expected Outputs:`,
			outputs
		].join('\n');
	}).join('\n\n');

	const risks = plan.risks.length
		? plan.risks.map(r => `- ${r}`).join('\n')
		: '- None';

	return [
		`# Plan: ${plan.title}`,
		``,
		`- Task ID: ${plan.taskId}`,
		`- Plan ID: ${plan.planId}`,
		`- Version: ${plan.version}`,
		`- Status: ${plan.status}`,
		`- Parent Version: ${plan.parentVersion === null ? 'none' : plan.parentVersion}`,
		``,
		`## Objective`,
		`${plan.objective}`,
		``,
		`## Assumptions`,
		`${assumptions}`,
		``,
		`## Scope Envelope Summary`,
		`- Allowed Paths:`,
		`${allowedPaths}`,
		`- Allowed Operations:`,
		`${allowedOps}`,
		`- Restricted Operations:`,
		`${restrictedOps}`,
		``,
		`## Steps`,
		`${steps}`,
		``,
		`## Risks`,
		`${risks}`,
		``,
		`## Revision Notes`,
		`${plan.revisionNotes || 'Initial version'}`,
		``
	].join('\n');
}