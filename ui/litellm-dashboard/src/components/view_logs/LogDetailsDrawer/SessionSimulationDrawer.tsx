import { useMemo, useState } from "react";
import { Alert, Button, Empty, Spin, Tag } from "antd";
import { SortAscendingOutlined, SortDescendingOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Bot, CircleAlert, Cog, UserRound, Wrench } from "lucide-react";
import { formatNumberWithCommas, getSpendString } from "@/utils/dataUtils";
import { uiSpendLogDetailsBatchCall, uiSpendLogDetailsCall } from "../../networking";
import SidePanel from "../../common_components/SidePanel";
import type { LogEntry, SessionGroupRef } from "../columns";
import { parseMessages } from "./prettyMessagesUtils";
import type { MessagePart, ParsedMessage } from "./prettyMessagesTypes";
import { MessagePartsView } from "./MessagePartsView";
import { loadCompleteSessionLogs } from "./sessionLogs";

const SIMULATION_PANEL_WIDTH = "min(1100px, calc(100vw - 32px))";
const DETAIL_BATCH_SIZE = 100;
const DETAIL_FALLBACK_CONCURRENCY = 6;

type TimelineRole = ParsedMessage["role"] | "request" | "error";

export interface SessionTimelineItem {
	id: string;
	requestId: string;
	role: TimelineRole;
	label: string;
	timestamp: string;
	model: string;
	content: string;
	parts?: MessagePart[];
	status?: string;
}

export interface SessionSimulationDrawerProps {
	open: boolean;
	onClose: () => void;
	onOpenLog?: (log: LogEntry) => void;
	sessionGroup: SessionGroupRef;
	teamId?: string;
	accessToken: string | null;
}

function parseJsonValue(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function hasRecordedContent(value: unknown): boolean {
	if (value === null || value === undefined) return false;
	if (Array.isArray(value)) return value.length > 0;
	if (typeof value === "object") return Object.keys(value).length > 0;
	if (typeof value !== "string") return true;
	const trimmed = value.trim();
	return trimmed !== "" && trimmed !== "null" && trimmed !== "{}" && trimmed !== "[]";
}

function messageFingerprint(message: ParsedMessage): string {
	try {
		return JSON.stringify({
			role: message.role,
			content: message.content,
			parts: message.parts,
			toolCalls: message.toolCalls,
			toolCallId: message.toolCallId,
		});
	} catch {
		return `${message.role}:${message.content}`;
	}
}

function roleLabel(role: TimelineRole): string {
	switch (role) {
		case "user":
			return "用户输入";
		case "assistant":
			return "输出";
		case "tool":
			return "工具结果";
		case "system":
			return "系统";
		case "error":
			return "请求失败";
		default:
			return "请求";
	}
}

function attachToolResultToCall(items: SessionTimelineItem[], result: MessagePart): boolean {
	for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
		const item = items[itemIndex];
		const parts = item.parts || [];
		const matchingCall = [...parts]
			.reverse()
			.find(
				(part) =>
					part.kind === "tool_call" &&
					(result.id ? part.id === result.id : !parts.some((candidate) => candidate.kind === "tool_result")),
			);
		if (!matchingCall) continue;

		const resultWithCallIdentity = {
			...result,
			id: result.id || matchingCall.id,
			name: result.name || matchingCall.name,
		};
		const alreadyAttached = parts.some(
			(part) =>
				part.kind === "tool_result" &&
				part.id === resultWithCallIdentity.id &&
				part.text === resultWithCallIdentity.text,
		);
		if (!alreadyAttached) item.parts = [...parts, resultWithCallIdentity];
		return true;
	}
	return false;
}

function contentFromTimelineParts(parts: MessagePart[], fallback: string): string {
	const content = parts
		.flatMap((part) => {
			if (part.text) return [part.text];
			if (part.kind === "unknown" && part.data !== undefined) {
				try {
					return [JSON.stringify(part.data, null, 2)];
				} catch {
					return ["[Unserializable content]"];
				}
			}
			return [];
		})
		.join("\n")
		.trim();
	return content || fallback;
}

/**
 * Reconstruct a transcript from request snapshots. Each later LLM request
 * usually repeats all earlier messages, so request-side messages are
 * fingerprinted while every actual response remains visible.
 */
