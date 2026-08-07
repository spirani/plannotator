import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	createPlannotatorEvents,
	PLANNOTATOR_REQUEST_CHANNEL,
	PLANNOTATOR_REVIEW_RESULT_CHANNEL,
} from "./generated/runtime/plannotator-events.ts";
import {
	getLastAssistantMessageText,
	getRecentAssistantMessages,
} from "./assistant-message.ts";
import {
	getStartupErrorMessage,
	hasPlanBrowserHtml,
	hasReviewBrowserHtml,
	loadPlannotatorBrowser,
} from "./plannotator-browser-runtime.ts";

export {
	PLANNOTATOR_REQUEST_CHANNEL,
	PLANNOTATOR_REVIEW_RESULT_CHANNEL,
	PLANNOTATOR_PLAN_APPROVED_CHANNEL,
	PLANNOTATOR_TIMEOUT_MS,
} from "./generated/runtime/plannotator-events.ts";
export type {
	PlannotatorAction,
	PlannotatorAnnotationResult,
	PlannotatorAnnotatePayload,
	PlannotatorArchivePayload,
	PlannotatorArchiveResult,
	PlannotatorCodeReviewPayload,
	PlannotatorCodeReviewResult,
	PlannotatorErrorResponse,
	PlannotatorHandledResponse,
	PlannotatorPlanApprovedEvent,
	PlannotatorPlanModePayload,
	PlannotatorPlanModeResult,
	PlannotatorPlanReviewPayload,
	PlannotatorPlanReviewStartResult,
	PlannotatorRequest,
	PlannotatorRequestBase,
	PlannotatorRequestMap,
	PlannotatorResponse,
	PlannotatorResponseMap,
	PlannotatorReviewResultEvent,
	PlannotatorReviewStatusPayload,
	PlannotatorReviewStatusResult,
	PlannotatorUnavailableResponse,
} from "./generated/runtime/plannotator-events.ts";

/** Start a plan-review browser session after loading the browser/server graph on demand. */
export function startPlanReviewBrowserSession(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startPlanReviewBrowserSession"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startPlanReviewBrowserSession"]> {
	return loadPlannotatorBrowser().then((browser) => browser.startPlanReviewBrowserSession(...args));
}

/** Open a plan review after loading the browser/server graph on demand. */
export function openPlanReviewBrowser(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openPlanReviewBrowser"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openPlanReviewBrowser"]> {
	return loadPlannotatorBrowser().then((browser) => browser.openPlanReviewBrowser(...args));
}

/** Start a code-review browser session after loading the browser/server graph on demand. */
export function startCodeReviewBrowserSession(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startCodeReviewBrowserSession"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startCodeReviewBrowserSession"]> {
	return loadPlannotatorBrowser().then((browser) => browser.startCodeReviewBrowserSession(...args));
}

/** Open a code review after loading the browser/server graph on demand. */
export function openCodeReview(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openCodeReview"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openCodeReview"]> {
	return loadPlannotatorBrowser().then((browser) => browser.openCodeReview(...args));
}

/** Start a markdown-annotation session after loading the browser/server graph on demand. */
export function startMarkdownAnnotationSession(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startMarkdownAnnotationSession"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startMarkdownAnnotationSession"]> {
	return loadPlannotatorBrowser().then((browser) => browser.startMarkdownAnnotationSession(...args));
}

/** Open a markdown annotation after loading the browser/server graph on demand. */
export function openMarkdownAnnotation(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openMarkdownAnnotation"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openMarkdownAnnotation"]> {
	return loadPlannotatorBrowser().then((browser) => browser.openMarkdownAnnotation(...args));
}

/** Start a last-message annotation session after loading the browser/server graph on demand. */
export function startLastMessageAnnotationSession(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startLastMessageAnnotationSession"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["startLastMessageAnnotationSession"]> {
	return loadPlannotatorBrowser().then((browser) => browser.startLastMessageAnnotationSession(...args));
}

/** Open a last-message annotation after loading the browser/server graph on demand. */
export function openLastMessageAnnotation(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openLastMessageAnnotation"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openLastMessageAnnotation"]> {
	return loadPlannotatorBrowser().then((browser) => browser.openLastMessageAnnotation(...args));
}

/** Open the plan archive after loading the browser/server graph on demand. */
export function openArchiveBrowserAction(
	...args: Parameters<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openArchiveBrowserAction"]>
): ReturnType<Awaited<ReturnType<typeof loadPlannotatorBrowser>>["openArchiveBrowserAction"]> {
	return loadPlannotatorBrowser().then((browser) => browser.openArchiveBrowserAction(...args));
}

export interface PlannotatorEventListenerOptions {
	handlePlanMode?: (
		mode: "enter" | "exit" | "toggle" | "status",
		ctx: ExtensionContext,
	) => Promise<import("./generated/runtime/plannotator-events.ts").PlannotatorPlanModeResult>
		| import("./generated/runtime/plannotator-events.ts").PlannotatorPlanModeResult;
}

const events = createPlannotatorEvents<ExtensionContext>({
	reviewStatusPath: join(homedir(), ".pi", "plannotator-review-status.json"),
	browserActions: {
		startPlanReviewBrowserSession,
		openCodeReview,
		openMarkdownAnnotation,
		openLastMessageAnnotation,
		openArchiveBrowserAction,
	},
	getLastAssistantMessageText,
	getRecentAssistantMessages,
	getStartupErrorMessage,
	resolveAnnotationFolder: (payload) => payload.folderPath,
});

export function registerPlannotatorEventListeners(
	pi: ExtensionAPI,
	options: PlannotatorEventListenerOptions = {},
): void {
	events.registerPlannotatorEventListeners(
		{
			onSessionStart(listener) {
				pi.on("session_start", async (_event, ctx) => listener(ctx));
			},
			onRequest(listener) {
				pi.events.on(PLANNOTATOR_REQUEST_CHANNEL, listener);
			},
			emitReviewResult(channel, result) {
				pi.events.emit(channel, result);
			},
		},
		options,
	);
}

export {
	getLastAssistantMessageText,
	hasPlanBrowserHtml,
	hasReviewBrowserHtml,
	getStartupErrorMessage,
};
