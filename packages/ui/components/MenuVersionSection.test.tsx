import { afterEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UpdateInfo } from '../hooks/useUpdateCheck';
import { MenuVersionSection } from './MenuVersionSection';

const hasDom = typeof document !== 'undefined';
let root: Root | null = null;
let host: HTMLElement | null = null;
let originalClipboard: Clipboard | undefined;

const updateInfo: UpdateInfo = {
	currentVersion: '0.26.2',
	latestVersion: '0.27.0',
	updateAvailable: true,
	dismissed: false,
	releaseUrl: 'https://github.com/backnotprop/plannotator/releases/tag/v0.27.0',
	dismiss: () => {},
};

afterEach(async () => {
	if (root) await act(async () => root!.unmount());
	root = null;
	host?.remove();
	host = null;
	if (originalClipboard) {
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: originalClipboard });
		originalClipboard = undefined;
	}
});

describe('MenuVersionSection Oh My Pi updates', () => {
	test.skipIf(!hasDom)('copies the canonical omp update command', async () => {
		host = document.createElement('div');
		document.body.appendChild(host);
		root = createRoot(host);
		originalClipboard = navigator.clipboard;
		let copied = '';
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async (text: string) => { copied = text; } },
		});

		await act(async () => {
			root!.render(
				<MenuVersionSection
					appVersion="0.26.2"
					updateInfo={updateInfo}
					origin="oh-my-pi"
					isWSL={false}
					closeMenu={() => {}}
				/>,
			);
		});
		const button = host.querySelector('button');
		if (!button) throw new Error('Update-copy button did not render');
		await act(async () => {
			button.click();
			await Promise.resolve();
		});
			expect(copied).toBe('omp install npm:@plannotator/oh-my-pi-extension');
	});
});
