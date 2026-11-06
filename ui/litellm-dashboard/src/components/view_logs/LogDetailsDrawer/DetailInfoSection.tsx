import { useMoneyFormatter } from "@/contexts/PriceDisplay";
import { Collapse, Descriptions, Space, Tag } from "antd";
import moment from "moment";
import type { ReactNode } from "react";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { getCacheCreationInputTokens, getCacheReadInputTokens, type LogEntry } from "../columns";
import { CostBreakdownDetails, useCostBreakdownView, type CostBreakdownViewerProps } from "../CostBreakdownViewer";
import { useLiveDurationMs } from "../useLiveClock";
import { TokenFlow } from "./TokenFlow";
import { useLiveLogMetrics } from "./liveDetail";

export interface DetailInfoSectionProps {
	logEntry: LogEntry;
	metadata: Record<string, any>;
	isInProgress: boolean;
}

/** 收起时仍要能扫到的概览值；完整拆分放在展开后的正文里。 */
function HeaderStat({ label, children }: { label: string; children: ReactNode }) {
	return (
		<span className="text-sm whitespace-nowrap">
			<span className="text-gray-500">{label}: </span>
			<span className="font-semibold text-gray-900 tabular-nums">{children}</span>
		</span>
	);
}

/**
 * 详情页的指标与费用合并面板。
 *
 * token、耗时和费用回答的是同一个问题：这次请求消耗了什么、花了多少钱。合并成一张折叠卡片后，
 * 默认收起，标题栏保留 token 总数、耗时和总费用，展开再给出完整指标与费用推导。
 * @param props - 日志条目、metadata 与进行中状态
 */
