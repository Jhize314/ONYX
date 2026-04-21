/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Transform } from 'stream';

export const splitNewLines = () => new StreamSplitter('\n'.charCodeAt(0));

/**
 * Copied and simplified from src\vs\base\node\nodeStreams.ts
 *
 * Exception: does not include the split character in the output.
 */
export class StreamSplitter extends Transform {
	private buffer: Uint8Array | undefined;

	constructor(private readonly splitter: number) {
		super();
	}

	override _transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: any) => void): void {
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
		while (offset < this.buffer.length) {
			const index = this.buffer.indexOf(this.splitter, offset);
			if (index === -1) {
				break;
			}

			this.push(this.buffer.subarray(offset, index));
			offset = index + 1;
		}

		this.buffer = offset === this.buffer.length ? undefined : this.buffer.subarray(offset);
		callback();
	}

	override _flush(callback: (error?: Error | null, data?: any) => void): void {
		if (this.buffer) {
			this.push(this.buffer);
		}
		callback();
	}
}