import { IDisposable } from './dispose';

export interface RendererContext {
	setState?(state: unknown): void;
	getState?(): unknown;
}

export interface OutputItem {
	id: string;
	mime: string;
	data(): Uint8Array;
	text?(): string;
	json?(): unknown;
}

export interface NotebookRenderer {
	renderOutputItem(
		outputItem: OutputItem,
		element: HTMLElement,
		context?: RendererContext
	): void | IDisposable;
}

function renderImage(outputInfo: OutputItem, element: HTMLElement): IDisposable {
	const data = outputInfo.data();

	const buffer = new ArrayBuffer(data.byteLength);
	new Uint8Array(buffer).set(data);

	const blob = new Blob([buffer], { type: outputInfo.mime });
	const src = URL.createObjectURL(blob);

	let img: HTMLImageElement;

	if (element.firstChild instanceof HTMLImageElement) {
		img = element.firstChild;
		img.src = src;
	} else {
		img = document.createElement('img');
		img.src = src;
		element.appendChild(img);
	}

	return {
		dispose: () => URL.revokeObjectURL(src)
	};
}

function renderText(outputInfo: OutputItem, element: HTMLElement): void {
	const pre = document.createElement('pre');

	pre.textContent =
		typeof outputInfo.text === 'function'
			? outputInfo.text()
			: new TextDecoder().decode(outputInfo.data());

	element.appendChild(pre);
}

function createRenderer(): NotebookRenderer {
	return {
		renderOutputItem(outputItem, element, _context?): void | IDisposable {
			if (outputItem.mime.startsWith('image/')) {
				return renderImage(outputItem, element);
			}

			renderText(outputItem, element);
			return undefined;
		}
	};
}

export function activate(_context?: unknown): NotebookRenderer {
	return createRenderer();
}

export default activate;