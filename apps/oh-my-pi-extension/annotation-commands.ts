import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { isRemoteSession } from "./server/network.ts";
import {
	getStartupErrorMessage,
	hasPlanBrowserHtml,
	startLastMessageAnnotationSession,
	startMarkdownAnnotationSession,
} from "./plannotator-events.ts";
import {
	getLastAssistantMessageSnapshot,
	getRecentAssistantMessages,
} from "./assistant-message.ts";
import { isBrowserSessionStoppedError } from "./browser-session-error.ts";
import { classifyAnnotateOutcome } from "./annotate-outcome.ts";

type AnnotateCommandModules = {
	parseAnnotateArgs: typeof import("./generated/annotate-args.ts").parseAnnotateArgs;
	annotateInputNamesExistingTarget: typeof import("./generated/annotate-target.ts").annotateInputNamesExistingTarget;
	buildAmbiguousAnnotateArgsMessage: typeof import("./generated/annotate-target.ts").buildAmbiguousAnnotateArgsMessage;
	buildUnresolvedAnnotateArgsMessage: typeof import("./generated/annotate-target.ts").buildUnresolvedAnnotateArgsMessage;
	probeAnnotateToken: typeof import("./generated/annotate-target.ts").probeAnnotateToken;
	selectAnnotateTokenTarget: typeof import("./generated/annotate-target.ts").selectAnnotateTokenTarget;
	resolveAtReference: typeof import("./generated/at-reference.ts").resolveAtReference;
	hasMarkdownFiles: typeof import("./generated/resolve-file.ts").hasMarkdownFiles;
	resolveUserPath: typeof import("./generated/resolve-file.ts").resolveUserPath;
	isAnnotatableTextPath: typeof import("./generated/resolve-file.ts").isAnnotatableTextPath;
	ANNOTATABLE_DOC_REGEX: typeof import("./generated/resolve-file.ts").ANNOTATABLE_DOC_REGEX;
	ANNOTATABLE_EXTENSIONS_HINT: typeof import("./generated/resolve-file.ts").ANNOTATABLE_EXTENSIONS_HINT;
	MAX_ANNOTATABLE_FILE_BYTES: typeof import("./generated/resolve-file.ts").MAX_ANNOTATABLE_FILE_BYTES;
	FILE_BROWSER_EXCLUDED: typeof import("./generated/reference-common.ts").FILE_BROWSER_EXCLUDED;
};

type PlannotatorPromptModule = typeof import("./generated/prompts.ts");
type PlannotatorConfigModule = typeof import("./generated/config.ts");

let annotateCommandModulesPromise: Promise<AnnotateCommandModules> | undefined;
let promptModulePromise: Promise<PlannotatorPromptModule> | undefined;
let configModulePromise: Promise<PlannotatorConfigModule> | undefined;

function loadAnnotateCommandModules(): Promise<AnnotateCommandModules> {
	if (!annotateCommandModulesPromise) {
		annotateCommandModulesPromise = Promise.all([
			import("./generated/annotate-args.ts"),
			import("./generated/annotate-target.ts"),
			import("./generated/at-reference.ts"),
			import("./generated/resolve-file.ts"),
			import("./generated/reference-common.ts"),
		]).then(([annotateArgs, annotateTarget, atReference, resolveFile, referenceCommon]) => ({
			parseAnnotateArgs: annotateArgs.parseAnnotateArgs,
			annotateInputNamesExistingTarget: annotateTarget.annotateInputNamesExistingTarget,
			buildAmbiguousAnnotateArgsMessage: annotateTarget.buildAmbiguousAnnotateArgsMessage,
			buildUnresolvedAnnotateArgsMessage: annotateTarget.buildUnresolvedAnnotateArgsMessage,
			probeAnnotateToken: annotateTarget.probeAnnotateToken,
			selectAnnotateTokenTarget: annotateTarget.selectAnnotateTokenTarget,
			resolveAtReference: atReference.resolveAtReference,
			hasMarkdownFiles: resolveFile.hasMarkdownFiles,
			resolveUserPath: resolveFile.resolveUserPath,
			isAnnotatableTextPath: resolveFile.isAnnotatableTextPath,
			ANNOTATABLE_DOC_REGEX: resolveFile.ANNOTATABLE_DOC_REGEX,
			ANNOTATABLE_EXTENSIONS_HINT: resolveFile.ANNOTATABLE_EXTENSIONS_HINT,
			MAX_ANNOTATABLE_FILE_BYTES: resolveFile.MAX_ANNOTATABLE_FILE_BYTES,
			FILE_BROWSER_EXCLUDED: referenceCommon.FILE_BROWSER_EXCLUDED,
		}));
	}
	return annotateCommandModulesPromise;
}

