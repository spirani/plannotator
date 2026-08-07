import {
	startReviewServer as startCanonicalReviewServer,
	type PiMarkerCommandPolicy,
} from "../generated/runtime/server/serverReview.ts";
import {
	buildOhMyPiMarkerCommand,
	isOhMyPiExecutable,
} from "./omp-marker-review.ts";

export type {
	DiffOption,
	DiffType,
	GitContext,
} from "../generated/review-core.ts";
export type {
	PiMarkerCommandPolicy,
	ReviewServerResult,
} from "../generated/runtime/server/serverReview.ts";

const piMarkerCommandPolicy: PiMarkerCommandPolicy = {
	matchesExecutable: isOhMyPiExecutable,
	build: buildOhMyPiMarkerCommand,
};

export function startReviewServer(
	options: Parameters<typeof startCanonicalReviewServer>[0],
): ReturnType<typeof startCanonicalReviewServer> {
	return startCanonicalReviewServer({
		...options,
		piMarkerCommandPolicy,
	});
}
