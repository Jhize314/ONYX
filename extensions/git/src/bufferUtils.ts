export function toUint8Array(buffer: Buffer): Uint8Array {
	return new Uint8Array(
		buffer.buffer as ArrayBuffer,
		buffer.byteOffset,
		buffer.byteLength
	);
}

export function buffersToUint8Arrays(buffers: readonly Buffer[]): Uint8Array[] {
	return buffers.map(toUint8Array);
}

export function concatUint8Arrays(arrays: readonly Uint8Array[]): Uint8Array {
	let total = 0;
	for (const a of arrays) {
		total += a.length;
	}

	const result = new Uint8Array(total);
	let offset = 0;

	for (const a of arrays) {
		result.set(a, offset);
		offset += a.length;
	}

	return result;
}