import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { createPiAIRuntime } from "../apps/oh-my-pi-extension/server/ai-runtime.ts";

function writeText(path: string, content: string): void {
	writeFileSync(path, content.replace(/\n/g, "\r\n"), "utf-8");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeTempDirWithRetry(path: string): Promise<void> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 20; attempt++) {
		try {
			rmSync(path, { recursive: true, force: true });
			return;
		} catch (error) {
			lastError = error;
			await sleep(250);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function main(): Promise<void> {
	if (process.platform !== "win32") {
		console.log("Skipping Oh My Pi extension AI runtime smoke: Windows-only.");
		return;
	}

	const tempDir = mkdtempSync(join(tmpdir(), "plannotator-omp-ai-smoke-"));
	const fakeBin = join(tempDir, "bin");
	const pathEnvKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const originalPath = process.env[pathEnvKey] ?? "";
	const models = [{ id: "fake/omp-windows-smoke", label: "OMP Windows smoke", default: true }];
	const spawnedPath = join(fakeBin, "spawned.txt");
	const commandsPath = join(fakeBin, "commands.txt");

	try {
		mkdirSync(fakeBin, { recursive: true });
		writeText(
			join(fakeBin, "where.cmd"),
			`@echo off
if /I "%~1"=="omp" (
  echo %~dp0omp
  echo %~dp0omp.cmd
  exit /b 0
)
exit /b 1
`,
		);
		writeText(join(fakeBin, "omp"), "extensionless npm shim placeholder\n");
		writeText(
			join(fakeBin, "omp.cmd"),
			`@echo off
node "%~dp0omp-rpc.cjs" %*
`,
		);
		writeFileSync(
			join(fakeBin, "omp-rpc.cjs"),
			`
const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline");
const spawnedPath = ${JSON.stringify(spawnedPath)};
const commandsPath = ${JSON.stringify(commandsPath)};
fs.writeFileSync(spawnedPath, process.argv.slice(2).join(" "), "utf8");
const rl = readline.createInterface({ input: process.stdin });
function response(message, data = {}) {
  process.stdout.write(JSON.stringify({ type: "response", id: message.id, success: true, data }) + "\\n");
}
rl.on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  fs.appendFileSync(commandsPath, message.type + "\\n", "utf8");
  if (message.type === "set_model") {
    response(message);
  } else if (message.type === "get_state") {
    response(message, { sessionId: "omp-windows-smoke-session" });
  } else if (message.type === "prompt") {
    process.stdout.write(JSON.stringify({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "OK" } }) + "\\n");
    response(message);
    process.stdout.write(JSON.stringify({ type: "agent_end" }) + "\\n");
  } else {
    response(message);
  }
});
setInterval(() => {}, 1000);
`,
			"utf-8",
		);

		process.env[pathEnvKey] = `${fakeBin}${delimiter}${originalPath}`;
		const runtime = await createPiAIRuntime({
			cwd: tempDir,
			getCwd: () => tempDir,
			piExecutablePath: "omp",
			models,
		});
		if (!runtime) throw new Error("createPiAIRuntime returned null");

		try {
			const capabilities = await runtime.endpoints["/api/ai/capabilities"](
				new Request("http://localhost/api/ai/capabilities"),
			);
			if (!capabilities.ok) throw new Error(`/api/ai/capabilities returned ${capabilities.status}`);
			const body = (await capabilities.json()) as {
				providers?: Array<{ id: string; name: string; models?: Array<{ id: string; label: string; default?: boolean }> }>;
			};
			const piProvider = body.providers?.find((provider) => provider.id === "pi-sdk");
			if (!piProvider) throw new Error(`pi-sdk provider missing: ${JSON.stringify(body)}`);
			if (JSON.stringify(piProvider.models) !== JSON.stringify(models)) {
				throw new Error(`OMP model catalog mismatch: ${JSON.stringify(piProvider.models)}`);
			}
			if (existsSync(spawnedPath) && readFileSync(spawnedPath, "utf-8")) {
				throw new Error("OMP process was spawned during capabilities discovery");
			}

			const session = await runtime.endpoints["/api/ai/session"](
				new Request("http://localhost/api/ai/session", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						context: {
							mode: "annotate",
							annotate: { content: "# OMP smoke", filePath: join(tempDir, "README.md") },
						},
						providerId: "pi-sdk",
						model: models[0].id,
					}),
				}),
			);
			if (!session.ok) throw new Error(`/api/ai/session returned ${session.status}: ${await session.text()}`);
			const sessionBody = (await session.json()) as { sessionId?: string };
			if (!sessionBody.sessionId) throw new Error("OMP smoke session did not return an id");

			const query = await runtime.endpoints["/api/ai/query"](
				new Request("http://localhost/api/ai/query", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ sessionId: sessionBody.sessionId, prompt: "Reply with exactly OK." }),
				}),
			);
			if (!query.ok) throw new Error(`/api/ai/query returned ${query.status}: ${await query.text()}`);
			const queryText = await query.text();
			if (!queryText.includes('"type":"text_delta"') || !queryText.includes('"type":"result"')) {
				throw new Error(`OMP smoke stream missing text/result events: ${queryText}`);
			}
			if (readFileSync(spawnedPath, "utf-8") !== "--mode rpc") {
				throw new Error(`omp.cmd did not receive --mode rpc: ${readFileSync(spawnedPath, "utf-8")}`);
			}
			const commands = readFileSync(commandsPath, "utf-8").trim().split(/\r?\n/);
			for (const command of ["set_model", "get_state", "prompt"]) {
				if (!commands.includes(command)) throw new Error(`OMP RPC command missing: ${command}`);
			}
			console.log("Oh My Pi extension AI runtime Windows shim smoke passed.");
		} finally {
			runtime.dispose();
		}
	} finally {
		process.env[pathEnvKey] = originalPath;
		await removeTempDirWithRetry(tempDir);
	}
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