function loadPlannotatorPrompts(): Promise<PlannotatorPromptModule> {
	if (!promptModulePromise) {
		promptModulePromise = import("./generated/prompts.ts").catch((error: unknown) => {
			promptModulePromise = undefined;
			throw error;
		});
	}
	return promptModulePromise;
}

function loadPlannotatorConfig(): Promise<PlannotatorConfigModule> {
	if (!configModulePromise) {
		configModulePromise = import("./generated/config.ts").catch((error: unknown) => {
			configModulePromise = undefined;
			throw error;
		});
	}
	return configModulePromise;
}

export interface AnnotationCommandDependencies {
	/** Deterministic test seam for the markdown browser starter. */
	startMarkdownAnnotationSession?: typeof startMarkdownAnnotationSession;
	/** Deterministic test seam for the last-message browser starter. */
	startLastMessageAnnotationSession?: typeof startLastMessageAnnotationSession;
}

type AnnotationCommandResult = {
	feedback: string;
	exit?: boolean;
	approved?: boolean;
	selectedMessageId?: string;
	feedbackScope?: "message" | "messages";
};

function sessionOpenedMessage(label: string, url: string): string {
	return isRemoteSession()
		? `${label} — open ${url} on your local machine (forward the port if needed). You can keep chatting while it runs.`
		: `${label}. You can keep chatting while it runs.`;
}

function reportBackgroundError(ctx: ExtensionCommandContext, message: string, error: unknown): void {
	const detail = getStartupErrorMessage(error);
	console.error(`${message}: ${detail}`);
	if (isBrowserSessionStoppedError(error)) {
		ctx.ui.notify("A Plannotator browser session was closed.", "info");
		return;
	}
	ctx.ui.notify(`${message}: ${detail}`, "error");
}

async function getOhMyPiModels(ctx: ExtensionCommandContext) {
	const { getOhMyPiModels: getModels } = await import("./omp.ts");
	return getModels(ctx);
}

async function sendAnnotationFeedback(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	prompt: string,
	notification?: string,
): Promise<void> {
	await pi.sendUserMessage(prompt, { deliverAs: "followUp" });
	if (notification) ctx.ui.notify(notification, "info");
}

async function handleFileAnnotationDecision(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	result: AnnotationCommandResult,
	absolutePath: string,
	isFolder: boolean,
): Promise<void> {
	const outcome = classifyAnnotateOutcome(result);
	if (outcome.notification === "closed") {
		ctx.ui.notify("Annotation session closed.", "info");
		return;
	}
	if (!outcome.feedback) {
		if (outcome.notification === "approved") {
			ctx.ui.notify("Annotation approved.", "info");
			return;
		}
		ctx.ui.notify("Annotation closed (no feedback).", "info");
		return;
	}

	const [{ getAnnotateApprovedWithNotesPrompt, getAnnotateFileFeedbackPrompt }, config] = await Promise.all([
		loadPlannotatorPrompts(),
		loadPlannotatorConfig(),
	]);
	const context = `${isFolder ? "Folder" : "File"}: ${absolutePath}`;
	const prompt = outcome.promptKind === "approved-with-notes"
		? getAnnotateApprovedWithNotesPrompt("oh-my-pi", config.loadConfig(), {
				context,
				feedback: outcome.feedback,
			})
		: getAnnotateFileFeedbackPrompt("oh-my-pi", config.loadConfig(), {
				fileHeader: isFolder ? "Folder" : "File",
				filePath: absolutePath,
				feedback: outcome.feedback,
			});
	await sendAnnotationFeedback(
		pi,
		ctx,
		prompt,
		outcome.notification === "approved" ? "Annotation approved." : undefined,
	);
}

async function handleLastMessageDecision(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	result: AnnotationCommandResult,
): Promise<void> {
	const outcome = classifyAnnotateOutcome(result);
	if (outcome.notification === "closed") {
		ctx.ui.notify("Annotation session closed.", "info");
		return;
	}
	if (!outcome.feedback) {
		if (outcome.notification === "approved") {
			ctx.ui.notify("Message approved.", "info");
			return;
		}
		ctx.ui.notify("Annotation closed (no feedback).", "info");
		return;
	}

	const [{ getAnnotateApprovedWithNotesPrompt, getAnnotateMessageFeedbackPrompt }, config] = await Promise.all([
		loadPlannotatorPrompts(),
		loadPlannotatorConfig(),
	]);
	const prompt = outcome.promptKind === "approved-with-notes"
		? getAnnotateApprovedWithNotesPrompt("oh-my-pi", config.loadConfig(), { feedback: outcome.feedback })
		: getAnnotateMessageFeedbackPrompt("oh-my-pi", config.loadConfig(), { feedback: outcome.feedback });
	await sendAnnotationFeedback(
		pi,
		ctx,
		prompt,
		outcome.notification === "approved" ? "Message approved." : undefined,
	);
}

