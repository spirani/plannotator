import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAnnotateServer } from "./serverAnnotate.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("annotation Ask AI", () => {
	test("uses the OMP executable and its enabled model catalog", async () => {
		if (process.platform === "win32") return;
		const dir = mkdtempSync(join(tmpdir(), "plannotator-annotate-omp-ai-"));
		tempDirs.push(dir);
		const omp = join(dir, "omp");
		writeFileSync(
			omp,
			`#!/bin/sh
while IFS= read -r line; do
	id=$(printf '%s' "$line" | sed -n 's/.*"id":"\\([^"\\]*\\)".*/\\1/p')
	case "$line" in
		*'"type":"prompt"'*)
			printf '%s\\n' '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"OK"}}'
			printf '{"type":"response","id":"%s","success":true,"data":{}}\\n' "$id"
			printf '%s\\n' '{"type":"agent_end"}'
			;;
		*)
			printf '{"type":"response","id":"%s","success":true,"data":{"sessionId":"fake-session"}}\\n' "$id"
			;;
	esac
done
`,
		);
		chmodSync(omp, 0o755);
		const models = [{ id: "fake/omp", label: "Fake OMP", default: true }];
		const server = await startAnnotateServer({
			markdown: "# Annotate",
			filePath: join(dir, "README.md"),
			htmlContent: "<!doctype html><html><body>annotate</body></html>",
			origin: "oh-my-pi",
			piModels: models,
			piExecutablePath: omp,
		});
		try {
			const capabilities = await fetch(`${server.url}/api/ai/capabilities`);
			expect(capabilities.status).toBe(200);
			const capabilityBody = await capabilities.json() as {
				providers: Array<{ id: string; models: unknown }>;
			};
			expect(capabilityBody.providers.find((provider) => provider.id === "pi-sdk")?.models).toEqual(models);

			const session = await fetch(`${server.url}/api/ai/session`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					context: {
						mode: "annotate",
						annotate: {
							content: "# Annotate",
							filePath: join(dir, "README.md"),
						},
					},
					providerId: "pi-sdk",
					model: "fake/omp",
				}),
			});
			const sessionBody = await session.json() as { sessionId?: string; error?: string };
			if (session.status !== 200) throw new Error(JSON.stringify(sessionBody));
			if (!sessionBody.sessionId) throw new Error("Annotation Ask AI session did not return an id.");
			const query = await fetch(`${server.url}/api/ai/query`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ sessionId: sessionBody.sessionId, prompt: "Reply with exactly OK." }),
			});
			expect(query.status).toBe(200);
			expect(await query.text()).toContain('"type":"text_delta"');
		} finally {
			server.stop();
		}
	});
});
