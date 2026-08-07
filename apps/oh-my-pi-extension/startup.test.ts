import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlannotatorBrowser } from "./plannotator-browser-runtime.ts";

const extensionDirectory = dirname(fileURLToPath(import.meta.url));

function scanImports(filename: string): { eager: Set<string>; dynamic: Set<string> } {
	const source = readFileSync(join(extensionDirectory, filename), "utf-8");
	const imports = new Bun.Transpiler({ loader: "ts" }).scan(source).imports;
	return {
		eager: new Set(imports.filter((entry) => entry.kind === "import-statement").map((entry) => entry.path)),
		dynamic: new Set(imports.filter((entry) => entry.kind === "dynamic-import").map((entry) => entry.path)),
	};
}

describe("Oh My Pi extension startup boundary", () => {
	test("keeps invocation-only modules out of the eager OMP entry and annotation graphs", () => {
		const entryImports = scanImports("omp.ts");
		const annotationImports = scanImports("annotation-commands.ts");
		const invocationOnlyModules = [
			"./generated/annotate-args.ts",
			"./generated/annotate-target.ts",
			"./generated/at-reference.ts",
			"./generated/html-to-markdown.ts",
			"./generated/prompts.ts",
			"./generated/reference-common.ts",
			"./generated/resolve-file.ts",
			"./generated/url-to-markdown.ts",
			"./generated/config.ts",
			"./plannotator-browser.ts",
		];

		for (const modulePath of invocationOnlyModules) {
			expect(entryImports.eager).not.toContain(modulePath);
			expect(annotationImports.eager).not.toContain(modulePath);
			if (modulePath !== "./plannotator-browser.ts") {
				expect(annotationImports.dynamic).toContain(modulePath);
			}
		}
	});

	test("loads the browser/server graph only through the shared dynamic boundary", () => {
		const eventImports = scanImports("plannotator-events.ts");
		const runtimeImports = scanImports("plannotator-browser-runtime.ts");

		expect(eventImports.eager).not.toContain("./plannotator-browser.ts");
		expect(eventImports.eager).toContain("./plannotator-browser-runtime.ts");
		expect(runtimeImports.eager).not.toContain("./plannotator-browser.ts");
		expect(runtimeImports.dynamic).toContain("./plannotator-browser.ts");
	});

	test("coalesces concurrent first-use browser imports", async () => {
		const first = loadPlannotatorBrowser();
		const second = loadPlannotatorBrowser();

		expect(second).toBe(first);
		const browser = await first;
		expect(browser.startPlanReviewBrowserSession).toBeFunction();
		expect(browser.startCodeReviewBrowserSession).toBeFunction();
		expect(browser.startMarkdownAnnotationSession).toBeFunction();
	});

	test("ships the retained OMP runtime and annotation adapter in the npm package", () => {
		const manifest = JSON.parse(
			readFileSync(join(extensionDirectory, "package.json"), "utf-8"),
		) as { files?: unknown };

		expect(Array.isArray(manifest.files)).toBe(true);
		expect(manifest.files).toContain("plannotator-browser-runtime.ts");
		expect(manifest.files).toContain("annotation-commands.ts");
		expect(manifest.files).not.toContain("todo-providers/");
		expect(manifest.files).not.toContain("index.ts");
	});
});
