/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Based on @sergeche's work on the emmet plugin for atom

import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { imageSize } from 'image-size';
import { ISizeCalculationResult } from 'image-size/dist/types/interface';

const reUrl = /^https?:/;

export type ImageInfoWithScale = {
	realWidth: number;
	realHeight: number;
	width: number;
	height: number;
};

/**
 * Get size of given image file.
 * Supports files from local filesystem,
 * as well as URLs
 */
export function getImageSize(file: string): Promise<ImageInfoWithScale | undefined> {
	file = file.replace(/^file:\/\//, '');
	return reUrl.test(file) ? getImageSizeFromURL(file) : getImageSizeFromFile(file);
}

/**
 * Get image size from file on local file system
 */
function getImageSizeFromFile(file: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		const isDataUrl = file.match(/^data:.+?;base64,/);
		if (isDataUrl) {
			try {
				const data = Buffer.from(file.slice(isDataUrl[0].length), 'base64');
				return resolve(sizeForFileName('', imageSize(data)));
			} catch (err) {
				return reject(err);
			}
		}

		imageSize(file, (err: Error | null, size?: ISizeCalculationResult) => {
			if (err) {
				reject(err);
			} else {
				resolve(sizeForFileName(path.basename(file), size));
			}
		});
	});
}

/**
 * Get image size from given remote URL
 */
function getImageSizeFromURL(urlStr: string): Promise<ImageInfoWithScale | undefined> {
	return new Promise((resolve, reject) => {
		const url = new URL(urlStr);
		const getTransport = url.protocol === 'https:' ? https.get : http.get;

		if (!url.pathname) {
			return reject('Given url doesnt have pathname property');
		}

		const urlPath: string = url.pathname;

		getTransport(url, resp => {
			const chunks: Uint8Array[] = [];
			let bufSize = 0;

			const mergeChunks = (parts: readonly Uint8Array[], totalSize: number): Uint8Array => {
				const merged = new Uint8Array(totalSize);
				let offset = 0;

				for (const part of parts) {
					merged.set(part, offset);
					offset += part.length;
				}

				return merged;
			};

			const trySize = (parts: Uint8Array[]) => {
				try {
					const merged = mergeChunks(parts, bufSize);
					const size: ISizeCalculationResult = imageSize(Buffer.from(merged));

					resp.removeListener('data', onData);
					resp.destroy();

					resolve(sizeForFileName(path.basename(urlPath), size));
				} catch {
					// might not have enough data yet
				}
			};

			const onData = (chunk: Buffer) => {
				const bytes = Uint8Array.from(chunk);
				bufSize += bytes.length;
				chunks.push(bytes);
				trySize(chunks);
			};

			resp
				.on('data', onData)
				.on('end', () => trySize(chunks))
				.once('error', err => {
					resp.removeListener('data', onData);
					reject(err);
				});
		}).once('error', reject);
	});
}

/**
 * Returns size object for given file name.
 * If file name contains `@Nx` token,
 * the final dimensions will be downscaled by N
 */
function sizeForFileName(fileName: string, size?: ISizeCalculationResult): ImageInfoWithScale | undefined {
	const m = fileName.match(/@(\d+)x\./);
	const scale = m ? +m[1] : 1;

	if (!size || !size.width || !size.height) {
		return;
	}

	return {
		realWidth: size.width,
		realHeight: size.height,
		width: Math.floor(size.width / scale),
		height: Math.floor(size.height / scale)
	};
}