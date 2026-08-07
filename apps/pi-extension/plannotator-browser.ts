import { createPlannotatorBrowser } from "./generated/runtime/plannotator-browser.ts";
import {
	getPlanBrowserHtml,
	getReviewBrowserHtml,
	getStartupErrorMessage,
	hasPlanBrowserHtml,
	hasReviewBrowserHtml,
} from "./plannotator-browser-runtime.ts";

export type {
	AnnotationDecision,
	AnnotationOptions,
	AnnotateMode,
	BrowserDecisionSession,
	CodeReviewDecision,
	CodeReviewOptions,
	PiModel,
	PlanReviewBrowserSession,
	PlanReviewDecision,
	PlanReviewOptions,
	PlannotatorBrowserActions,
	PlannotatorHostContext,
} from "./generated/runtime/plannotator-browser.ts";
export { getLastAssistantMessageText } from "./assistant-message.ts";
export {
	getStartupErrorMessage,
	hasPlanBrowserHtml,
	hasReviewBrowserHtml,
} from "./plannotator-browser-runtime.ts";

const browserActions = createPlannotatorBrowser({
	origin: "pi",
	assets: {
		getPlanBrowserHtml,
		getReviewBrowserHtml,
		getStartupErrorMessage,
		hasPlanBrowserHtml,
		hasReviewBrowserHtml,
	},
});

export const {
	stopAllBrowserDecisionSessions,
	getActiveBrowserSessionCount,
	startServerWithSelfPreemption,
	startBrowserDecisionSession,
	startPlanReviewBrowserSession,
	openPlanReviewBrowser,
	shouldUseLocalPrCheckout,
	openCodeReview,
	startCodeReviewBrowserSession,
	openMarkdownAnnotation,
	startMarkdownAnnotationSession,
	openLastMessageAnnotation,
	startLastMessageAnnotationSession,
	openArchiveBrowserAction,
} = browserActions;
