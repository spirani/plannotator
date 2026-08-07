import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ExtensionAPI, ExtensionCommandContext } from "@oh-my-pi/pi-coding-agent";
import { registerAnnotationCommands } from "./annotation-commands.ts";

type Decision = {
	feedback: string;
	exit?: boolean;
	approved?: boolean;
	selectedMessageId?: string;
	feedbackScope?: "message" | "messages";
};

const tempDirectories: string[] = [];

afterEach(() => {
	for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function makeContext(cwd: string, branch: unknown[] = []) {
	const notifications: Array<{ message: string; type?: string }> = [];
	const ctx = {
		cwd,
		hasUI: true,
		model: { provider: "anthropic", id: "claude-sonnet-4-5" },
		models: {
			current: () => ({ provider: "anthropic", id: "claude-sonnet-4-5" }),
			list: () => [{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }],
		},
		sessionManager: { getBranch: () => branch },
		ui: {
			notify(message: string, type?: string) {
				notifications.push({ message, type });
			},
		},
	};
	return { ctx: ctx as unknown as ExtensionCommandContext, notifications };
}

function registerHarness(dependencies: Parameters<typeof registerAnnotationCommands>[1] = {}) {
	const commands = new Map<string, { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>; description?: string }>();
	const messages: Array<{ text: string; options: unknown }> = [];
	const pi = {
		registerCommand(name: string, options: { handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>; description?: string }) {
			commands.set(name, options);
		},
		sendUserMessage(text: string, options: unknown) {
			messages.push({ text, options });
		},
	} as unknown as ExtensionAPI;
	registerAnnotationCommands(pi, dependencies);
	return { commands, messages };
}

function session(decision: Decision) {
	let resolveDecision!: (value: Decision) => void;
	const decisionPromise = new Promise<Decision>((resolve) => {
		resolveDecision = resolve;
	});
	return {
		url: "http://127.0.0.1:43123",
		waitForDecision: () => decisionPromise,
		stop: () => {},
		resolve: () => resolveDecision(decision),
	};
}

async function flushDecision() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Oh My Pi annotation commands", () => {
	test("registers exact direct and last-message commands", () => {
		const { commands } = registerHarness();
		expect(commands.get("plannotator-annotate")?.description).toBe("Open markdown file or folder in annotation UI");
		expect(commands.get("plannotator-last")?.description).toBe("Annotate the last assistant message");
	});

	test("opens a file with OMP models and sends file feedback as a follow-up", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "plannotator-omp-annotate-"));
		tempDirectories.push(cwd);
		const file = join(cwd, "README.md");
		writeFileSync(file, "# Review me\n");
		const opened = session({ feedback: "Fix the heading" });
		let starterArgs: unknown[] | undefined;
		const { commands, messages } = registerHarness({
			startMarkdownAnnotationSession: (async (...args: unknown[]) => {
				starterArgs = args;
				return opened;
			}) as never,
		});
		const { ctx, notifications } = makeContext(cwd);

		await commands.get("plannotator-annotate")!.handler("README.md --gate --json", ctx);
		expect(starterArgs?.[7]).toBe(true);
		expect(starterArgs?.[12]).toEqual({
			piModels: [{ id: "anthropic/claude-sonnet-4-5", label: "Claude Sonnet 4.5", default: true }],
			piExecutablePath: "omp",
		});
		opened.resolve();
		await flushDecision();
		expect(messages).toHaveLength(1);
		expect(messages[0]?.text).toContain("File: ");
		expect(messages[0]?.text).toContain("Fix the heading");
		expect(messages[0]?.options).toEqual({ deliverAs: "followUp" });
		expect(notifications.some(({ message }) => message === "Opening annotation UI for README.md...")).toBe(true);
	});

	test("reports missing targets and ambiguous tolerant targets without opening a browser", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "plannotator-omp-annotate-errors-"));
		tempDirectories.push(cwd);
		writeFileSync(join(cwd, "one.md"), "one");
		writeFileSync(join(cwd, "two.md"), "two");
		let starts = 0;
		const { commands } = registerHarness({
			startMarkdownAnnotationSession: (async () => {
				starts++;
				return session({ feedback: "unused" });
			}) as never,
		});
		const { ctx, notifications } = makeContext(cwd);

		await commands.get("plannotator-annotate")!.handler("", ctx);
		await commands.get("plannotator-annotate")!.handler("one.md two.md", ctx);
		expect(starts).toBe(0);
		expect(notifications[0]?.message).toContain("Usage: /plannotator-annotate");
		expect(notifications.some(({ message }) => /ambiguous/i.test(message))).toBe(true);
	});

	test("annotates the newest assistant message with the recent-message picker", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "plannotator-omp-last-"));
		tempDirectories.push(cwd);
		const opened = session({ approved: true, feedback: "Keep the API shape" });
		let starterArgs: unknown[] | undefined;
		const { commands, messages } = registerHarness({
			startLastMessageAnnotationSession: (async (...args: unknown[]) => {
				starterArgs = args;
				return opened;
			}) as never,
		});
		const branch = [
			{ id: "user-1", type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }] } },
			{ id: "assistant-1", type: "message", timestamp: "2026-08-06T00:00:00Z", message: { role: "assistant", content: [{ type: "text", text: "First answer" }] } },
			{ id: "assistant-2", type: "message", timestamp: "2026-08-06T00:01:00Z", message: { role: "assistant", content: [{ type: "text", text: "Newest answer" }] } },
		];
		const { ctx, notifications } = makeContext(cwd, branch);

		await commands.get("plannotator-last")!.handler("--gate", ctx);
		expect(starterArgs?.[1]).toBe("Newest answer");
		expect(starterArgs?.[2]).toBe(true);
		expect(starterArgs?.[3]).toHaveLength(2);
		expect(starterArgs?.[4]).toMatchObject({ piExecutablePath: "omp" });
		opened.resolve();
		await flushDecision();
		expect(messages[0]?.text).toContain("Keep the API shape");
		expect(messages[0]?.text).toContain("approved");
		expect(notifications.some(({ message }) => message === "Message approved.")).toBe(true);
	});

	test("reports the exact absent-message error", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "plannotator-omp-last-empty-"));
		tempDirectories.push(cwd);
		const { commands } = registerHarness();
		const { ctx, notifications } = makeContext(cwd);
		await commands.get("plannotator-last")!.handler("", ctx);
		expect(notifications).toContainEqual({ message: "No assistant message found in session.", type: "error" });
	});
});
