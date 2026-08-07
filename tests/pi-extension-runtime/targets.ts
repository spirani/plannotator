import { resolve } from "node:path";

import * as piAnnotateOutcome from "../../apps/pi-extension/annotate-outcome.ts";
import * as piBrowser from "../../apps/pi-extension/plannotator-browser.ts";
import * as piServer from "../../apps/pi-extension/server.ts";
import * as piAgentTerminal from "../../apps/pi-extension/server/agent-terminal.ts";
import * as piFileBrowserWatch from "../../apps/pi-extension/server/file-browser-watch.ts";
import * as piNetwork from "../../apps/pi-extension/server/network.ts";
import * as piServerPlan from "../../apps/pi-extension/server/serverPlan.ts";
import * as piServerReview from "../../apps/pi-extension/server/serverReview.ts";
import { WorkspaceReviewSession as piWorkspaceReviewSession } from "../../apps/pi-extension/generated/review-workspace.ts";
import { parseReviewArgs as piParseReviewArgs } from "../../apps/pi-extension/generated/review-args.ts";
import { warmFileListCache as piWarmFileListCache } from "../../apps/pi-extension/generated/resolve-file.ts";
import { AGENT_TERMINAL_WS_BASE_PATH as piAgentTerminalWsBasePath } from "../../apps/pi-extension/generated/agent-terminal.ts";
import { deriveAnnotateHistorySlug as piDeriveAnnotateHistorySlug } from "../../apps/pi-extension/generated/annotate-history.ts";
import { getPlannotatorDataDir as piGetPlannotatorDataDir } from "../../apps/pi-extension/generated/data-dir.ts";

import * as ompAnnotateOutcome from "../../apps/oh-my-pi-extension/annotate-outcome.ts";
import * as ompBrowser from "../../apps/oh-my-pi-extension/plannotator-browser.ts";
import * as ompServer from "../../apps/oh-my-pi-extension/server.ts";
import * as ompAgentTerminal from "../../apps/oh-my-pi-extension/server/agent-terminal.ts";
import * as ompFileBrowserWatch from "../../apps/oh-my-pi-extension/server/file-browser-watch.ts";
import * as ompNetwork from "../../apps/oh-my-pi-extension/server/network.ts";
import * as ompServerPlan from "../../apps/oh-my-pi-extension/server/serverPlan.ts";
import * as ompServerReview from "../../apps/oh-my-pi-extension/server/serverReview.ts";
import { WorkspaceReviewSession as ompWorkspaceReviewSession } from "../../apps/oh-my-pi-extension/generated/review-workspace.ts";
import { parseReviewArgs as ompParseReviewArgs } from "../../apps/oh-my-pi-extension/generated/review-args.ts";
import { warmFileListCache as ompWarmFileListCache } from "../../apps/oh-my-pi-extension/generated/resolve-file.ts";
import { AGENT_TERMINAL_WS_BASE_PATH as ompAgentTerminalWsBasePath } from "../../apps/oh-my-pi-extension/generated/agent-terminal.ts";
import { deriveAnnotateHistorySlug as ompDeriveAnnotateHistorySlug } from "../../apps/oh-my-pi-extension/generated/annotate-history.ts";
import { getPlannotatorDataDir as ompGetPlannotatorDataDir } from "../../apps/oh-my-pi-extension/generated/data-dir.ts";

export interface ExtensionRuntimeTarget {
	label: string;
	extensionRoot: string;
	canonicalRuntimeSourceRoot: string;
	annotateOutcome: typeof piAnnotateOutcome;
	browser: typeof piBrowser;
	server: typeof piServer;
	agentTerminal: typeof piAgentTerminal;
	fileBrowserWatch: typeof piFileBrowserWatch;
	network: typeof piNetwork;
	serverPlan: typeof piServerPlan;
	serverReview: typeof piServerReview;
	WorkspaceReviewSession: typeof piWorkspaceReviewSession;
	parseReviewArgs: typeof piParseReviewArgs;
	warmFileListCache: typeof piWarmFileListCache;
	agentTerminalWsBasePath: typeof piAgentTerminalWsBasePath;
	deriveAnnotateHistorySlug: typeof piDeriveAnnotateHistorySlug;
	getPlannotatorDataDir: typeof piGetPlannotatorDataDir;
}

const root = resolve(import.meta.dir, "../..");
const canonicalRuntimeSourceRoot = resolve(root, "packages/pi-extension/runtime");

export const piRuntimeTarget: ExtensionRuntimeTarget = {
	label: "Pi",
	extensionRoot: resolve(root, "apps/pi-extension"),
	canonicalRuntimeSourceRoot,
	annotateOutcome: piAnnotateOutcome,
	browser: piBrowser,
	server: piServer,
	agentTerminal: piAgentTerminal,
	fileBrowserWatch: piFileBrowserWatch,
	network: piNetwork,
	serverPlan: piServerPlan,
	serverReview: piServerReview,
	WorkspaceReviewSession: piWorkspaceReviewSession,
	parseReviewArgs: piParseReviewArgs,
	warmFileListCache: piWarmFileListCache,
	agentTerminalWsBasePath: piAgentTerminalWsBasePath,
	deriveAnnotateHistorySlug: piDeriveAnnotateHistorySlug,
	getPlannotatorDataDir: piGetPlannotatorDataDir,
};

export const ompRuntimeTarget: ExtensionRuntimeTarget = {
	label: "Oh My Pi",
	extensionRoot: resolve(root, "apps/oh-my-pi-extension"),
	canonicalRuntimeSourceRoot,
	annotateOutcome: ompAnnotateOutcome,
	browser: ompBrowser,
	server: ompServer,
	agentTerminal: ompAgentTerminal,
	fileBrowserWatch: ompFileBrowserWatch,
	network: ompNetwork,
	serverPlan: ompServerPlan,
	serverReview: ompServerReview,
	WorkspaceReviewSession: ompWorkspaceReviewSession,
	parseReviewArgs: ompParseReviewArgs,
	warmFileListCache: ompWarmFileListCache,
	agentTerminalWsBasePath: ompAgentTerminalWsBasePath,
	deriveAnnotateHistorySlug: ompDeriveAnnotateHistorySlug,
	getPlannotatorDataDir: ompGetPlannotatorDataDir,
};

export const extensionRuntimeTargets = [piRuntimeTarget, ompRuntimeTarget] as const;
