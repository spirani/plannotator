import { createAssistantMessageReaders } from "./generated/runtime/assistant-message.ts";

export type {
	LastAssistantMessageSnapshot,
	RecentAssistantMessage,
} from "./generated/runtime/assistant-message.ts";

const readers = createAssistantMessageReaders();

export const {
	getLastAssistantMessageSnapshot,
	getLastAssistantMessageText,
	getRecentAssistantMessages,
} = readers;
