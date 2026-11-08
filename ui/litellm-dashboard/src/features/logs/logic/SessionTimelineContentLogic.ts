import type { SessionTimelineEvent as SessionTimelineItem } from "../support/SessionTimelineModels";
export interface IdeOpenedFileContext {
	path: string | null;
	description: string;
}

export interface ParsedIdeOpenedFileContent {
	contexts: IdeOpenedFileContext[];
	remainingContent: string;
}

export type UserContextBlock =
	| { kind: "ide_opened_file"; context: IdeOpenedFileContext }
	| { kind: "system_reminder"; content: string }
	| { kind: "transcript"; content: string };

export interface ParsedUserContextContent {
	blocks: UserContextBlock[];
	remainingContent: string;
}

export type TranscriptEntryKind = "user" | "assistant" | "system" | "tool" | "text";

export interface TranscriptEntry {
	kind: TranscriptEntryKind;
	label: string;
	content: string;
	toolName?: string;
}

const IDE_OPENED_FILE_PREFIX = /^\s*<ide_opened_file>([\s\S]*?)<\/ide_opened_file>\s*/;
const USER_CONTEXT_PREFIX = /^\s*<(ide_opened_file|system-reminder|transcript)>([\s\S]*?)<\/\1>\s*/;
const IDE_OPENED_FILE_DESCRIPTION =
	/^The user opened the file ([\s\S]+?) in the IDE\.\s*(?:This may or may not be related to the current task\.)?\s*$/;
const TRANSCRIPT_ROLE_PREFIX = /^(User|Assistant|System|Tool):\s*([\s\S]*)$/i;
const TRANSCRIPT_TOOL_NAMES = new Set([
	"Bash",
	"Read",
	"Edit",
	"Write",
	"Glob",
	"Grep",
	"WebFetch",
	"WebSearch",
	"Task",
	"TodoWrite",
	"NotebookEdit",
]);

function parseIdeOpenedFileDescription(description: string): IdeOpenedFileContext {
	const descriptionMatch = description.match(IDE_OPENED_FILE_DESCRIPTION);
	return {
		path: descriptionMatch?.[1]?.trim() || null,
		description: description,
	};
}

/**
 * Claude Code prepends IDE state to a real user prompt as an XML-like text tag.
 * Only consume complete tags at the beginning of the message: XML included in a
 * user's question or an incomplete provider payload must remain ordinary text.
 */
export function parseIdeOpenedFilePrefixes(content: string): ParsedIdeOpenedFileContent {
	const contexts: IdeOpenedFileContext[] = [];
	let remainingContent = content;
	for (let match = remainingContent.match(IDE_OPENED_FILE_PREFIX); match; match = remainingContent.match(IDE_OPENED_FILE_PREFIX)) {
		const description = match[1]?.trim() ?? "";
		contexts.push(parseIdeOpenedFileDescription(description));
		remainingContent = remainingContent.slice(match[0].length);
	}
	return { contexts: contexts, remainingContent: remainingContent.trimStart() };
}

/**
 * Claude Code may prepend multiple context tags to one real user prompt. Parse
 * only complete leading tags and keep their original order so reminders, IDE
 * files, and the user's text can be rendered together without duplication.
 */
export function parseUserContextPrefixes(content: string): ParsedUserContextContent {
	const blocks: UserContextBlock[] = [];
	let remainingContent = content;
	for (let match = remainingContent.match(USER_CONTEXT_PREFIX); match; match = remainingContent.match(USER_CONTEXT_PREFIX)) {
		const tagName = match[1];
		const tagContent = match[2]?.trim() ?? "";
		if (tagName === "ide_opened_file") {
			blocks.push({ kind: "ide_opened_file", context: parseIdeOpenedFileDescription(tagContent) });
		} else if (tagName === "system-reminder") {
			blocks.push({ kind: "system_reminder", content: tagContent });
		} else {
			blocks.push({ kind: "transcript", content: tagContent });
		}
		remainingContent = remainingContent.slice(match[0].length);
	}
	return { blocks: blocks, remainingContent: remainingContent.trimStart() };
}

/**
 * Transcript payloads are human-readable summaries rather than a stable API
 * schema. Blank lines delimit records; explicit role prefixes and a conservative
 * allowlist identify known Claude Code tool records without misclassifying an
 * ordinary English sentence as a tool call.
 */
export function parseTranscriptEntries(content: string): TranscriptEntry[] {
	return content
		.trim()
		.split(/\n\s*\n+/)
		.map((paragraph) => paragraph.trim())
		.filter(Boolean)
		.map((paragraph) => {
			const roleMatch = paragraph.match(TRANSCRIPT_ROLE_PREFIX);
			if (roleMatch) {
				const role = roleMatch[1]?.toLowerCase();
				const roleContent = roleMatch[2]?.trim() ?? "";
				if (role === "user") return { kind: "user", label: "用户", content: roleContent };
				if (role === "assistant") return { kind: "assistant", label: "助手", content: roleContent };
				if (role === "system") return { kind: "system", label: "系统", content: roleContent };
				return { kind: "tool", label: "工具", toolName: "Tool", content: roleContent };
			}

			const firstSpace = paragraph.indexOf(" ");
			const possibleToolName = firstSpace > 0 ? paragraph.slice(0, firstSpace) : paragraph;
			if (TRANSCRIPT_TOOL_NAMES.has(possibleToolName)) {
				return {
					kind: "tool",
					label: "工具",
					toolName: possibleToolName,
					content: firstSpace > 0 ? paragraph.slice(firstSpace + 1).trim() : "",
				};
			}
			return { kind: "text", label: "记录", content: paragraph };
		});
}

export function orderSessionTimeline(timeline: SessionTimelineItem[], newestFirst: boolean): SessionTimelineItem[] {
	// The API connects cumulative request histories; timestamps only indicate
	// when a snapshot was recorded and cannot recover message order within it.
	return newestFirst ? [...timeline].reverse() : [...timeline];
}

export function formatSessionKey(key: { alias: string | null; hash: string }): string {
	if (key.alias?.trim()) return key.alias.trim();
	const hash = key.hash.trim();
	if (!hash) return "未知 Key";
	return hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}
