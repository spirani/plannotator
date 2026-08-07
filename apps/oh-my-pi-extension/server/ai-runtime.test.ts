import { afterEach, describe, expect, test } from "bun:test";
import {
	chmodSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("createPiAIRuntime Codex discovery", () => {
	test("capabilities does not execute Codex and session activation does", async () => {
		if (process.platform === "win32") return;

		const dir = mkdtempSync(join(tmpdir(), "plannotator-pi-lazy-codex-"));
		tempDirs.push(dir);
		const marker = join(dir, "codex-ran");
		const codex = join(dir, "codex");
		writeFileSync(codex, `#!/bin/sh\necho ran > '${marker}'\nexit 1\n`);
		chmodSync(codex, 0o755);

		const runner = join(dir, "runner.ts");
		const runtimeUrl = pathToFileURL(join(import.meta.dir, "ai-runtime.ts")).href;
		writeFileSync(runner, `
			import { existsSync } from "node:fs";
			import { createPiAIRuntime } from ${JSON.stringify(runtimeUrl)};
			const runtime = await createPiAIRuntime({ cwd: ${JSON.stringify(dir)} });
			if (!runtime) throw new Error("Pi AI runtime unavailable");
			const capabilities = await runtime.endpoints["/api/ai/capabilities"](
				new Request("http://localhost/api/ai/capabilities"),
			);
			const data = await capabilities.json();
			const afterCapabilities = existsSync(${JSON.stringify(marker)});
			const session = await runtime.endpoints["/api/ai/session"](
				new Request("http://localhost/api/ai/session", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						context: { mode: "plan-review", plan: { plan: "# Test" } },
						providerId: "codex-sdk",
					}),
				}),
			);
			console.log(JSON.stringify({
				hasCodex: data.providers.some((provider) => provider.id === "codex-sdk"),
				afterCapabilities,
				sessionStatus: session.status,
				afterSession: existsSync(${JSON.stringify(marker)}),
			}));
			runtime.dispose();
		`);

		const proc = Bun.spawn([process.execPath, runner], {
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout.trim())).toEqual({
			hasCodex: true,
			afterCapabilities: false,
			sessionStatus: 200,
			afterSession: true,
		});
	}, 15_000);
	test("uses an embedded model catalog for the Pi-compatible provider", async () => {
		if (process.platform === "win32") return;

		const dir = mkdtempSync(join(tmpdir(), "plannotator-pi-host-models-"));
		tempDirs.push(dir);
		const omp = join(dir, "omp");
		writeFileSync(omp, "#!/bin/sh\nexit 0\n");
		chmodSync(omp, 0o755);

		const runner = join(dir, "runner.ts");
		const runtimeUrl = pathToFileURL(join(import.meta.dir, "ai-runtime.ts")).href;
		writeFileSync(runner, `
			import { createPiAIRuntime } from ${JSON.stringify(runtimeUrl)};
			const runtime = await createPiAIRuntime({
				cwd: ${JSON.stringify(dir)},
				piExecutablePath: "omp",
				models: [
					{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", default: true },
					{ id: "openai/gpt-5", label: "GPT-5" },
				],
			});
			if (!runtime) throw new Error("Pi AI runtime unavailable");
			const response = await runtime.endpoints["/api/ai/capabilities"](
				new Request("http://localhost/api/ai/capabilities"),
			);
			const data = await response.json();
			console.log(JSON.stringify({
				status: response.status,
				pi: data.providers.find((provider) => provider.id === "pi-sdk"),
			}));
			runtime.dispose();
		`);

		const proc = Bun.spawn([process.execPath, runner], {
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout.trim())).toMatchObject({
			status: 200,
			pi: {
				id: "pi-sdk",
				name: "pi-sdk",
				models: [
					{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", default: true },
					{ id: "openai/gpt-5", label: "GPT-5" },
				],
			},
		});
	}, 15_000);
	test("answers Ask AI queries through the embedded Oh My Pi process", async () => {
		if (process.platform === "win32") return;

		const dir = mkdtempSync(join(tmpdir(), "plannotator-pi-ask-ai-"));
		tempDirs.push(dir);
		const omp = join(dir, "omp");
		writeFileSync(
			omp,
			`#!/bin/sh
while IFS= read -r line; do
	id=$(printf '%s' "$line" | sed -n 's/.*"id":"\\([^"]*\\)".*/\\1/p')
	case "$line" in
		*'"type":"prompt"'*)
			printf '%s\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"OK"}}'
			printf '{"type":"response","id":"%s","success":true,"data":{}}\n' "$id"
			printf '%s\n' '{"type":"agent_end"}'
			;;
		*)
			printf '{"type":"response","id":"%s","success":true,"data":{"sessionId":"fake-session"}}\n' "$id"
			;;
	esac
done
`,
		);
		chmodSync(omp, 0o755);

		const { createPiAIRuntime } = await import("./ai-runtime.ts?ask-ai-test");
		const runtime = await createPiAIRuntime({
			cwd: dir,
			piExecutablePath: omp,
			models: [{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", default: true }],
		});
		if (!runtime) throw new Error("Pi AI runtime unavailable");

		const session = await runtime.endpoints["/api/ai/session"](
			new Request("http://localhost/api/ai/session", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					context: { mode: "code-review", diff: "No files changed.", plan: "" },
					providerId: "pi-sdk",
					model: "anthropic/claude-sonnet-4-5",
				}),
			}),
		);
		expect(session.status).toBe(200);
		const sessionBody = await session.json() as { sessionId: string };

		const query = await runtime.endpoints["/api/ai/query"](
			new Request("http://localhost/api/ai/query", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					sessionId: sessionBody.sessionId,
					prompt: "Reply with exactly OK.",
				}),
			}),
		);
		expect(query.status).toBe(200);
		expect(await query.text()).toContain('"type":"text_delta"');
		runtime.dispose();
	});

	test("capabilities?activate= runs discovery once and shares it with the session path", async () => {
		if (process.platform === "win32") return;

		const dir = mkdtempSync(join(tmpdir(), "plannotator-pi-activate-codex-"));
		tempDirs.push(dir);
		const marker = join(dir, "codex-ran");
		const codex = join(dir, "codex");
		writeFileSync(codex, `#!/bin/sh\necho ran >> '${marker}'\nexit 1\n`);
		chmodSync(codex, 0o755);

		const runner = join(dir, "runner.ts");
		const runtimeUrl = pathToFileURL(join(import.meta.dir, "ai-runtime.ts")).href;
		writeFileSync(runner, `
			import { existsSync, readFileSync } from "node:fs";
			import { createPiAIRuntime } from ${JSON.stringify(runtimeUrl)};
			const runs = () => existsSync(${JSON.stringify(marker)})
				? readFileSync(${JSON.stringify(marker)}, "utf8").trim().split("\\n").length
				: 0;
			const runtime = await createPiAIRuntime({ cwd: ${JSON.stringify(dir)} });
			if (!runtime) throw new Error("Pi AI runtime unavailable");
			const probe = await runtime.endpoints["/api/ai/capabilities"](
				new Request("http://localhost/api/ai/capabilities"),
			);
			const runsAfterProbe = runs();
			const activate = await runtime.endpoints["/api/ai/capabilities"](
				new Request("http://localhost/api/ai/capabilities?activate=codex-sdk"),
			);
			const runsAfterActivate = runs();
			const session = await runtime.endpoints["/api/ai/session"](
				new Request("http://localhost/api/ai/session", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						context: { mode: "plan-review", plan: { plan: "# Test" } },
						providerId: "codex-sdk",
					}),
				}),
			);
			console.log(JSON.stringify({
				probeStatus: probe.status,
				runsAfterProbe,
				activateStatus: activate.status,
				runsAfterActivate,
				sessionStatus: session.status,
				runsAfterSession: runs(),
			}));
			runtime.dispose();
		`);

		const proc = Bun.spawn([process.execPath, runner], {
			cwd: join(import.meta.dir, ".."),
			env: { ...process.env, PATH: `${dir}:/usr/bin:/bin` },
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
			proc.exited,
		]);
		expect(exitCode, stderr).toBe(0);
		expect(JSON.parse(stdout.trim())).toEqual({
			probeStatus: 200,
			runsAfterProbe: 0,
			activateStatus: 200,
			runsAfterActivate: 1,
			sessionStatus: 200,
			runsAfterSession: 1,
		});
	}, 15_000);
});
