import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { PlannotatorBrowserActions, PlannotatorBrowserAssets } from "./plannotator-browser.ts";

/**
 * Bind browser assets to an app-local facade. The facade's module URL keeps
 * assets at the extension package root even when this factory is vendored
 * under generated/runtime/.
 */
export function createPlannotatorBrowserRuntime(
	moduleUrl: string,
	loadBrowser: () => Promise<PlannotatorBrowserActions>,
): PlannotatorBrowserAssets & { loadPlannotatorBrowser(): Promise<PlannotatorBrowserActions> } {
	const moduleDirectory = dirname(fileURLToPath(moduleUrl));
	const planHtmlPath = resolve(moduleDirectory, "plannotator.html");
	const reviewHtmlPath = resolve(moduleDirectory, "review-editor.html");

	let browserModulePromise: Promise<PlannotatorBrowserActions> | undefined;
	let planHtmlContent: string | undefined;
	let reviewHtmlContent: string | undefined;

	function hasReadableAsset(path: string, cachedContent: string | undefined): boolean {
		if (cachedContent) return true;
		try {
			const stats = statSync(path);
			return stats.isFile() && stats.size > 0;
		} catch {
			return false;
		}
	}

	function readBrowserAsset(path: string, cachedContent: string | undefined): string {
		if (cachedContent !== undefined) return cachedContent;
		try {
			return readFileSync(path, "utf-8");
		} catch {
			return "";
		}
	}

	function hasPlanBrowserHtml(): boolean {
		return hasReadableAsset(planHtmlPath, planHtmlContent);
	}

	function hasReviewBrowserHtml(): boolean {
		return hasReadableAsset(reviewHtmlPath, reviewHtmlContent);
	}

	function getPlanBrowserHtml(): string {
		const content = readBrowserAsset(planHtmlPath, planHtmlContent);
		if (content) planHtmlContent = content;
		return content;
	}

	function getReviewBrowserHtml(): string {
		const content = readBrowserAsset(reviewHtmlPath, reviewHtmlContent);
		if (content) reviewHtmlContent = content;
		return content;
	}

	function getStartupErrorMessage(error: unknown): string {
		return error instanceof Error ? error.message : "Unknown error";
	}

	function loadPlannotatorBrowser(): Promise<PlannotatorBrowserActions> {
		if (!browserModulePromise) {
			browserModulePromise = loadBrowser().catch((error: unknown) => {
				browserModulePromise = undefined;
				throw error;
			});
		}
		return browserModulePromise;
	}

	return {
		hasPlanBrowserHtml,
		hasReviewBrowserHtml,
		getPlanBrowserHtml,
		getReviewBrowserHtml,
		getStartupErrorMessage,
		loadPlannotatorBrowser,
	};
}
