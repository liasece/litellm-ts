import { useState } from "react";
import { Alert, Button, Empty, Spin, Tag } from "antd";
import { SortAscendingOutlined, SortDescendingOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
	BellRing,
	Bot,
	ChevronDown,
	CircleAlert,
	Cog,
	FileCode2,
	KeyRound,
	ScrollText,
	Terminal,
	UserRound,
	Wrench,
} from "lucide-react";
import { formatNumberWithCommas, getSpendString } from "@/utils/dataUtils";
import { sessionTimelineCall, type SessionTimelineEvent } from "../../networking";
import SidePanel from "../../common_components/SidePanel";
import type { SessionGroupRef } from "../columns";
import type { MessagePart } from "./prettyMessagesTypes";
import { MessagePartsView } from "./MessagePartsView";

const SIMULATION_PANEL_WIDTH = "min(1100px, calc(100vw - 32px))";

type TimelineRole = SessionTimelineEvent["role"];

export type SessionTimelineItem = SessionTimelineEvent;

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

export interface SessionSimulationDrawerProps {
	open: boolean;
	onClose: () => void;
	onOpenLog?: (event: SessionTimelineItem) => void;
	sessionGroup: SessionGroupRef;
	teamId?: string;
	accessToken: string | null;
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
	while (true) {
		const match = remainingContent.match(IDE_OPENED_FILE_PREFIX);
		if (!match) break;
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
	while (true) {
		const match = remainingContent.match(USER_CONTEXT_PREFIX);
		if (!match) break;
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
	return timeline
		.map((item, originalIndex) => ({ item, originalIndex }))
		.sort((left, right) => {
			const leftTime = Date.parse(left.item.timestamp);
			const rightTime = Date.parse(right.item.timestamp);
			const leftIsValid = Number.isFinite(leftTime);
			const rightIsValid = Number.isFinite(rightTime);

			if (leftIsValid && rightIsValid && leftTime !== rightTime) {
				return newestFirst ? rightTime - leftTime : leftTime - rightTime;
			}
			if (leftIsValid !== rightIsValid) {
				return leftIsValid ? -1 : 1;
			}
			return left.originalIndex - right.originalIndex;
		})
		.map(({ item }) => item);
}

export function formatSessionKey(key: { alias: string | null; hash: string }): string {
	if (key.alias?.trim()) return key.alias.trim();
	const hash = key.hash.trim();
	if (!hash) return "未知 Key";
	return hash.length <= 16 ? hash : `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

function formatTimelineTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	}).format(date);
}

function timelineTone(role: TimelineRole) {
	switch (role) {
		case "assistant":
			return { dot: "#409eff", tag: "blue", icon: <Bot size={13} /> };
		case "user":
			return { dot: "#67c23a", tag: "green", icon: <UserRound size={13} /> };
		case "tool":
			return { dot: "#e6a23c", tag: "gold", icon: <Wrench size={13} /> };
		case "error":
			return { dot: "#f56c6c", tag: "red", icon: <CircleAlert size={13} /> };
		default:
			return { dot: "#909399", tag: "default", icon: <Cog size={13} /> };
	}
}

function IdeOpenedFileView({ context }: { context: IdeOpenedFileContext }) {
	const displayName = context.path?.split(/[\\/]/).filter(Boolean).at(-1);
	return (
		<div className="rounded-md border border-sky-200 bg-sky-50/80 px-3 py-2.5">
			<div className="flex items-center gap-2 text-[11px] font-semibold text-sky-700">
				<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-sky-200 bg-white">
					<FileCode2 size={14} />
				</span>
				<span>IDE 已打开文件</span>
				{displayName ? (
					<span className="min-w-0 truncate rounded bg-sky-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-sky-800">
						{displayName}
					</span>
				) : null}
			</div>
			<div className="mt-2 break-all rounded border border-sky-100 bg-white/80 px-2.5 py-1.5 font-mono text-[11px] leading-5 text-slate-700">
				{context.path ?? context.description}
			</div>
		</div>
	);
}

export function SystemReminderView({ content }: { content: string }) {
	const [expanded, setExpanded] = useState(false);
	const preview = content.replace(/\s+/g, " ").trim() || "（空内容）";
	return (
		<div className="rounded-md border border-violet-200 bg-violet-50/70 px-3 py-2.5">
			<button
				type="button"
				aria-expanded={expanded}
				aria-label={`${expanded ? "收起" : "展开"}系统提醒`}
				className="flex w-full min-w-0 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
				onClick={() => setExpanded((value) => !value)}
			>
				<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-600">
					<BellRing size={14} />
				</span>
				<span className="shrink-0 text-[11px] font-semibold text-violet-700">系统提醒</span>
				<span className="min-w-0 flex-1 truncate text-[11px] font-normal text-violet-600">{preview}</span>
				<span className="shrink-0 text-[10px] text-violet-500">{expanded ? "收起" : "展开"}</span>
				<ChevronDown
					size={14}
					className={`shrink-0 text-violet-500 transition-transform ${expanded ? "rotate-180" : ""}`}
				/>
			</button>
			{expanded ? (
				<div
					role="region"
					aria-label="系统提醒全文"
					className="mt-2 whitespace-pre-wrap break-words rounded border border-violet-100 bg-white/80 px-2.5 py-2 text-[11px] leading-5 text-slate-700"
				>
					{content || "（空内容）"}
				</div>
			) : null}
		</div>
	);
}

function UserContextBlockView({ block }: { block: UserContextBlock }) {
	if (block.kind === "ide_opened_file") return <IdeOpenedFileView context={block.context} />;
	if (block.kind === "system_reminder") return <SystemReminderView content={block.content} />;
	return <TranscriptView content={block.content} />;
}

function UserContextContent({ content }: { content: string }) {
	const parsed = parseUserContextPrefixes(content);
	if (!parsed.blocks.length) {
		return <div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-800">{content}</div>;
	}
	return (
		<div className="space-y-3">
			{parsed.blocks.map((block, index) => (
				<UserContextBlockView key={`${block.kind}:${index}`} block={block} />
			))}
			{parsed.remainingContent ? (
				<div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-800">
					{parsed.remainingContent}
				</div>
			) : null}
		</div>
	);
}

function TranscriptEntryView({ entry }: { entry: TranscriptEntry }) {
	if (entry.kind === "tool") {
		return (
			<div className="rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2">
				<div className="flex items-start gap-2">
					<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-amber-200 bg-white text-amber-700">
						<Terminal size={12} />
					</span>
					<span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
						{entry.toolName ?? entry.label}
					</span>
					<code className="min-w-0 whitespace-pre-wrap break-all font-mono text-[11px] leading-5 text-slate-700">
						{entry.content || "（空内容）"}
					</code>
				</div>
			</div>
		);
	}

	const tone =
		entry.kind === "user"
			? {
					border: "border-emerald-200",
					background: "bg-emerald-50/70",
					badge: "bg-emerald-100 text-emerald-800",
				}
			: entry.kind === "assistant"
				? {
						border: "border-blue-200",
						background: "bg-blue-50/70",
						badge: "bg-blue-100 text-blue-800",
					}
				: entry.kind === "system"
					? {
							border: "border-violet-200",
							background: "bg-violet-50/70",
							badge: "bg-violet-100 text-violet-800",
						}
					: {
							border: "border-slate-200",
							background: "bg-slate-50",
							badge: "bg-slate-200 text-slate-700",
						};

	return (
		<div className={`rounded-md border px-3 py-2.5 ${tone.border} ${tone.background}`}>
			<div className="mb-2">
				<span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${tone.badge}`}>{entry.label}</span>
			</div>
			{entry.kind === "user" ? (
				<UserContextContent content={entry.content} />
			) : (
				<div className="whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-700">
					{entry.content || "（空内容）"}
				</div>
			)}
		</div>
	);
}

