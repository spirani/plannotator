/**
 * Plannotator integration for Oh My Pi.
 *
 * Oh My Pi already resolves and validates the active `local://` plan before
 * opening its approval flow. Replace only the native review surface with
 * Plannotator's browser review; native approval/execution remains responsible
 * for leaving plan mode, restoring tools, and dispatching the execution turn.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@oh-my-pi/pi-coding-agent";
import { InteractiveMode } from "@oh-my-pi/pi-coding-agent/modes/interactive-mode";
import {
	getStartupErrorMessage,
	hasReviewBrowserHtml,
	openPlanReviewBrowser,
	startCodeReviewBrowserSession,
	registerPlannotatorEventListeners,
} from "./plannotator-events.ts";
import { registerAnnotationCommands } from "./annotation-commands.ts";

type NativePlanReview = InteractiveMode["showPlanReview"];
type NativePlanReviewArgs = Parameters<NativePlanReview>;

type PatchedInteractiveMode = InteractiveMode & {
	[PLANNOTATOR_PATCHED]?: true;
};

const PLANNOTATOR_PATCHED = Symbol.for("plannotator.omp.plan-review.patched");
type OhMyPiModel = {
	provider: string;
	id: string;
	name?: string;
};

type PlannotatorModel = {
	id: string;
	label: string;
	default?: boolean;
};

function toPlannotatorModels(
	models: readonly OhMyPiModel[],
	current?: OhMyPiModel,
): PlannotatorModel[] {
	const catalog = current && !models.some(
		(model) => model.provider === current.provider && model.id === current.id,
	)
		? [current, ...models]
		: models;
	return catalog.map((model) => {
		const id = `${model.provider}/${model.id}`;
		const isCurrent = current?.provider === model.provider && current?.id === model.id;
		return {
			id,
			label: model.name || id,
			...(isCurrent ? { default: true } : {}),
		};
	});
}

/**
 * Convert Oh My Pi's authenticated model scope into the small catalog shape
 * Plannotator exposes to its browser UI. Keep credentials and provider
 * metadata out of the browser; the spawned `omp` process still owns auth.
 */
export function getOhMyPiModels(
	ctx: Pick<ExtensionContext, "models" | "model">,
): PlannotatorModel[] {
	const current = ctx.models.current() ?? ctx.model;
	return toPlannotatorModels(ctx.models.list(), current);
}

export function getOhMyPiPlanReviewModels(
	mode: Pick<InteractiveMode, "session">,
): PlannotatorModel[] {
	const scopedModels = mode.session.scopedModels.map(({ model }) => model);
	const models =
		scopedModels.length > 0 ? scopedModels : mode.session.modelRegistry.getAvailable();
	return toPlannotatorModels(models, mode.session.model);
}

function installPlanReviewBridge(
	openPlanReview?: typeof openPlanReviewBrowser,
): void {
	const openPlanReviewSession = openPlanReview ?? openPlanReviewBrowser;
	const prototype = InteractiveMode.prototype as PatchedInteractiveMode;
	if (prototype[PLANNOTATOR_PATCHED]) return;

	const nativeReview = prototype.showPlanReview;
	prototype[PLANNOTATOR_PATCHED] = true;

	prototype.showPlanReview = async function showPlanReviewWithPlannotator(
		this: InteractiveMode,
		planContent: NativePlanReviewArgs[0],
		title: NativePlanReviewArgs[1],
		options: NativePlanReviewArgs[2],
		dialogOptions: NativePlanReviewArgs[3],
		extra: NativePlanReviewArgs[4],
	): Promise<string | undefined> {
		if (!(title === "Plan mode - next step" && options.includes("Approve and execute"))) {
			return nativeReview.call(this, planContent, title, options, dialogOptions, extra);
		}

		try {
			const decision = await openPlanReviewSession(
				{
					hasUI: true,
					ui: this.ui,
				} as unknown as ExtensionContext,
				planContent,
				undefined,
				{
					piModels: getOhMyPiPlanReviewModels(this),
					piExecutablePath: "omp",
				},
			);

			if (decision.approved) return "Approve and execute";

			// Native plan approval sends the feedback entered here as the next
			// planning turn when the reviewer chooses "Refine plan".
			dialogOptions?.onFeedbackChange?.(decision.feedback ?? "");
			return "Refine plan";
		} catch (error) {
			this.showWarning(
				`Plannotator browser review unavailable; falling back to the native plan review: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
			return nativeReview.call(this, planContent, title, options, dialogOptions, extra);
		}
	} as NativePlanReview;
}

function registerCodeReviewCommand(pi: ExtensionAPI): void {
	pi.registerCommand("plannotator-review", {
		description:
			"Open interactive code review for current changes or a PR URL; pass --git or --gitbutler to force that provider",
		handler: async (args, ctx: ExtensionCommandContext) => {
			if (!hasReviewBrowserHtml()) {
				ctx.ui.notify(
					"Code review UI not available. Run 'bun run build:omp' from the repository root.",
					"error",
				);
				return;
			}
			try {
				const [{ parseReviewArgs }, { loadConfig }, { getReviewApprovedPrompt, getReviewDeniedSuffix }] =
					await Promise.all([
						import("./generated/review-args.ts"),
						import("./generated/config.ts"),
						import("./generated/prompts.ts"),
					]);
				const reviewArgs = parseReviewArgs(args ?? "");
				const session = await startCodeReviewBrowserSession(
					ctx,
					{
						prUrl: reviewArgs.prUrl,
						vcsType: reviewArgs.vcsType,
						useLocal: reviewArgs.useLocal,
						piModels: getOhMyPiModels(ctx),
						piExecutablePath: "omp",
					},
				);
				ctx.ui.notify(`Code review opened: ${session.url}`, "info");
				void session
					.waitForDecision()
					.then(async (result) => {
						try {
							if (result.exit) {
								ctx.ui.notify("Code review session closed.", "info");
								return;
							}
							const config = loadConfig();
							if (result.approved) {
								pi.sendUserMessage(getReviewApprovedPrompt("oh-my-pi", config), {
									deliverAs: "followUp",
								});
								return;
							}
							if (!result.feedback) {
								ctx.ui.notify("Code review closed (no feedback).", "info");
								return;
							}

							// Platform PR actions (approve/comment posted to the
							// host) return an empty annotation set and a status
							// message; only annotated findings need the
							// verification-only suffix.
							let reviewFeedback = result.feedback;
							if ((result.annotations?.length ?? 0) > 0) {
								reviewFeedback += getReviewDeniedSuffix("oh-my-pi", config);
							}
							pi.sendUserMessage(reviewFeedback, { deliverAs: "followUp" });
						} catch (error) {
							ctx.ui.notify(
								`Plannotator code review feedback could not be sent: ${getStartupErrorMessage(error)}`,
								"error",
							);
						}
					})
					.catch((error) => {
						ctx.ui.notify(
							`Plannotator code review session failed: ${getStartupErrorMessage(error)}`,
							"error",
						);
					});
			} catch (error) {
				ctx.ui.notify(
					`Failed to start code review UI: ${getStartupErrorMessage(error)}`,
					"error",
				);
			}
		},
	});
}

export { installPlanReviewBridge, registerCodeReviewCommand };

export default function plannotatorOhMyPi(pi: ExtensionAPI): void {
	installPlanReviewBridge();
	registerCodeReviewCommand(pi);
	registerAnnotationCommands(pi);
	registerPlannotatorEventListeners(pi, {
		piModels: getOhMyPiModels,
		piExecutablePath: "omp",
	});
}
