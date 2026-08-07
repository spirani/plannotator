import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPlannotatorDataDir } from "./generated/data-dir.ts";
import {
	PLANNOTATOR_REQUEST_CHANNEL,
	PLANNOTATOR_REVIEW_RESULT_CHANNEL,
	registerPlannotatorEventListeners,
	type PlannotatorBrowserActions,
} from "./plannotator-events.ts";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

type RequestHandler = (data: unknown) => Promise<void>;
type SessionHandler = (event: unknown, ctx: ExtensionContext) => Promise<void>;

const statusPath = join(getPlannotatorDataDir(), "oh-my-pi-review-status.json");
let previousStatus: string | undefined;
let hadPreviousStatus = false;

afterEach(() => {
	if (hadPreviousStatus) {
		mkdirSync(join(statusPath, ".."), { recursive: true });
		writeFileSync(statusPath, previousStatus ?? "");
	} else {
		rmSync(statusPath, { force: true });
	}
	previousStatus = undefined;
	hadPreviousStatus = false;
});

function makeHarness(actions: Partial<PlannotatorBrowserActions> = {}) {
	let sessionHandler!: SessionHandler;
	let requestHandler!: RequestHandler;
	const emitted: Array<{ channel: string; data: unknown }> = [];
	const pi = {
		on(name: string, handler: SessionHandler) {
			if (name === "session_start") sessionHandler = handler;
		},
		events: {
			on(name: string, handler: RequestHandler) {
			if (name === PLANNOTATOR_REQUEST_CHANNEL) requestHandler = handler;
		},
		emit(channel: string, data: unknown) {
			emitted.push({ channel, data });
		},
		},
	} as unknown as ExtensionAPI;
	registerPlannotatorEventListeners(pi, {
		piModels: () => [{ id: "fake/omp", label: "Fake OMP", default: true }],
		piExecutablePath: "omp",
		browserActions: actions,
	});
	return {
		sessionHandler,
		requestHandler,
		emitted,
		pi,
	};
}

function contextWithBranch(branch: unknown[] = []) {
	return {
		hasUI: true,
		cwd: "/tmp",
		model: undefined,
		models: { current: () => undefined, list: () => [] },
		sessionManager: { getBranch: () => branch },
	} as unknown as ExtensionContext;
}

async function request(
	handler: RequestHandler,
	action: string,
	payload: unknown,
): Promise<unknown> {
	return new Promise((resolve) => {
		void handler({ requestId: `${action}-${Math.random()}`, action, payload, respond: resolve });
	});
}

function captureStatusFile() {
	if (!existsSync(statusPath)) return;
	hadPreviousStatus = true;
	previousStatus = readFileSync(statusPath, "utf-8");
}

describe("Oh My Pi Plannotator events", () => {
	test("keeps plan-mode unavailable and ignores malformed requests", async () => {
		captureStatusFile();
		const { sessionHandler, requestHandler } = makeHarness();
		await sessionHandler({}, contextWithBranch());
		let responded = false;
		await requestHandler({ action: "not-an-action", respond: () => { responded = true; } });
		expect(responded).toBe(false);
		expect(await request(requestHandler, "plan-mode", { mode: "status" })).toEqual({
			status: "unavailable",
			error: "Plan mode control is not available in this session.",
		});
	});

	test("returns pending plan review, emits completion, and persists recoverable status", async () => {
		captureStatusFile();
		let decide!: (value: { approved: boolean; feedback?: string }) => void;
		const planSession = {
			reviewId: "review-omp-1",
			onDecision(listener: (value: { approved: boolean; feedback?: string }) => void) {
				decide = listener;
				return () => {};
			},
		};
		const { sessionHandler, requestHandler, emitted } = makeHarness({
			startPlanReviewBrowserSession: (async () => planSession) as never,
		});
		await sessionHandler({}, contextWithBranch());
		expect(await request(requestHandler, "plan-review", { planContent: "# Plan" })).toEqual({
			status: "handled",
			result: { status: "pending", reviewId: "review-omp-1" },
		});
		decide({ approved: false, feedback: "Please revise" });
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(emitted).toContainEqual({
			channel: PLANNOTATOR_REVIEW_RESULT_CHANNEL,
			data: {
				reviewId: "review-omp-1",
				approved: false,
				feedback: "Please revise",
			},
		});
		expect(await request(requestHandler, "review-status", { reviewId: "review-omp-1" })).toEqual({
			status: "handled",
			result: {
				status: "completed",
				reviewId: "review-omp-1",
				approved: false,
				feedback: "Please revise",
			},
		});
	});

	test("forwards OMP models and executable to synchronous review and annotation actions", async () => {
		captureStatusFile();
		const calls: Record<string, unknown[]> = {};
		const capture = (name: string) => async (...args: unknown[]) => {
			calls[name] = args;
			return name === "code" ? { approved: false, feedback: "review" } : { feedback: "annotation" };
		};
		const { sessionHandler, requestHandler } = makeHarness({
			openCodeReview: capture("code") as never,
			openMarkdownAnnotation: capture("annotate") as never,
			openLastMessageAnnotation: capture("last") as never,
			openArchiveBrowserAction: capture("archive") as never,
		});
		await sessionHandler({}, contextWithBranch());
		await request(requestHandler, "code-review", { cwd: "/tmp/repo", prUrl: "https://github.com/a/b/pull/1" });
		await request(requestHandler, "annotate", { filePath: "README.md", markdown: "# hi" });
		await request(requestHandler, "annotate-last", { markdown: "answer" });
		await request(requestHandler, "archive", {});
		expect(calls.code?.[1]).toMatchObject({
			piModels: [{ id: "fake/omp", label: "Fake OMP", default: true }],
			piExecutablePath: "omp",
		});
		expect(calls.annotate?.at(-1)).toEqual({
			piModels: [{ id: "fake/omp", label: "Fake OMP", default: true }],
			piExecutablePath: "omp",
		});
		expect(calls.last?.at(-1)).toEqual({
			piModels: [{ id: "fake/omp", label: "Fake OMP", default: true }],
			piExecutablePath: "omp",
		});
		expect(calls.archive?.[0]).toBeDefined();
	});

	test("reports unavailable status when no active context exists and no last message exists", async () => {
		captureStatusFile();
		const noContext = makeHarness();
		expect(await request(noContext.requestHandler, "code-review", {})).toEqual({
			status: "unavailable",
			error: "Plannotator context is not ready yet.",
		});
		const active = makeHarness();
		await active.sessionHandler({}, contextWithBranch());
		expect(await request(active.requestHandler, "annotate-last", {})).toEqual({
			status: "unavailable",
			error: "No assistant message found in session.",
		});
	});
});