export function TranscriptView({ content }: { content: string }) {
	const [expanded, setExpanded] = useState(false);
	const entries = parseTranscriptEntries(content);
	const firstEntry = entries[0];
	const preview = firstEntry
		? `${firstEntry.kind === "tool" ? (firstEntry.toolName ?? firstEntry.label) : firstEntry.label} · ${
				firstEntry.content.replace(/\s+/g, " ").trim() || "（空内容）"
			}`
		: "（空转录）";
	return (
		<section
			aria-label="会话转录"
			className="overflow-hidden rounded-md border border-indigo-200 bg-indigo-50/50"
		>
			<button
				type="button"
				aria-expanded={expanded}
				aria-label={`${expanded ? "收起" : "展开"}会话转录`}
				className={`sticky top-0 z-[1] flex w-full min-w-0 items-center gap-2 bg-indigo-50 px-3 py-2 text-left text-indigo-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
					expanded ? "border-b border-indigo-200" : ""
				}`}
				onClick={() => setExpanded((value) => !value)}
			>
				<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-indigo-200 bg-white">
					<ScrollText size={14} />
				</span>
				<span className="shrink-0 text-[11px] font-semibold">会话转录</span>
				<span className="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] text-indigo-600">
					{entries.length} 条记录
				</span>
				<span className="min-w-0 flex-1 truncate text-[11px] font-normal text-indigo-600">{preview}</span>
				<span className="shrink-0 text-[10px] text-indigo-500">{expanded ? "收起" : "展开"}</span>
				<ChevronDown
					size={14}
					className={`shrink-0 text-indigo-500 transition-transform ${expanded ? "rotate-180" : ""}`}
				/>
			</button>
			{expanded ? (
				<div role="region" aria-label="会话转录全文" className="space-y-2 p-2.5">
					{entries.length ? (
						entries.map((entry, index) => <TranscriptEntryView key={`${entry.kind}:${index}`} entry={entry} />)
					) : (
						<div className="px-2 py-3 text-[11px] text-slate-500">（空转录）</div>
					)}
				</div>
			) : null}
		</section>
	);
}

