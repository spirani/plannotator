import { createPlannotatorBrowserRuntime } from "./generated/runtime/plannotator-browser-runtime.ts";
import type { PlannotatorBrowserActions } from "./generated/runtime/plannotator-browser.ts";

const browserRuntime = createPlannotatorBrowserRuntime(
	import.meta.url,
	async () => (await import("./plannotator-browser.ts")) as unknown as PlannotatorBrowserActions,
);

export const {
	hasPlanBrowserHtml,
	hasReviewBrowserHtml,
	getPlanBrowserHtml,
	getReviewBrowserHtml,
	getStartupErrorMessage,
	loadPlannotatorBrowser,
} = browserRuntime;