async function handleAnnotateCommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: string,
	startSession: typeof startMarkdownAnnotationSession,
): Promise<void> {
	const {
		FILE_BROWSER_EXCLUDED,
		hasMarkdownFiles,
		parseAnnotateArgs,
		annotateInputNamesExistingTarget,
		buildAmbiguousAnnotateArgsMessage,
		buildUnresolvedAnnotateArgsMessage,
		probeAnnotateToken,
		selectAnnotateTokenTarget,
		resolveAtReference,
		resolveUserPath,
		isAnnotatableTextPath,
		ANNOTATABLE_DOC_REGEX,
		ANNOTATABLE_EXTENSIONS_HINT,
		MAX_ANNOTATABLE_FILE_BYTES,
	} = await loadAnnotateCommandModules();
	const {
		filePath: parsedFilePath,
		rawFilePath: parsedRawFilePath,
		gate,
		renderHtml: renderHtmlFlag,
		renderMarkdown: renderMarkdownFlag,
		noJina,
	} = parseAnnotateArgs(args ?? "");
	let filePath = parsedFilePath;
	let rawFilePath = parsedRawFilePath;
	if (!filePath) {
		ctx.ui.notify("Usage: /plannotator-annotate <file.md | file.txt | file.html | https://... | folder/> [--markdown] [--no-jina] [--gate] [--json]", "error");
		return;
	}

	if (!annotateInputNamesExistingTarget(rawFilePath, ctx.cwd)) {
		const selection = selectAnnotateTokenTarget(rawFilePath, (token: string) =>
			probeAnnotateToken(token, ctx.cwd, { bareDirectories: false }),
		);
		if (selection.kind === "single") {
			filePath = selection.candidate.value;
			rawFilePath = selection.candidate.value;
		} else if (selection.kind === "multiple") {
			ctx.ui.notify(buildAmbiguousAnnotateArgsMessage(selection.candidates), "error");
			return;
		} else if (selection.kind === "none" && selection.words.length > 1) {
			const tolerantFlags = [
				...(renderMarkdownFlag ? ["--markdown"] : []),
				...(noJina ? ["--no-jina"] : []),
				...(renderHtmlFlag ? ["--render-html"] : []),
			];
			ctx.ui.notify(buildUnresolvedAnnotateArgsMessage({ words: selection.words, flags: tolerantFlags }), "error");
			return;
		}
	}

	if (!hasPlanBrowserHtml()) {
		ctx.ui.notify("Annotation UI not available. Run 'bun run build:omp' from the repository root.", "error");
		return;
	}

	let markdown: string;
	let rawHtml: string | undefined;
	let absolutePath: string;
	let folderPath: string | undefined;
	let mode: "annotate" | "annotate-folder" | undefined;
	let sourceInfo: string | undefined;
	let sourceConverted = false;
	let isFolder = false;
	const isUrl = /^https?:\/\//i.test(filePath);

	if (isUrl) {
		const [{ resolveUseJina, loadConfig }, { urlToMarkdown, isConvertedSource }] = await Promise.all([
			loadPlannotatorConfig(),
			import("./generated/url-to-markdown.ts"),
		]);
		const useJina = resolveUseJina(noJina, loadConfig());
		ctx.ui.notify(`Fetching: ${filePath}${useJina ? " (via Jina Reader)" : " (via fetch+Turndown)"}...`, "info");
		try {
			const result = await urlToMarkdown(filePath, { useJina });
			markdown = result.markdown;
			sourceConverted = isConvertedSource(result.source);
		} catch (error) {
			ctx.ui.notify(`Failed to fetch URL: ${error instanceof Error ? error.message : String(error)}`, "error");
			return;
		}
		absolutePath = filePath;
		sourceInfo = filePath;
	} else {
		const resolvedCandidate = resolveAtReference(rawFilePath, (candidate: string) =>
			existsSync(resolveUserPath(candidate, ctx.cwd)),
		);
		if (resolvedCandidate === null) {
			absolutePath = resolveUserPath(filePath, ctx.cwd);
			ctx.ui.notify(`File not found: ${absolutePath}`, "error");
			return;
		}
		absolutePath = resolveUserPath(resolvedCandidate, ctx.cwd);
		try {
			isFolder = statSync(absolutePath).isDirectory();
		} catch {
			ctx.ui.notify(`Cannot access: ${absolutePath}`, "error");
			return;
		}

		if (isFolder) {
			if (!hasMarkdownFiles(absolutePath, FILE_BROWSER_EXCLUDED, ANNOTATABLE_DOC_REGEX)) {
				ctx.ui.notify(`No annotatable files (markdown, plain-text, config, or HTML) found in ${absolutePath}`, "error");
				return;
			}
			markdown = "";
			folderPath = absolutePath;
			mode = "annotate-folder";
			ctx.ui.notify(`Opening annotation UI for folder ${filePath}...`, "info");
		} else if (/\.html?$/i.test(absolutePath)) {
			const html = readFileSync(absolutePath, "utf-8");
			if (!renderMarkdownFlag) {
				rawHtml = html;
				markdown = "";
			} else {
				const { htmlToMarkdown } = await import("./generated/html-to-markdown.ts");
				markdown = htmlToMarkdown(html);
				sourceConverted = true;
			}
			sourceInfo = basename(absolutePath);
			ctx.ui.notify(`Opening annotation UI for ${filePath}...`, "info");
		} else {
			if (!isAnnotatableTextPath(absolutePath)) {
				ctx.ui.notify(`File type not supported. Supported types: ${ANNOTATABLE_EXTENSIONS_HINT}`, "error");
				return;
			}
			if (statSync(absolutePath).size > MAX_ANNOTATABLE_FILE_BYTES) {
				ctx.ui.notify(`File too large to annotate (max 2MB): ${absolutePath}`, "error");
				return;
			}
			markdown = readFileSync(absolutePath, "utf-8");
			ctx.ui.notify(`Opening annotation UI for ${filePath}...`, "info");
		}
	}

	try {
		const session = await startSession(
			ctx,
			absolutePath,
			markdown,
			mode ?? "annotate",
			folderPath,
			sourceInfo,
			sourceConverted,
			gate,
			rawHtml,
			!!rawHtml,
			renderMarkdownFlag,
			undefined,
			{ piModels: await getOhMyPiModels(ctx), piExecutablePath: "omp" },
		);
		ctx.ui.notify(sessionOpenedMessage("Annotation opened", session.url), "info");
		void session.waitForDecision()
			.then((result) => handleFileAnnotationDecision(pi, ctx, result, absolutePath, isFolder))
			.catch((error) => reportBackgroundError(ctx, "Plannotator annotation session failed", error));
	} catch (error) {
		if (isBrowserSessionStoppedError(error)) {
			ctx.ui.notify("A Plannotator browser session was closed.", "info");
			return;
		}
		ctx.ui.notify(`Failed to start annotation UI: ${getStartupErrorMessage(error)}`, "error");
	}
}