function TimelineContent({ item }: { item: SessionTimelineItem }) {
	const userContext = item.role === "user" ? parseUserContextPrefixes(item.content) : null;
	if (userContext?.blocks.length) {
		const nonTextParts = (item.parts ?? []).filter((part) => part.kind !== "text");
		return (
			<div className="space-y-3">
				{userContext.blocks.map((block, index) => (
					<UserContextBlockView key={`${block.kind}:${index}`} block={block} />
				))}
				{userContext.remainingContent ? (
					<div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-800">
						{userContext.remainingContent}
					</div>
				) : null}
				{nonTextParts.length ? <MessagePartsView parts={nonTextParts as MessagePart[]} /> : null}
			</div>
		);
	}
	if (item.parts?.length) {
		return <MessagePartsView parts={item.parts as MessagePart[]} />;
	}
	return (
		<div className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-800">
			{item.content || "（空内容）"}
		</div>
	);
}

export function SessionSimulationDrawer({
	open,
	onClose,
	onOpenLog,
	sessionGroup,
	teamId,
	accessToken,
}: SessionSimulationDrawerProps) {
	const [newestFirst, setNewestFirst] = useState(true);
	const {
		data: timelineResponse,
		isLoading,
		isError,
		error,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: ["sessionTimeline", sessionGroup.type, sessionGroup.id, teamId],
		queryFn: async () => {
			if (!accessToken) {
				return {
					data: [],
					summary: {
						keys: [],
						request_count: 0,
						event_count: 0,
						total_spend: 0,
						total_tokens: 0,
						duration_seconds: 0,
						start_time: null,
						end_time: null,
					},
				};
			}
			return sessionTimelineCall(accessToken, sessionGroup, teamId);
		},
		enabled: Boolean(open && accessToken),
	});

	const timeline = timelineResponse?.data ?? [];
	const summary = timelineResponse?.summary;
	const sessionKeyLabels = (summary?.keys ?? []).map(formatSessionKey);
	const displayedTimeline = orderSessionTimeline(timeline, newestFirst);
	const rawErrorMessage = error instanceof Error ? error.message : "Session 历史加载失败";
	const errorMessage = /^\s*(?:<!doctype\s+html|<html)\b/i.test(rawErrorMessage)
		? "Session 历史加载失败"
		: rawErrorMessage.slice(0, 300);

	return (
		<SidePanel
			open={open}
			onClose={onClose}
			width={SIMULATION_PANEL_WIDTH}
			title={
				<div>
					<div className="text-base font-semibold text-slate-900">Session 模拟</div>
					<div className="mt-0.5 max-w-[720px] truncate font-mono text-[11px] font-normal text-slate-500">
						{sessionGroup.id}
					</div>
				</div>
			}
			mask={true}
			maskClosable={true}
			destroyOnHidden={true}
			styles={{
				header: { padding: "14px 20px", borderBottom: "1px solid #e5e7eb" },
				body: { padding: 0, background: "#f8fafc" },
			}}
		>
			<div data-testid="session-simulation-drawer" className="min-h-full">
				<div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-3">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
							<span
								className="inline-flex min-w-0 max-w-full items-center gap-1.5"
								title={sessionKeyLabels.join("、") || "未记录 Key"}
							>
								<KeyRound size={13} className="shrink-0 text-slate-400" />
								<span>{sessionKeyLabels.length > 1 ? "Keys" : "Key"}</span>
								<strong
									data-testid="session-simulation-keys"
									className="max-w-[260px] truncate font-semibold text-slate-900"
								>
									{sessionKeyLabels.join("、") || "-"}
								</strong>
							</span>
							<span>
								<strong className="font-semibold text-slate-900">{summary?.request_count ?? 0}</strong> 请求
							</span>
							<span>
								<strong className="font-semibold text-slate-900">{summary?.event_count ?? timeline.length}</strong> 时间线事件
							</span>
							<span>
								<strong className="font-semibold text-slate-900">
									{formatNumberWithCommas(summary?.total_tokens ?? 0)}
								</strong>{" "}
								tokens
							</span>
							<span>
								<strong className="font-semibold text-slate-900">{getSpendString(summary?.total_spend ?? 0)}</strong>
							</span>
							<span>
								<strong className="font-semibold text-slate-900">
									{(summary?.duration_seconds ?? 0).toFixed(2)}s
								</strong>
							</span>
						</div>
						<Button
							size="small"
							icon={newestFirst ? <SortDescendingOutlined /> : <SortAscendingOutlined />}
							onClick={() => setNewestFirst((value) => !value)}
						>
							{newestFirst ? "最新优先" : "最早优先"}
						</Button>
					</div>
					<div className="mt-1.5 text-[11px] text-slate-400">
						按历史 Spend Logs 重放，仅用于查看，不会重新调用模型。
					</div>
				</div>

				{isLoading ? (
					<div className="flex min-h-[360px] items-center justify-center">
						<Spin tip="正在加载完整 Session 历史…" />
					</div>
				) : isError ? (
					<div className="p-5">
						<Alert
							type="error"
							showIcon={true}
							message="Session 模拟加载失败"
							description={errorMessage}
							action={
								<Button size="small" loading={isFetching} disabled={isFetching} onClick={() => void refetch()}>
									重试
								</Button>
							}
						/>
					</div>
				) : displayedTimeline.length === 0 ? (
					<div className="flex min-h-[360px] items-center justify-center">
						<Empty description="暂无历史会话" />
					</div>
				) : (
					<div className="mx-auto max-w-[920px] px-6 py-6">
						<div className="relative">
							<div className="absolute bottom-3 left-[7px] top-3 w-px bg-slate-300" />
							{displayedTimeline.map((item, index) => {
								const tone = timelineTone(item.role);
								return (
									<div key={item.id} className={index === displayedTimeline.length - 1 ? "relative" : "relative pb-6"}>
										<div
											className={`absolute left-0 top-[5px] z-[1] flex h-[15px] w-[15px] items-center justify-center rounded-full border-2 bg-white ${
												item.role === "user" ? "" : "border-transparent"
											}`}
											style={{
												borderColor: item.role === "user" ? tone.dot : "transparent",
												backgroundColor: item.role === "user" ? "#fff" : tone.dot,
											}}
										>
											{item.role !== "user" ? <span className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
										</div>
										<div className="ml-8">
											<div className="mb-2 flex flex-wrap items-center gap-2">
												<span className="text-[11px] text-slate-500">{formatTimelineTime(item.timestamp)}</span>
												<Tag color={tone.tag} className="!m-0 inline-flex items-center gap-1">
													{tone.icon}
													{item.label}
												</Tag>
												<span className="max-w-[320px] truncate text-[11px] text-slate-400">{item.model}</span>
												<button
													type="button"
													title={`查看 Log ${item.request_id}`}
													aria-label={`查看 Log ${item.request_id}`}
													className="ml-auto max-w-[320px] truncate rounded-sm font-mono text-[10px] text-blue-500 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
													onClick={() => onOpenLog?.(item)}
												>
													{item.request_id}
												</button>
											</div>
											<div
												className={`max-h-[360px] overflow-y-auto overscroll-contain rounded-md border bg-white px-4 py-3 shadow-sm ${
													item.role === "error" ? "border-red-200" : "border-slate-200"
												}`}
											>
												<TimelineContent item={item} />
											</div>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				)}
			</div>
		</SidePanel>
	);
}
