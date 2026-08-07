type AssistantTextBlock = { type?: string; text?: string };

type AssistantMessageLike = {
	role?: unknown;
	content?: unknown;
};

type SessionEntryLike = {
	id: string;
	type: string;
	timestamp?: unknown;
	message?: AssistantMessageLike;
};

export type LastAssistantMessageSnapshot = {
	entryId: string;
	text: string;
};

export type RecentAssistantMessage = {
	messageId: string;
	text: string;
	timestamp?: string;
};

/** Structural session-history contract shared by Pi-compatible hosts. */
export interface PlannotatorSessionHistoryContext {
	sessionManager: { getBranch(): readonly SessionEntryLike[] };
	isIdle(): boolean;
}

export interface AssistantMessageReaders {
	getAssistantMessageText(message: unknown): string | null;
	getLastAssistantMessageSnapshot(ctx: PlannotatorSessionHistoryContext): LastAssistantMessageSnapshot | null;
	getLastAssistantMessageText(ctx: PlannotatorSessionHistoryContext): string | null;
	findAssistantMessageByEntryId(ctx: PlannotatorSessionHistoryContext, entryId: string): LastAssistantMessageSnapshot | null;
	getRecentAssistantMessages(ctx: PlannotatorSessionHistoryContext, limit: number): RecentAssistantMessage[];
	hasSessionMovedPastEntry(ctx: PlannotatorSessionHistoryContext, entryId: string): boolean;
}

function normalizeTimestamp(value: unknown): string | undefined {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
	}
	if (typeof value === "number" && Number.isFinite(value)) {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		const d = new Date(value);
		return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
	}
	return undefined;
}

function isAssistantMessage(message: AssistantMessageLike): message is { role: "assistant"; content: AssistantTextBlock[] } {
	return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: { content: AssistantTextBlock[] }): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}


/**
 * Construct host-neutral readers. The only host surface they inspect is the
 * active session history supplied by the calling facade.
 */
export function createAssistantMessageReaders(): AssistantMessageReaders {
	function getAssistantMessageText(message: unknown): string | null {
		if (typeof message !== "object" || message === null) return null;
		const candidate = message as AssistantMessageLike;
		if (!isAssistantMessage(candidate)) return null;
		const text = getTextContent(candidate);
		return text.trim() ? text : null;
	}

	function getCurrentBranch(ctx: PlannotatorSessionHistoryContext): readonly SessionEntryLike[] {
		return ctx.sessionManager.getBranch();
	}

	function getLastAssistantMessageSnapshot(ctx: PlannotatorSessionHistoryContext): LastAssistantMessageSnapshot | null {
		// "Last" means the active conversation branch, not the newest message anywhere
		// in the append-only session file.
		const branch = getCurrentBranch(ctx);
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type === "message" && entry.message) {
				const text = getAssistantMessageText(entry.message);
				if (text) return { entryId: entry.id, text };
			}
		}
		return null;
	}

	function getLastAssistantMessageText(ctx: PlannotatorSessionHistoryContext): string | null {
		return getLastAssistantMessageSnapshot(ctx)?.text ?? null;
	}

	function findAssistantMessageByEntryId(
		ctx: PlannotatorSessionHistoryContext,
		entryId: string,
	): LastAssistantMessageSnapshot | null {
		const branch = getCurrentBranch(ctx);
		for (const entry of branch) {
			if (entry.id !== entryId || entry.type !== "message" || !entry.message) continue;
			const text = getAssistantMessageText(entry.message);
			if (text) return { entryId: entry.id, text };
		}
		return null;
	}

	function getRecentAssistantMessages(
		ctx: PlannotatorSessionHistoryContext,
		limit: number,
	): RecentAssistantMessage[] {
		const branch = getCurrentBranch(ctx);
		const out: RecentAssistantMessage[] = [];
		for (let i = branch.length - 1; i >= 0 && out.length < limit; i--) {
			const entry = branch[i];
			if (entry.type !== "message" || !entry.message) continue;
			const text = getAssistantMessageText(entry.message);
			if (!text) continue;
			out.push({ messageId: entry.id, text, timestamp: normalizeTimestamp(entry.timestamp) });
		}
		return out;
	}

	function hasSessionMovedPastEntry(ctx: PlannotatorSessionHistoryContext, entryId: string): boolean {
		if (!ctx.isIdle()) return true;

		const branch = getCurrentBranch(ctx);
		const index = branch.findIndex((entry) => entry.id === entryId);
		if (index === -1) return true;

		return branch.slice(index + 1).some((entry) => entry.type === "message");
	}

	return {
		getAssistantMessageText,
		getLastAssistantMessageSnapshot,
		getLastAssistantMessageText,
		findAssistantMessageByEntryId,
		getRecentAssistantMessages,
		hasSessionMovedPastEntry,
	};
}
