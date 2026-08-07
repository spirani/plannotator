import type { MarkerCommandResult } from "../generated/marker-review.ts";

const INSPECTION_TOOLS = "read,bash,glob,grep";

export function isOhMyPiExecutable(binary: string | undefined): boolean {
	return binary?.split(/[\\/]/).pop()?.toLowerCase() === "omp";
}

/** Build the non-interactive, read-only review command used by Oh My Pi. */
export function buildOhMyPiMarkerCommand(
	prompt: string,
	model?: string,
	thinking?: string,
	binary = "omp",
): MarkerCommandResult {
	const useModel = typeof model === "string" && model.trim().length > 0;
	return {
		command: [
			binary,
			"--mode",
			"json",
			"--no-session",
			"--approval-mode",
			"yolo",
			"--tools",
			INSPECTION_TOOLS,
			"--no-extensions",
			"--no-skills",
			"--no-rules",
			"--no-lsp",
			...(useModel ? ["--model", model] : []),
			...(thinking ? ["--thinking", thinking] : []),
			"-p",
			prompt,
		],
	};
}