async function handleLastCommand(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	args: string,
	startSession: typeof startLastMessageAnnotationSession,
): Promise<void> {
	const { parseAnnotateArgs } = await loadAnnotateCommandModules();
	const { gate } = parseAnnotateArgs(args ?? "");
	if (!hasPlanBrowserHtml()) {
		ctx.ui.notify("Annotation UI not available. Run 'bun run build:omp' from the repository root.", "error");
		return;
	}

	const snapshot = getLastAssistantMessageSnapshot(ctx);
	if (!snapshot) {
		ctx.ui.notify("No assistant message found in session.", "error");
		return;
	}
	const recent = getRecentAssistantMessages(ctx, 25);
	const pickerMessages = recent.length > 1 ? recent : undefined;
	ctx.ui.notify("Opening annotation UI for last message...", "info");
	try {
		const session = await startSession(
			ctx,
			snapshot.text,
			gate,
			pickerMessages,
			{ piModels: await getOhMyPiModels(ctx), piExecutablePath: "omp" },
		);
		ctx.ui.notify(sessionOpenedMessage("Last-message annotation opened", session.url), "info");
		void session.waitForDecision()
			.then((result) => handleLastMessageDecision(pi, ctx, result))
			.catch((error) => reportBackgroundError(ctx, "Plannotator message annotation session failed", error));
	} catch (error) {
		if (isBrowserSessionStoppedError(error)) {
			ctx.ui.notify("A Plannotator browser session was closed.", "info");
			return;
		}
		ctx.ui.notify(`Failed to start annotation UI: ${getStartupErrorMessage(error)}`, "error");
	}
}

export function registerAnnotationCommands(
	pi: ExtensionAPI,
	dependencies: AnnotationCommandDependencies = {},
): void {
	const markdownStarter = dependencies.startMarkdownAnnotationSession ?? startMarkdownAnnotationSession;
	const lastMessageStarter = dependencies.startLastMessageAnnotationSession ?? startLastMessageAnnotationSession;

	pi.registerCommand("plannotator-annotate", {
		description: "Open markdown file or folder in annotation UI",
		handler: async (args, ctx) => {
			await handleAnnotateCommand(pi, ctx, args ?? "", markdownStarter);
		},
	});
	pi.registerCommand("plannotator-last", {
		description: "Annotate the last assistant message",
		handler: async (args, ctx) => {
			await handleLastCommand(pi, ctx, args ?? "", lastMessageStarter);
		},
	});
}
