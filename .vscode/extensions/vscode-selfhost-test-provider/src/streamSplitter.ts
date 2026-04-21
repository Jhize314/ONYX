/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *--------------------------------------------------------------------------------------------*/

import { Transform, TransformCallback } from 'stream';

export class StreamSplitter extends Transform {
	private buffer: Uint8Array | undefined;

	constructor(private readonly splitter: number) {
		super();
	}

	override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
		const chunkBytes = Uint8Array.from(chunk);

		if (!this.buffer) {
			this.buffer = chunkBytes;
		} else {
			const merged = new Uint8Array(this.buffer.length + chunkBytes.length);
			merged.set(this.buffer, 0);
			merged.set(chunkBytes, this.buffer.length);
			this.buffer = merged;
		}

		let offset = 0;
		while (this.buffer && offset < this.buffer.length) {
			const index = this.buffer.indexOf(this.splitter, offset);
			if (index === -1) {
				break;
			}

			this.push(this.buffer.subarray(offset, index));
			offset = index + 1;
		}

		this.buffer = this.buffer && offset === this.buffer.length
			? undefined
			: this.buffer?.subarray(offset);

		callback();
	}

	override _flush(callback: TransformCallback): void {
		if (this.buffer && this.buffer.length) {
			this.push(this.buffer);
		}
		this.buffer = undefined;
		callback();
	}
}