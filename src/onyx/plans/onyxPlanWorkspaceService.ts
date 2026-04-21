import { VSBuffer } from '../../vs/base/common/buffer.js';
import { URI } from '../../vs/base/common/uri.js';
import { IFileService } from '../../vs/platform/files/common/files.js';
import { IEditorService } from '../../vs/workbench/services/editor/common/editorService.js';
import { renderOnyxPlanMarkdown } from './onyxPlanGenerator.js';

export class OnyxPlanWorkspaceService {
	constructor(
		private readonly fileService: IFileService,
		private readonly editorService: IEditorService
	) {}

	async createInitialPlan(workspaceRootFsPath: string, prompt: string): Promise<URI> {
		const workspaceRoot = URI.file(workspaceRootFsPath);

		const plansFolder = URI.joinPath(workspaceRoot, '.onyx', 'plans');
		const fileUri = URI.joinPath(plansFolder, 'ONYX_PLAN.md');

		const markdown = renderOnyxPlanMarkdown(prompt);

		await this.fileService.createFolder(plansFolder);

		await this.fileService.writeFile(
			fileUri,
			VSBuffer.fromString(markdown)
		);

		await this.editorService.openEditor({
			resource: fileUri
		});

		return fileUri;
	}

	async openExistingPlan(workspaceRootFsPath: string): Promise<URI> {
		const workspaceRoot = URI.file(workspaceRootFsPath);
		const fileUri = URI.joinPath(workspaceRoot, '.onyx', 'plans', 'ONYX_PLAN.md');

		await this.editorService.openEditor({
			resource: fileUri
		});

		return fileUri;
	}
}