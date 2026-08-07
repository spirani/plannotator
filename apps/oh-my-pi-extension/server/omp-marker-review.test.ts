import { describe, expect, test } from "bun:test";
import { buildOhMyPiMarkerCommand } from "./omp-marker-review.ts";

describe("Oh My Pi marker command", () => {
	test("uses non-interactive inspection-only flags", () => {
		const { command } = buildOhMyPiMarkerCommand(
			"review this",
			"anthropic/claude-sonnet-4-5",
			"high",
		);

		expect(command).toEqual([
			"omp",
			"--mode",
			"json",
			"--no-session",
			"--approval-mode",
			"yolo",
			"--tools",
			"read,bash,glob,grep",
			"--no-extensions",
			"--no-skills",
			"--no-rules",
			"--no-lsp",
			"--model",
			"anthropic/claude-sonnet-4-5",
			"--thinking",
			"high",
			"-p",
			"review this",
		]);
	});
});