export function DetailInfoSection({ logEntry, metadata, isInProgress }: DetailInfoSectionProps) {
	const formatMoney = useMoneyFormatter();
	// token / 时长 / TTFT 是流式期间持续变化的部分：订阅指标切片，别的区域不受影响。
	const live = useLiveLogMetrics({
		prompt_tokens: logEntry.prompt_tokens,
		completion_tokens: logEntry.completion_tokens,
		total_tokens: logEntry.total_tokens,
		request_duration_ms: logEntry.request_duration_ms,
		endTime: logEntry.endTime,
		completionStartTime: logEntry.completionStartTime,
	});
	const completionStartTime = live.completionStartTime;
	const cacheReadInputTokens = getCacheReadInputTokens(metadata);
	const cacheCreationInputTokens = getCacheCreationInputTokens(metadata);
	const ttftMs =
		completionStartTime && completionStartTime !== live.endTime
			? new Date(completionStartTime).getTime() - new Date(logEntry.startTime).getTime()
			: null;

	const hasCacheActivity = logEntry.cache_hit || cacheReadInputTokens > 0 || cacheCreationInputTokens > 0;

	const cacheHitValue = String(logEntry.cache_hit ?? "None");
	const cacheHitColor =
		cacheHitValue.toLowerCase() === "true" ? "green" : cacheHitValue.toLowerCase() === "false" ? "red" : "default";

	const costProps: CostBreakdownViewerProps = {
		model: logEntry,
		costBreakdown: metadata?.cost_breakdown,
		totalSpend: logEntry.spend ?? 0,
		promptTokens: live.prompt_tokens,
		completionTokens: live.completion_tokens,
		cacheHit: logEntry.cache_hit,
	};
	const costView = useCostBreakdownView(costProps);

	// 进行中请求的费用要等最终落账，token 只有流式 checkpoint 观测到的部分量。
	const pendingText = <span className="text-black/35">—</span>;
	const observedTokens = (live.prompt_tokens ?? 0) + (live.completion_tokens ?? 0) + (live.total_tokens ?? 0) > 0;
	const summaryTokens = live.total_tokens ?? (live.prompt_tokens ?? 0) + (live.completion_tokens ?? 0);
	// 进行中由前端按秒推进：上游长时间没产出时服务端不会写新的 checkpoint，靠推送会一直停住。
	const durationMs = useLiveDurationMs(logEntry.startTime, isInProgress, live.request_duration_ms);
	const summaryDuration = durationMs != null ? `${(durationMs / 1000).toFixed(3)} s` : pendingText;

	return (
		<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden mb-6">
			<Collapse
				expandIconPosition="start"
				items={[
					{
						key: "detail-info",
						label: (
							<div className="flex w-full flex-wrap items-center justify-between gap-2">
								<h3 className="text-lg font-medium text-gray-900">Detail Info</h3>
								<div className="mr-4 flex flex-wrap items-center gap-x-4 gap-y-1">
									<HeaderStat label="Tokens">
										{isInProgress && !observedTokens ? pendingText : formatNumberWithCommas(summaryTokens, 0, false)}
									</HeaderStat>
									<HeaderStat label="Duration">{summaryDuration}</HeaderStat>
									<HeaderStat label="Total">
										{isInProgress ? (
											pendingText
										) : (
											<>
												{formatMoney(logEntry.spend ?? 0, 8, logEntry)}
												{costView.isCached && " (Cached)"}
											</>
										)}
									</HeaderStat>
								</div>
							</div>
						),
						children: (
							<div className="space-y-4 p-6">
								<Descriptions column={2} size="small">
									<Descriptions.Item label="Tokens">
										{isInProgress && !observedTokens ? (
											<span className="text-black/35">等待上游首个响应</span>
										) : (
											<Space size={4}>
												<TokenFlow
													prompt={live.prompt_tokens}
													completion={live.completion_tokens}
													total={live.total_tokens}
												/>
												{isInProgress && <Tag color="processing">partial</Tag>}
											</Space>
										)}
									</Descriptions.Item>
									<Descriptions.Item label="Duration">
										{durationMs != null ? (durationMs / 1000).toFixed(3) : "-"} s
										{isInProgress && <span className="text-black/35"> (running)</span>}
									</Descriptions.Item>
									{ttftMs != null && ttftMs > 0 && (
										<Descriptions.Item label="Time to First Token">{(ttftMs / 1000).toFixed(3)} s</Descriptions.Item>
									)}

									{hasCacheActivity && (
										<>
											<Descriptions.Item label="Cache Hit">
												<Tag color={cacheHitColor}>{cacheHitValue}</Tag>
											</Descriptions.Item>
											{cacheReadInputTokens > 0 && (
												<Descriptions.Item label="Cache Read Tokens">
													{formatNumberWithCommas(cacheReadInputTokens)}
												</Descriptions.Item>
											)}
											{cacheCreationInputTokens > 0 && (
												<Descriptions.Item label="Cache Creation Tokens">
													{formatNumberWithCommas(cacheCreationInputTokens)}
												</Descriptions.Item>
											)}
										</>
									)}

									{metadata?.litellm_overhead_time_ms !== undefined && metadata.litellm_overhead_time_ms !== null && (
										<Descriptions.Item label="LiteLLM Overhead">
											{metadata.litellm_overhead_time_ms.toFixed(2)} ms
										</Descriptions.Item>
									)}

									<Descriptions.Item label="Retries">
										{metadata?.attempted_retries !== undefined && metadata?.attempted_retries !== null ? (
											metadata.attempted_retries > 0 ? (
												<>
													{metadata.attempted_retries}
													{metadata.max_retries !== undefined && metadata.max_retries !== null
														? ` / ${metadata.max_retries}`
														: ""}
												</>
											) : (
												<Tag color="green">None</Tag>
											)
										) : (
											"-"
										)}
									</Descriptions.Item>

									<Descriptions.Item label="Start Time">
										{moment(logEntry.startTime).format("YYYY-MM-DDTHH:mm:ss.SSS[Z]")}
									</Descriptions.Item>
									<Descriptions.Item label="End Time">
										{isInProgress ? pendingText : moment(live.endTime).format("YYYY-MM-DDTHH:mm:ss.SSS[Z]")}
									</Descriptions.Item>
								</Descriptions>

								{costView.visible && (
									<div className="border-t border-gray-100 pt-4">
										<CostBreakdownDetails {...costProps} />
									</div>
								)}
							</div>
						),
					},
				]}
			/>
		</div>
	);
}
