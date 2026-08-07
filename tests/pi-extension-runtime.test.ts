import { extensionRuntimeTargets } from "./pi-extension-runtime/targets.ts";
import { registerAgentTerminalSuite } from "./pi-extension-runtime/agent-terminal.suite.ts";
import { registerAnnotateHistorySuite } from "./pi-extension-runtime/annotate-history.suite.ts";
import { registerAnnotateOutcomeSuite } from "./pi-extension-runtime/annotate-outcome.suite.ts";
import { registerFileBrowserWatchSuite } from "./pi-extension-runtime/file-browser-watch.suite.ts";
import { registerImportSpecifiersSuite } from "./pi-extension-runtime/import-specifiers.suite.ts";
import { registerNetworkSuite } from "./pi-extension-runtime/network.suite.ts";
import { registerPlannotatorBrowserSuite } from "./pi-extension-runtime/plannotator-browser.suite.ts";
import { registerPortPreemptionSuite } from "./pi-extension-runtime/port-preemption.suite.ts";
import { registerPortStartupCompatSuite } from "./pi-extension-runtime/port-startup-compat.suite.ts";
import { registerServerReviewPrActionSuite } from "./pi-extension-runtime/serverReview-pr-action.suite.ts";
import { registerServerSuite } from "./pi-extension-runtime/server.suite.ts";

for (const target of extensionRuntimeTargets) {
	registerAnnotateOutcomeSuite(target);
	registerImportSpecifiersSuite(target);
	registerPlannotatorBrowserSuite(target);
	registerPortPreemptionSuite(target);
	registerServerSuite(target);
	registerServerReviewPrActionSuite(target);
	registerAgentTerminalSuite(target);
	registerAnnotateHistorySuite(target);
	registerFileBrowserWatchSuite(target);
	registerNetworkSuite(target);
	registerPortStartupCompatSuite(target);
}
