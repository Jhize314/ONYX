/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable no-restricted-globals */

(async function () {

	// Add a perf entry right from the top
	performance.mark('code/didStartRenderer');

	type INativeWindowConfiguration = import('../../../platform/window/common/window.ts').INativeWindowConfiguration;
	type IBootstrapWindow = import('../../../platform/window/electron-sandbox/window.js').IBootstrapWindow;
	type IMainWindowSandboxGlobals = import('../../../base/parts/sandbox/electron-sandbox/globals.js').IMainWindowSandboxGlobals;
	type IDesktopMain = import('../../../workbench/electron-sandbox/desktop.main.js').IDesktopMain;

	const bootstrapWindow: IBootstrapWindow = (window as any).MonacoBootstrapWindow;	// defined by bootstrap-window.ts
	const preloadGlobals: IMainWindowSandboxGlobals = (window as any).vscode;			// defined by preload.ts

	//#region Splash Screen Helpers

	function showSplash(configuration: INativeWindowConfiguration) {
		performance.mark('code/willShowPartsSplash');

		let data = configuration.partsSplash;
		if (data) {
			if (configuration.autoDetectHighContrast && configuration.colorScheme.highContrast) {
				if ((configuration.colorScheme.dark && data.baseTheme !== 'hc-black') || (!configuration.colorScheme.dark && data.baseTheme !== 'hc-light')) {
					data = undefined; // high contrast mode has been turned on by the OS -> ignore stored colors/layouts
				}
			} else if (configuration.autoDetectColorScheme) {
				if ((configuration.colorScheme.dark && data.baseTheme !== 'vs-dark') || (!configuration.colorScheme.dark && data.baseTheme !== 'vs')) {
					data = undefined; // OS color scheme is tracked and has changed
				}
			}
		}

		// Developing an extension -> ignore stored layouts
		if (data && configuration.extensionDevelopmentPath) {
			data.layoutInfo = undefined;
		}

		// Minimal theme/color setup
		let baseTheme: string | undefined;
		let shellBackground: string | undefined;
		let shellForeground: string | undefined;

		if (data) {
			baseTheme = data.baseTheme;
			shellBackground = data.colorInfo.editorBackground;
			shellForeground = data.colorInfo.foreground;
		} else if (configuration.autoDetectHighContrast && configuration.colorScheme.highContrast) {
			if (configuration.colorScheme.dark) {
				baseTheme = 'hc-black';
				shellBackground = '#000000';
				shellForeground = '#FFFFFF';
			} else {
				baseTheme = 'hc-light';
				shellBackground = '#FFFFFF';
				shellForeground = '#000000';
			}
		} else if (configuration.autoDetectColorScheme) {
			if (configuration.colorScheme.dark) {
				baseTheme = 'vs-dark';
				shellBackground = '#000000';
				shellForeground = '#CCCCCC';
			} else {
				baseTheme = 'vs';
				shellBackground = '#FFFFFF';
				shellForeground = '#000000';
			}
		}

		// Safe defaults
		baseTheme = baseTheme ?? 'vs-dark';
		shellBackground = shellBackground ?? '#000000';
		shellForeground = shellForeground ?? '#CCCCCC';

		const style = document.createElement('style');
		style.className = 'initialShellColors';
		window.document.head.appendChild(style);
		style.textContent = `
			html, body {
				background-color: ${shellBackground};
				color: ${shellForeground};
				margin: 0;
				padding: 0;
				width: 100%;
				height: 100%;
				overflow: hidden;
			}

			#monaco-parts-splash {
				position: fixed;
				inset: 0;
				display: flex;
				align-items: center;
				justify-content: center;
				background: #000000;
				z-index: 9999;
				user-select: none;
				-webkit-user-select: none;
			}

			#onyx-splash-logo {
				width: min(420px, 62vw);
				max-width: 62vw;
				height: auto;
				display: block;
				filter: drop-shadow(0 0 24px rgba(0, 0, 0, 0.55));
			}

			#onyx-splash-fallback {
				display: none;
				color: #E5E7EB;
				font-family: sans-serif;
				font-size: 28px;
				font-weight: 700;
				letter-spacing: 0.25em;
				text-transform: uppercase;
			}
		`;

		// Set zoom level as soon as possible
		if (typeof data?.zoomLevel === 'number' && typeof preloadGlobals?.webFrame?.setZoomLevel === 'function') {
			preloadGlobals.webFrame.setZoomLevel(data.zoomLevel);
		}

		const splash = document.createElement('div');
		splash.id = 'monaco-parts-splash';
		splash.className = baseTheme;

		const logo = document.createElement('img');
		logo.id = 'onyx-splash-logo';
		logo.alt = 'ONYX';

		const fallback = document.createElement('div');
		fallback.id = 'onyx-splash-fallback';
		fallback.textContent = 'ONYX';

		logo.onload = () => {
			console.log('[ONYX splash] logo loaded:', logo.src);
			fallback.style.display = 'none';
			logo.style.display = 'block';
		};

		logo.onerror = () => {
			console.warn('[ONYX splash] logo failed:', logo.src);
			logo.style.display = 'none';
			fallback.style.display = 'block';
		};

		splash.appendChild(logo);
		splash.appendChild(fallback);

		window.document.body.appendChild(splash);

		// Correct runtime-relative path for this workbench file:
		// out/vs/code/electron-sandbox/workbench/workbench.js
		// -> ../../../../../resources/app/ONYXlogo.png resolves to resources/app/ONYXlogo.png
		const logoPath = '../../../../../resources/app/ONYXlogo.png';
		console.log('[ONYX splash] trying logo:', logoPath);
		logo.src = logoPath;

		performance.mark('code/didShowPartsSplash');
	}

	//#endregion

	const { result, configuration } = await bootstrapWindow.load<IDesktopMain, INativeWindowConfiguration>('vs/workbench/workbench.desktop.main',
		{
			configureDeveloperSettings: function (windowConfig) {
				return {
					// Disable automated devtools opening on error when running extension tests
					// as this can lead to nondeterministic test execution (devtools steals focus)
					forceDisableShowDevtoolsOnError: typeof windowConfig.extensionTestsPath === 'string' || windowConfig['enable-smoke-test-driver'] === true,
					// Enable devtools keybindings in extension development window
					forceEnableDeveloperKeybindings: Array.isArray(windowConfig.extensionDevelopmentPath) && windowConfig.extensionDevelopmentPath.length > 0,
					removeDeveloperKeybindingsAfterLoad: true
				};
			},
			beforeImport: function (windowConfig) {

				// Show our splash as early as possible
				showSplash(windowConfig);

				// Code windows have a `vscodeWindowId` property to identify them
				Object.defineProperty(window, 'vscodeWindowId', {
					get: () => windowConfig.windowId
				});

				// Help the browser initialize canvas early
				window.requestIdleCallback(() => {
					const canvas = document.createElement('canvas');
					const context = canvas.getContext('2d');
					context?.clearRect(0, 0, canvas.width, canvas.height);
					canvas.remove();
				}, { timeout: 50 });

				// Track import() perf
				performance.mark('code/willLoadWorkbenchMain');
			}
		}
	);

	// Mark start of workbench
	performance.mark('code/didLoadWorkbenchMain');

	// Load workbench
	result.main(configuration);
}());
