export interface OnyxGeneratedPlan {
	title: string;
	objective: string;
	context: string[];
	requirements: string[];
	collectionRequirements: string[];
	phases: Array<{
		name: string;
		steps: string[];
	}>;
	risks: string[];
	deliverables: string[];
}

function normalizePrompt(prompt: string): string {
	return prompt.trim().replace(/\s+/g, ' ');
}

function extractPlanSubject(prompt: string): string {
	const text = normalizePrompt(prompt);

	const patterns = [
		/^write a plan for\s+/i,
		/^create a plan for\s+/i,
		/^build a plan for\s+/i,
		/^draft a plan for\s+/i,
		/^generate a plan for\s+/i,
		/^make a plan for\s+/i,
		/^start a plan for\s+/i,
		/^plan\s+/i,
	];

	for (const pattern of patterns) {
		if (pattern.test(text)) {
			return text.replace(pattern, '').trim();
		}
	}

	return text;
}

function titleCase(value: string): string {
	return value
		.split(/\s+/)
		.map(word => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

export function generateOnyxPlanFromPrompt(prompt: string): OnyxGeneratedPlan {
	const normalizedPrompt = normalizePrompt(prompt);
	const subject = extractPlanSubject(normalizedPrompt) || 'System Initiative';
	const titledSubject = titleCase(subject);

	const title = `${titledSubject} Plan`;

	const objective = `Define and execute a structured implementation plan for ${subject}.`;

	const context = [
		`This plan was generated from the prompt: "${normalizedPrompt}".`,
		`The plan is intended to be executed inside ONYX as a governed systems design and execution workflow.`,
		`The initial output should be treated as a working draft that can later evolve through requirements, collection, analysis, and reporting stages.`
	];

	const requirements = [
		`Clarify the scope and intended outcome for ${subject}.`,
		`Identify the relevant system surfaces, files, services, and dependencies.`,
		`Define implementation boundaries, constraints, and success criteria.`,
		`Prepare the work so it can move through Plan, Collect, Analyze, and Report as an intelligence cycle.`
	];

	const collectionRequirements = [
		`Determine which files, services, commands, APIs, docs, or examples must be collected for ${subject}.`,
		`Identify provenance requirements so collected evidence can be traced back to concrete sources.`,
		`Define what evidence would be sufficient to analyze options and make a recommendation.`,
		`List gaps or uncertainties that should cause Report mode to feed back into a revised plan.`
	];

	const phases = [
		{
			name: 'Plan',
			steps: [
				`Define the purpose and success criteria for ${subject}.`,
				`Identify assumptions, constraints, and non-goals.`,
				`Determine which parts of ONYX or the current workspace are affected.`,
				`Write the collection requirements that Collect mode must satisfy.`
			]
		},
		{
			name: 'Collect',
			steps: [
				`Locate files, services, commands, and UI surfaces related to ${subject}.`,
				`Gather references, prior implementations, and current system behavior.`,
				`Record evidence with provenance and map it back to the collection requirements.`
			]
		},
		{
			name: 'Analyze',
			steps: [
				`Evaluate the collected material for architecture impact and execution risk.`,
				`Compare implementation options and identify the simplest viable approach.`,
				`Decide how ${subject} should integrate into ONYX without breaking current behavior.`,
				`Identify any missing evidence that should return the cycle to Collect or Plan.`
			]
		},
		{
			name: 'Implement',
			steps: [
				`Create or modify the required files and services for ${subject}.`,
				`Keep the implementation scoped, testable, and compatible with ONYX conventions.`,
				`Verify that the implementation works through the intended ONYX entry points.`
			]
		},
		{
			name: 'Report',
			steps: [
				`Summarize what changed, what was validated, and what remains open.`,
				`Document artifacts created during the work on ${subject}.`,
				`Define the next recommended step after the initial implementation.`,
				`Feed unresolved gaps, changed assumptions, or stronger options back into Plan mode.`
			]
		}
	];

	const risks = [
		`Scope drift if ${subject} is implemented without explicit boundaries.`,
		`Integration complexity if the current ONYX workflow is bypassed instead of extended.`,
		`Inconsistent behavior if command, chat, and future mode-based flows are not routed through shared services.`
	];

	const deliverables = [
		`A structured implementation plan for ${subject}.`,
		`A persisted ONYX markdown artifact representing the current plan state.`,
		`A foundation for recursive Plan, Collect, Analyze, and Report modes.`
	];

	return {
		title,
		objective,
		context,
		requirements,
		collectionRequirements,
		phases,
		risks,
		deliverables
	};
}

export function renderOnyxPlanMarkdown(prompt: string): string {
	const plan = generateOnyxPlanFromPrompt(prompt);

	const contextSection = plan.context.map(item => `- ${item}`).join('\n');
	const requirementsSection = plan.requirements.map(item => `- ${item}`).join('\n');
	const collectionRequirementsSection = plan.collectionRequirements.map(item => `- ${item}`).join('\n');
	const risksSection = plan.risks.map(item => `- ${item}`).join('\n');
	const deliverablesSection = plan.deliverables.map(item => `- ${item}`).join('\n');

	const phasesSection = plan.phases.map((phase, idx) => {
		const steps = phase.steps.map(step => `- [ ] ${step}`).join('\n');
		return `## Phase ${idx + 1}: ${phase.name}\n${steps}`;
	}).join('\n\n');

	return `# ${plan.title}

## Objective
${plan.objective}

## Context
${contextSection}

## Requirements
${requirementsSection}

## Collection Requirements
${collectionRequirementsSection}

${phasesSection}

## Risks
${risksSection}

## Deliverables
${deliverablesSection}

## Notes
This plan workspace was generated by ONYX from the current user request.
`;
}
