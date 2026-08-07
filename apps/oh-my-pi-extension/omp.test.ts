import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import plannotatorOhMyPi, {
	getOhMyPiModels,
	getOhMyPiPlanReviewModels,
	installPlanReviewBridge,
} from "./omp.ts";
import { openPlanReviewBrowser } from "./plannotator-events.ts";

const patchedSymbol = Symbol.for("plannotator.omp.plan-review.patched");
const interactivePrototype = InteractiveMode.prototype as InteractiveMode & Record<PropertyKey, unknown>;
let originalShowPlanReview: PropertyDescriptor | undefined;
let originalPatchedMarker: PropertyDescriptor | undefined;

beforeEach(() => {
	originalShowPlanReview = Object.getOwnPropertyDescriptor(interactivePrototype, "showPlanReview");
	originalPatchedMarker = Object.getOwnPropertyDescriptor(interactivePrototype, patchedSymbol);
});

afterEach(() => {
	if (originalShowPlanReview) {
		Object.defineProperty(interactivePrototype, "showPlanReview", originalShowPlanReview);
	} else {
		delete (interactivePrototype as Record<PropertyKey, unknown>).showPlanReview;
	}
	if (originalPatchedMarker) {
		Object.defineProperty(interactivePrototype, patchedSymbol, originalPatchedMarker);
	} else {
		delete (interactivePrototype as Record<PropertyKey, unknown>)[patchedSymbol];
	}
});

function makeNativeCall() {
	const calls: Array<{ receiver: unknown; args: unknown[] }> = [];
	const native = function (this: unknown, ...args: unknown[]) {
		calls.push({ receiver: this, args });
		return Promise.resolve("native-result");
	};
	Object.defineProperty(interactivePrototype, "showPlanReview", {
		configurable: true,
		writable: true,
		value: native,
	});
	return { calls, native };
}

