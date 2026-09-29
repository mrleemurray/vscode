/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const workspacePath = path.join(os.tmpdir(), 'corner-geometry-workspace');
const sharedDataPath = path.join(os.tmpdir(), 'corner-geometry-shared-data');
const imagePath = path.join(__dirname, 'issue-338687-images');
for (const directory of [workspacePath, sharedDataPath, imagePath]) {
	fs.mkdirSync(directory, { recursive: true });
}

async function geometry(page) {
	return page.evaluate(() => {
		const card = document.querySelector('.part.sessionspart.agents-part-card');
		const view = card?.querySelector('.session-view');
		if (!card || !view) {
			throw new Error('The sessions card and inner session view must be present.');
		}
		const outer = getComputedStyle(card);
		const inner = getComputedStyle(view);
		const frame = getComputedStyle(view, '::after');
		const rect = card.getBoundingClientRect();
		return {
			outer: [outer.borderBottomLeftRadius, outer.borderBottomRightRadius].map(Number.parseFloat),
			inner: [inner.borderBottomLeftRadius, inner.borderBottomRightRadius].map(Number.parseFloat),
			frame: [frame.borderBottomLeftRadius, frame.borderBottomRightRadius].map(Number.parseFloat),
			stroke: Number.parseFloat(inner.getPropertyValue('--vscode-strokeThickness')),
			normalRadius: Number.parseFloat(inner.getPropertyValue('--vscode-cornerRadius-large')),
			rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
		};
	});
}

async function capture(page, name) {
	const { rect } = await geometry(page);
	const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
	const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + 4));
	const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + 4));
	await page.screenshot({
		path: path.join(imagePath, `${name}.png`),
		clip: { x: right - 160, y: bottom - 160, width: 160, height: 160 },
		scale: 'css',
	});
	await page.screenshot({ path: path.join(imagePath, `${name}-window.png`), scale: 'css' });
}

module.exports = {
	id: 'issue-338687-connected-tab-corners',
	title: 'Connected-tabs borders follow exposed macOS card corners',
	source: 'https://github.com/microsoft/vscode/issues/338687',
	workspacePath,
	userSettings: {
		'workbench.experimental.modernUI': true,
		'workbench.experimental.modernUIEditorTabStyle': 'connected',
		'workbench.colorTheme': 'Default Light Modern',
		'workbench.startupEditor': 'none',
		'window.zoomLevel': 0,
	},
	extraArgs: ['--agents', `--shared-data-dir=${sharedDataPath}`],
	steps: [
		{
			id: 'prepare',
			title: 'Expose both bottom corners of a single session card',
			async run({ code, workbench }) {
				const page = await code.driver.waitForPage('/sessions-dev.html', 60000);
				code.driver.switchToWindow('/sessions-dev.html');
				await page.waitForSelector('.agent-sessions-workbench .session-view', { state: 'visible', timeout: 30000 });
				for (const [hiddenClass, command] of [
					['nopanel', 'workbench.action.togglePanel'],
					['noeditorpane', 'workbench.action.agentToggleSidePanel'],
					['nosidebar', 'workbench.action.toggleSidebarVisibility'],
				]) {
					if (!await page.locator(`.agent-sessions-workbench.${hiddenClass}`).count()) {
						await workbench.quickaccess.runCommand(command);
						await page.waitForSelector(`.agent-sessions-workbench.${hiddenClass}`, { timeout: 15000 });
					}
				}
				await page.waitForSelector('.agent-sessions-workbench.mac.macos-tahoe.modern-ui-tabs.modern-ui-connected-editor-tabs.nopanel.noeditorpane.nosidebar');
				return 'Native macOS window, connected tabs, panel/editor/sidebar hidden; both bottom corners are exposed.';
			},
		},
		{
			id: 'before',
			title: 'Before: reproduce the original fixed-radius inner border',
			async run({ page }) {
				await page.locator('.part.sessionspart .session-view').evaluateAll(views => {
					for (const view of views) {
						view.style.borderBottomLeftRadius = 'calc(var(--vscode-cornerRadius-large) - var(--vscode-strokeThickness))';
						view.style.borderBottomRightRadius = 'calc(var(--vscode-cornerRadius-large) - var(--vscode-strokeThickness))';
					}
				});
				const state = await geometry(page);
				assert.deepEqual(state.inner, [state.normalRadius - state.stroke, state.normalRadius - state.stroke]);
				assert.notDeepEqual(state.inner, state.outer.map(radius => Math.max(0, radius - state.stroke)));
				assert.deepEqual(state.frame, state.inner);
				await capture(page, 'before');
				return `Original inner radius ${state.inner[1]}px mismatches the exposed outer radius ${state.outer[1]}px. Baseline reproduced by disabling only the inner-corner fix in this same dev build.`;
			},
		},
		{
			id: 'after',
			title: 'After: restore the fix and verify concentric inner borders',
			async run({ page }) {
				await page.locator('.part.sessionspart .session-view').evaluateAll(views => {
					for (const view of views) {
						view.style.removeProperty('border-bottom-left-radius');
						view.style.removeProperty('border-bottom-right-radius');
					}
				});
				const state = await geometry(page);
				assert.deepEqual(state.inner, state.outer.map(radius => Math.max(0, radius - state.stroke)));
				assert.deepEqual(state.frame, state.inner);
				await capture(page, 'after');
				return `Both inner corners and their visible frame are uniformly inset: outer ${state.outer[1]}px, inner ${state.inner[1]}px, stroke ${state.stroke}px.`;
			},
		},
	],
};
