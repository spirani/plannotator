import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { watch } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { startReviewServer } from "./serverReview.ts";

const tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

async function waitForFile(path: string): Promise<void> {
	const directory = dirname(path);
	const filename = basename(path);
	const iterator = watch(directory)[Symbol.asyncIterator]();
	try {
		if (existsSync(path)) return;
		while (true) {
			const event = await iterator.next();
			if (event.done) throw new Error(`Stopped waiting for ${path}`);
			if (event.value.filename === filename && existsSync(path)) return;
		}
	} finally {
		await iterator.return?.();
	}
}

describe("guided review with Oh My Pi", () => {
	test("spawns OMP instead of standalone Pi for the selected model", async () => {
		if (process.platform === "win32") return;

		const dir = mkdtempSync(join(tmpdir(), "plannotator-review-omp-guide-"));
		tempDirs.push(dir);
		const omp = join(dir, "omp");
		const argvLog = join(dir, "argv");
		writeFileSync(omp, `#!/bin/sh
printf '%s\\n' "$@" > ${JSON.stringify(argvLog)}
`);
		chmodSync(omp, 0o755);

		const server = await startReviewServer({
			rawPatch: "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-before\n+after\n",
			gitRef: "HEAD",
			htmlContent: "<!doctype html><html><body>review</body></html>",
			origin: "pi",
			piModels: [{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", default: true }],
			piExecutablePath: omp,
		});

		try {
			const response = await fetch(`${server.url}/api/agents/jobs`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					provider: "guide",
					engine: "pi",
					model: "anthropic/claude-sonnet-4-5",
					thinking: "high",
				}),
			});
			expect(response.status).toBe(201);

			await waitForFile(argvLog);
			const argv = readFileSync(argvLog, "utf-8").trim().split("\n");
			expect(argv).toContain("--approval-mode");
			expect(argv[argv.indexOf("--approval-mode") + 1]).toBe("yolo");
			expect(argv[argv.indexOf("--model") + 1]).toBe("anthropic/claude-sonnet-4-5");
			expect(argv[argv.indexOf("--thinking") + 1]).toBe("high");
		} finally {
			server.stop();
		}
	});
});