function makeReceiver() {
	const warnings: string[] = [];
	const receiver = {
		ui: { notify() {} },
		session: {
			model: { provider: "openai", id: "gpt-5", name: "GPT-5" },
			scopedModels: [
				{ model: { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" } },
				{ model: { provider: "openai", id: "gpt-5", name: "GPT-5" } },
			],
			modelRegistry: { getAvailable: () => [] },
		},
		showWarning(message: string) {
			warnings.push(message);
		},
	};
	return { receiver, warnings };
}

function nativeArgs(overrides: Partial<{
	planContent: string;
	title: string;
	options: string[];
	dialogOptions: Record<string, unknown>;
	extra: Record<string, unknown>;
}> = {}) {
	return [
		overrides.planContent ?? "# Plan",
		overrides.title ?? "Plan mode - next step",
		overrides.options ?? ["Approve and execute", "Refine plan"],
		overrides.dialogOptions ?? {},
		overrides.extra ?? { slider: { min: 0, max: 1 } },
	] as const;
}

describe("Oh My Pi integration", () => {
	test("registers code review, direct annotation, and last-message commands", () => {
		const commands: Array<{ name: string; description?: string; handler: unknown }> = [];
		const pi = {
			registerCommand(name: string, options: { description?: string; handler: unknown }) {
				commands.push({ name, description: options.description, handler: options.handler });
			},
			on() {},
			events: { on() {}, emit() {} },
		} as unknown as ExtensionAPI;

		plannotatorOhMyPi(pi);

		expect(commands.map(({ name }) => name)).toEqual([
			"plannotator-review",
			"plannotator-annotate",
			"plannotator-last",
		]);
		expect(commands.find(({ name }) => name === "plannotator-review")?.description).toContain("interactive code review");
		expect(commands.find(({ name }) => name === "plannotator-annotate")?.description).toBe("Open markdown file or folder in annotation UI");
		expect(commands.find(({ name }) => name === "plannotator-last")?.description).toBe("Annotate the last assistant message");
	});

	test("converts the active Oh My Pi model scope into the browser catalog", () => {
		const ctx = {
			model: { provider: "anthropic", id: "claude-sonnet-4-5" },
			models: {
				current: () => ({ provider: "openai", id: "gpt-5" }),
				list: () => [
					{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" },
					{ provider: "openai", id: "gpt-5", name: "GPT-5" },
				],
			},
		} as unknown as ExtensionCommandContext;

		expect(getOhMyPiModels(ctx)).toEqual([
			{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
			{ id: "openai/gpt-5", label: "GPT-5", default: true },
		]);
	});

	test("preserves the plan session's scoped model selection", () => {
		const mode = {
			session: {
				model: { provider: "openai", id: "gpt-5", name: "GPT-5" },
				scopedModels: [
					{ model: { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" } },
					{ model: { provider: "openai", id: "gpt-5", name: "GPT-5" } },
				],
				modelRegistry: {
					getAvailable: () => [{ provider: "other", id: "not-in-scope", name: "Not in scope" }],
				},
			},
		} as unknown as Pick<InteractiveMode, "session">;

		expect(getOhMyPiPlanReviewModels(mode)).toEqual([
			{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
			{ id: "openai/gpt-5", label: "GPT-5", default: true },
		]);
	});

	test("opens matching approvals with the scoped catalog and omp executable", async () => {
		const { calls } = makeNativeCall();
		const { receiver } = makeReceiver();
		const opened: unknown[][] = [];
		const open = async (...args: unknown[]) => {
			opened.push(args);
			return { approved: true, feedback: "ignored" };
		};
		installPlanReviewBridge(open as typeof openPlanReviewBrowser);
		const args = nativeArgs();
		const result = await (interactivePrototype.showPlanReview as Function).call(receiver, ...args);

		expect(result).toBe("Approve and execute");
		expect(calls).toHaveLength(0);
		expect(opened).toHaveLength(1);
		expect(opened[0]?.[1]).toBe("# Plan");
		expect(opened[0]?.[3]).toEqual({
			piModels: [
				{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
				{ id: "openai/gpt-5", label: "GPT-5", default: true },
			],
			piExecutablePath: "omp",
		});
	});

	test.each([
		["feedback", "Please revise"],
		["omitted feedback", undefined],
	])("routes matching denial with %s through the feedback callback", async (_label, feedback) => {
		const { calls } = makeNativeCall();
		const { receiver } = makeReceiver();
		const changes: string[] = [];
		const open = async () => ({ approved: false, ...(feedback === undefined ? {} : { feedback }) });
		installPlanReviewBridge(open as typeof openPlanReviewBrowser);
		const args = nativeArgs({ dialogOptions: { onFeedbackChange: (value: string) => changes.push(value) } });
		const result = await (interactivePrototype.showPlanReview as Function).call(receiver, ...args);

		expect(result).toBe("Refine plan");
		expect(calls).toHaveLength(0);
		expect(changes).toEqual([feedback ?? ""]);
	});
	test("delegates different titles and missing approval choices unchanged", async () => {
		const { calls, native } = makeNativeCall();
		const { receiver } = makeReceiver();
		let opened = 0;
		installPlanReviewBridge((async () => {
			opened++;
			return { approved: true };
		}) as typeof openPlanReviewBrowser);
		const differentTitle = nativeArgs({ title: "Other review" });
		const missingChoice = nativeArgs({ options: ["Refine plan"] });
		await (interactivePrototype.showPlanReview as Function).call(receiver, ...differentTitle);
		await (interactivePrototype.showPlanReview as Function).call(receiver, ...missingChoice);

		expect(opened).toBe(0);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.receiver).toBe(receiver);
		expect(calls[0]?.args).toEqual([...differentTitle]);
		expect(calls[1]?.receiver).toBe(receiver);
		expect(calls[1]?.args).toEqual([...missingChoice]);
		void native;
	});

	test("warns once and falls back to native review with all five arguments", async () => {
		const { calls } = makeNativeCall();
		const { receiver, warnings } = makeReceiver();
		installPlanReviewBridge((async () => {
			throw new Error("browser unavailable");
		}) as typeof openPlanReviewBrowser);
		const args = nativeArgs({ dialogOptions: { onFeedbackChange() {} } });
		const result = await (interactivePrototype.showPlanReview as Function).call(receiver, ...args);

		expect(result).toBe("native-result");
		expect(warnings).toEqual([
			"Plannotator browser review unavailable; falling back to the native plan review: browser unavailable",
		]);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.receiver).toBe(receiver);
		expect(calls[0]?.args).toEqual([...args]);
	});
});
