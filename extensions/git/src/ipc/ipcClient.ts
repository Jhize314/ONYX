/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';
import { buffersToUint8Arrays, concatUint8Arrays } from '../bufferUtils';

export class IPCClient {

	private ipcHandlePath: string;

	constructor(private handlerName: string) {
		const ipcHandlePath = process.env['VSCODE_GIT_IPC_HANDLE'];

		if (!ipcHandlePath) {
			throw new Error('Missing VSCODE_GIT_IPC_HANDLE');
		}

		this.ipcHandlePath = ipcHandlePath;
	}

	call(request: any): Promise<any> {
		const opts: http.RequestOptions = {
			socketPath: this.ipcHandlePath,
			path: `/${this.handlerName}`,
			method: 'POST'
		};

		return new Promise((c, e) => {
			const req = http.request(opts, res => {
				if (res.statusCode !== 200) {
					return e(new Error(`Bad status code: ${res.statusCode}`));
				}

				const chunks: Buffer[] = [];
				res.on('data', d => chunks.push(d));
				res.on('end', () => {
					const merged = concatUint8Arrays(buffersToUint8Arrays(chunks));
					c(JSON.parse(Buffer.from(merged).toString('utf8')));
				});
			});

			req.on('error', err => e(err));
			req.write(JSON.stringify(request));
			req.end();
		});
	}
}