export function buildSessionTimeline(logs: LogEntry[]): SessionTimelineItem[] {
	const transcriptFingerprints: string[] = [];
	const seenSystemMessages = new Set<string>();
	const items: SessionTimelineItem[] = [];
	const chronologicalLogs = [...logs].sort((a, b) => {
		const timeDifference = Date.parse(a.startTime) - Date.parse(b.startTime);
		return timeDifference !== 0 ? timeDifference : a.request_id.localeCompare(b.request_id);
	});

	for (const log of chronologicalLogs) {
		const parsedRequestPayload = parseJsonValue(
			hasRecordedContent(log.proxy_server_request) ? log.proxy_server_request : log.messages,
		);
		const requestPayload = Array.isArray(parsedRequestPayload)
			? { messages: parsedRequestPayload }
			: parsedRequestPayload;
		const responsePayload = parseJsonValue(log.response);
		const { requestMessages, responseMessage } = parseMessages(requestPayload, responsePayload);
		let addedMessage = false;
		const requestFingerprints = requestMessages.map(messageFingerprint);
		let overlapLength = Math.min(transcriptFingerprints.length, requestFingerprints.length);
		while (
			overlapLength > 0 &&
			!requestFingerprints
				.slice(0, overlapLength)
				.every(
					(fingerprint, index) =>
						fingerprint === transcriptFingerprints[transcriptFingerprints.length - overlapLength + index],
				)
		) {
			overlapLength -= 1;
		}

		requestMessages.forEach((message, index) => {
			if (index < overlapLength) return;
			const fingerprint = requestFingerprints[index];
			if (message.role === "system" && seenSystemMessages.has(fingerprint)) return;
			if (message.role === "system") seenSystemMessages.add(fingerprint);

			const toolResults = (message.parts || []).filter((part) => part.kind === "tool_result");
			const attachedToolResults = new Set(toolResults.filter((result) => attachToolResultToCall(items, result)));
			const remainingParts = (message.parts || []).filter((part) => !attachedToolResults.has(part));
			if (attachedToolResults.size > 0) addedMessage = true;
			if (remainingParts.length === 0 && toolResults.length > 0) return;

			const isStandaloneToolResult =
				remainingParts.length > 0 && remainingParts.every((part) => part.kind === "tool_result");
			const timelineRole: TimelineRole = isStandaloneToolResult ? "tool" : message.role;
			addedMessage = true;
			items.push({
				id: `${log.request_id}:request:${index}`,
				requestId: log.request_id,
				role: timelineRole,
				label: roleLabel(timelineRole),
				timestamp: log.startTime,
				model: log.model,
				content: contentFromTimelineParts(remainingParts, message.content),
				parts: remainingParts.length ? remainingParts : undefined,
				status: log.status || log.metadata?.status,
			});
		});
		transcriptFingerprints.push(...requestFingerprints.slice(overlapLength));

		if (responseMessage) {
			addedMessage = true;
			transcriptFingerprints.push(messageFingerprint(responseMessage));
			items.push({
				id: `${log.request_id}:response`,
				requestId: log.request_id,
				role: responseMessage.role,
				label: roleLabel(responseMessage.role),
				timestamp: log.endTime || log.startTime,
				model: log.model,
				content: responseMessage.content,
				parts: responseMessage.parts,
				status: log.status || log.metadata?.status,
			});
		}

		const status = String(log.status || log.metadata?.status || "").toLowerCase();
		if (!responseMessage && (status === "failure" || log.metadata?.error_information)) {
			const errorInfo = log.metadata?.error_information;
			items.push({
				id: `${log.request_id}:error`,
				requestId: log.request_id,
				role: "error",
				label: roleLabel("error"),
				timestamp: log.endTime || log.startTime,
				model: log.model,
				content:
					errorInfo?.error_message ||
					errorInfo?.message ||
					(typeof errorInfo === "string" ? errorInfo : "该请求执行失败，未记录响应内容。"),
				status: "failure",
			});
			addedMessage = true;
		}

		if (!addedMessage) {
			items.push({
				id: `${log.request_id}:request`,
				requestId: log.request_id,
				role: "request",
				label: roleLabel("request"),
				timestamp: log.startTime,
				model: log.model,
				content: `${log.call_type || "completion"} · 未记录会话正文`,
				status: log.status || log.metadata?.status,
			});
		}
	}

	return items;
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

export async function enrichMissingDetails(accessToken: string, logs: LogEntry[]): Promise<LogEntry[]> {
	const enriched = [...logs];
	const missingIndexes = logs.flatMap((log, index) =>
		hasRecordedContent(log.messages) && hasRecordedContent(log.response) ? [] : [index],
	);

	for (let offset = 0; offset < missingIndexes.length; offset += DETAIL_BATCH_SIZE) {
		const indexes = missingIndexes.slice(offset, offset + DETAIL_BATCH_SIZE);
		let details = new Map<string, Awaited<ReturnType<typeof uiSpendLogDetailsCall>>>();
		try {
			const response = await uiSpendLogDetailsBatchCall(
				accessToken,
				indexes.map((index) => ({
					request_id: logs[index].request_id,
					start_date: logs[index].startTime,
				})),
			);
			details = new Map(response.data.map((detail) => [detail.request_id, detail]));
		} catch {
			for (let fallbackOffset = 0; fallbackOffset < indexes.length; fallbackOffset += DETAIL_FALLBACK_CONCURRENCY) {
				const fallbackIndexes = indexes.slice(fallbackOffset, fallbackOffset + DETAIL_FALLBACK_CONCURRENCY);
				const fallbackDetails = await Promise.all(
					fallbackIndexes.map(async (index) => {
						const log = logs[index];
						try {
							return await uiSpendLogDetailsCall(accessToken, log.request_id, log.startTime);
						} catch {
							return null;
						}
					}),
				);
				fallbackDetails.forEach((detail, detailIndex) => {
					if (detail) {
						details.set(logs[fallbackIndexes[detailIndex]].request_id, detail);
					}
				});
			}
		}
		indexes.forEach((index) => {
			const detail = details.get(logs[index].request_id);
			if (!detail) return;
			enriched[index] = {
				...enriched[index],
				messages: detail.messages ?? enriched[index].messages,
				response: detail.response ?? enriched[index].response,
				proxy_server_request: detail.proxy_server_request ?? enriched[index].proxy_server_request,
			};
		});
	}

	return enriched;
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

function TimelineContent({ item }: { item: SessionTimelineItem }) {
	if (item.parts?.length) {
		return <MessagePartsView parts={item.parts} />;
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
		data: logs = [],
		isLoading,
		isError,
		error,
		refetch,
		isFetching,
	} = useQuery({
		queryKey: ["sessionSimulationLogs", sessionGroup.type, sessionGroup.id, teamId],
		queryFn: async () => {
			if (!accessToken) return [];
			const loadedLogs = await loadCompleteSessionLogs({
				accessToken,
				sessionGroup,
				teamId,
				includeContent: true,
			});
			return enrichMissingDetails(accessToken, loadedLogs);
		},
		enabled: Boolean(open && accessToken),
	});

	const timeline = useMemo(() => buildSessionTimeline(logs), [logs]);
	const displayedTimeline = orderSessionTimeline(timeline, newestFirst);
	const totalSpend = logs.reduce((sum, log) => sum + (log.spend || 0), 0);
	const totalTokens = logs.reduce((sum, log) => sum + (log.total_tokens || 0), 0);
	const startMs = logs.length ? Math.min(...logs.map((log) => Date.parse(log.startTime))) : 0;
	const endMs = logs.length ? Math.max(...logs.map((log) => Date.parse(log.endTime))) : 0;
	const durationSeconds = startMs && endMs ? Math.max(0, (endMs - startMs) / 1000) : 0;
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
							<span>
								<strong className="font-semibold text-slate-900">{logs.length}</strong> 请求
							</span>
							<span>
								<strong className="font-semibold text-slate-900">{timeline.length}</strong> 时间线事件
							</span>
							<span>
								<strong className="font-semibold text-slate-900">{formatNumberWithCommas(totalTokens)}</strong> tokens
							</span>
							<span>
								<strong className="font-semibold text-slate-900">{getSpendString(totalSpend)}</strong>
							</span>
							<span>
								<strong className="font-semibold text-slate-900">{durationSeconds.toFixed(2)}s</strong>
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
													title={`查看 Log ${item.requestId}`}
													aria-label={`查看 Log ${item.requestId}`}
													className="ml-auto max-w-[320px] truncate rounded-sm font-mono text-[10px] text-blue-500 hover:text-blue-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
													onClick={() => {
														const log = logs.find((candidate) => candidate.request_id === item.requestId);
														if (log) onOpenLog?.(log);
													}}
												>
													{item.requestId}
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
