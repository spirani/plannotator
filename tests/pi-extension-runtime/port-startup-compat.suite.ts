import { afterEach, describe, expect, test } from "bun:test";
import { createTestEnvironment } from "../helpers/environment.ts";
import { closeServer, occupyConsecutivePorts } from "../helpers/ports.ts";
import type { ExtensionRuntimeTarget } from "./targets.ts";

export function registerPortStartupCompatSuite(target: ExtensionRuntimeTarget): void {
	const { openBrowser } = target.network;
	const { startPlanReviewServer } = target.serverPlan;
	describe(target.label, () => {
const envKeys = [
	"PLANNOTATOR_PORT",
	"PLANNOTATOR_REMOTE",
	"PLANNOTATOR_DATA_DIR",
	"PLANNOTATOR_BROWSER",
	"BROWSER",
] as const;
const environment = createTestEnvironment(envKeys, "plannotator-pi-port-compat-");

afterEach(() => environment.restore());

describe("Pi startup port compatibility", () => {
	test("unset local startup keeps its random URL for browser handoff", async () => {
		environment.reset();
		process.env.PLANNOTATOR_REMOTE = "0";
		process.env.PLANNOTATOR_DATA_DIR = environment.makeTempDir();

		const server = await startPlanReviewServer({
			plan: "# Port compatibility",
			origin: "pi",
			htmlContent: "<!doctype html><html><body>plan</body></html>",
		});

		try {
			expect(server.port).toBeGreaterThan(0);
			expect(server.portSource).toBe("random");
			expect(server.url).toBe(`http://localhost:${server.port}`);

			process.env.PLANNOTATOR_REMOTE = "1";
			process.env.BROWSER = "true";
			expect(await openBrowser(server.url)).toEqual({
				opened: false,
				isRemote: true,
				url: server.url,
			});
		} finally {
			server.stop();
		}
	});

	test("a fixed numeric port keeps the same server URL", async () => {
		environment.reset();
		const { start, servers } = await occupyConsecutivePorts(1);
		await closeServer(servers[0]);
		process.env.PLANNOTATOR_REMOTE = "0";
		process.env.PLANNOTATOR_PORT = String(start);
		process.env.PLANNOTATOR_DATA_DIR = environment.makeTempDir();

		const server = await startPlanReviewServer({
			plan: "# Fixed port compatibility",
			origin: "pi",
			htmlContent: "<!doctype html><html><body>plan</body></html>",
		});

		try {
			expect(server.port).toBe(start);
			expect(server.portSource).toBe("env");
			expect(server.url).toBe(`http://localhost:${start}`);
		} finally {
			server.stop();
		}
	});
});

	});
}
