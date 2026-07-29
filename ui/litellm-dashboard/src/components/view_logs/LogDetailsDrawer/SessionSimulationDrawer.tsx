import { useState } from "react";
import { Alert, Button, Empty, Spin, Tag } from "antd";
import { SortAscendingOutlined, SortDescendingOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Bot, CircleAlert, Cog, UserRound, Wrench } from "lucide-react";
import { formatNumberWithCommas, getSpendString } from "@/utils/dataUtils";
import { sessionTimelineCall, type SessionTimelineEvent } from "../../networking";
import SidePanel from "../../common_components/SidePanel";
import type { SessionGroupRef } from "../columns";
import type { MessagePart } from "./prettyMessagesTypes";
import { MessagePartsView } from "./MessagePartsView";

const SIMULATION_PANEL_WIDTH = "min(1100px, calc(100vw - 32px))";

type TimelineRole = SessionTimelineEvent["role"];

export type SessionTimelineItem = SessionTimelineEvent;

export interface SessionSimulationDrawerProps {
	open: boolean;
	onClose: () => void;
	onOpenLog?: (event: SessionTimelineItem) => void;
	sessionGroup: SessionGroupRef;
	teamId?: string;
	accessToken: string | null;
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
