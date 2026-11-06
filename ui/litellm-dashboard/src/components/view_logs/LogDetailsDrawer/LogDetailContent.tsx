import { ModelPriceScope } from "@/contexts/PriceDisplay";
import { memo, useCallback, useMemo, useState } from "react";
import { Typography, Descriptions, Card, Tag, Tabs, Alert, Collapse, Radio, Space, Spin, Button } from "antd";
import { LogEntry, normalizeModelResolutionChain } from "../columns";
import GuardrailViewer from "../GuardrailViewer/GuardrailViewer";
import { ConfigInfoMessage } from "../ConfigInfoMessage";
import { VectorStoreViewer } from "../VectorStoreViewer";
import { TruncatedValue } from "./TruncatedValue";
import { JsonViewer } from "./JsonViewer";
import {
	formatData,
	checkHasMessages,
	checkHasResponse,
	normalizeGuardrailEntries,
	calculateTotalMaskedEntities,
	getGuardrailLabel,
	checkHasVectorStoreData,
} from "./utils";
import {
	DRAWER_CONTENT_PADDING,
	API_BASE_MAX_WIDTH,
	METADATA_MAX_HEIGHT,
	TAB_REQUEST,
	TAB_RESPONSE,
	FONT_SIZE_SMALL,
	FONT_FAMILY_MONO,
	SPACING_XLARGE,
	SPACING_MEDIUM,
} from "./constants";
import { PrettyMessagesView } from "./PrettyMessagesView";
import { UpstreamDownstreamDiff } from "./UpstreamDownstreamDiff";
import { RoutingSection } from "./RoutingSection";
import { DetailInfoSection } from "./DetailInfoSection";
import { areSameStaticLogFields, isEntryInProgress, useLiveLogMetrics, useLiveLogResponse } from "./liveDetail";

const { Text } = Typography;

export interface LogDetailContentProps {
	logEntry: LogEntry;
	onOpenSettings?: () => void;
	/**
	 * 是否已在 Spend Logs Settings 开启上游详情记录。
	 *
	 * undefined 表示设置尚未加载；只有明确为 false 时才能把缺失原因归到设置上，
	 * 否则会把记录缺陷或历史日志误报成配置问题。
	 */
	upstreamLogsEnabled?: boolean;
	/** When true, log details (messages/response) are still being lazy-loaded. */
	isLoadingDetails?: boolean;
	accessToken?: string | null;
}

/**
 * The scrollable detail content for a single log entry.
 * Renders request details, the merged detail info (metrics + cost breakdown), request/response,
 * guardrails, vector store data, and metadata.
 *
 * Designed to be placed inside LogDetailsDrawer's right panel so it can
 * be reused for both single-log and session-mode views.
 */
function LogDetailContentImpl({
	logEntry,
	onOpenSettings,
	upstreamLogsEnabled,
	isLoadingDetails = false,
	accessToken,
}: LogDetailContentProps) {
	const metadata = logEntry.metadata || {};
	const hasError = metadata.status === "failure";
	const errorInfo = hasError ? metadata.error_information : null;
	const modelResolutionChain = normalizeModelResolutionChain(metadata.model_resolution_chain);

	const hasMessages = checkHasMessages(logEntry.messages);
	// 是否完全缺数据只看当前条目；流式期间即使还没有响应，也由 isInProgress 兜底。
	const hasResponse = checkHasResponse(logEntry.response);
	// proxy_server_request 可能带图片 base64；推送帧只覆盖变化字段，按字段引用缓存即可，
	// 流式期间不会每帧重新解析。
	const parsedProxyRequest = useMemo(() => formatData(logEntry.proxy_server_request), [logEntry.proxy_server_request]);
	const upstreamRequest =
		parsedProxyRequest && typeof parsedProxyRequest === "object" && !Array.isArray(parsedProxyRequest)
			? formatData(parsedProxyRequest.upstream_request)
			: null;
	const upstreamResponse =
		parsedProxyRequest && typeof parsedProxyRequest === "object" && !Array.isArray(parsedProxyRequest)
			? formatData(parsedProxyRequest.upstream_response)
			: null;
	// Don't show "missing data" warning while details are still loading
	// 进行中请求允许暂时无 response（等流式产生内容），不显示缺失提示
	const isInProgress = logEntry.status === "in_progress" || metadata.status === "in_progress";
	const missingData = !hasMessages && !hasResponse && !hasError && !isInProgress && !isLoadingDetails;

	// Guardrail data
	const guardrailInfo = metadata?.guardrail_information;
	const guardrailEntries = normalizeGuardrailEntries(guardrailInfo);
	const hasGuardrailData = guardrailEntries.length > 0;
	const totalMaskedEntities = calculateTotalMaskedEntities(guardrailEntries);
	const primaryGuardrailLabel = getGuardrailLabel(guardrailEntries);

	// Vector store data
	const hasVectorStoreData = checkHasVectorStoreData(metadata);

	const getRecordedDownstreamRequest = useCallback(() => {
		const parsedProxy = parsedProxyRequest;
		if (parsedProxy && typeof parsedProxy === "object" && !Array.isArray(parsedProxy)) {
			const {
				upstream_request: _upstreamRequest,
				upstream_response: _upstreamResponse,
				...downstreamRequest
			} = parsedProxy;
			return downstreamRequest;
		}
		return formatData(logEntry.proxy_server_request || logEntry.messages);
	}, [logEntry.messages, logEntry.proxy_server_request, parsedProxyRequest]);

	const getRawRequest = useCallback(() => {
		const downstreamRequest = getRecordedDownstreamRequest();
		// proxy_server_request 入库时对超长字符串统一截断（含图片 base64），
		// 而 messages 列为 Logs/Session 重放保留完整图片。普通下游详情用
		// messages 替换截断副本；Diff 则必须比较链路中实际记录的原始值。
		if (downstreamRequest && typeof downstreamRequest === "object" && !Array.isArray(downstreamRequest)) {
			const body = downstreamRequest.body;
			if (
				body &&
				typeof body === "object" &&
				!Array.isArray(body) &&
				Array.isArray(logEntry.messages) &&
				logEntry.messages.length > 0
			) {
				if (Array.isArray(body.messages)) {
					return { ...downstreamRequest, body: { ...body, messages: logEntry.messages } };
				}
				if (Array.isArray(body.input)) {
					return { ...downstreamRequest, body: { ...body, input: logEntry.messages } };
				}
			}
			return downstreamRequest;
		}
		return downstreamRequest;
	}, [getRecordedDownstreamRequest, logEntry.messages]);

	return (
		<ModelPriceScope model={logEntry}>
			<div style={{ padding: `${DRAWER_CONTENT_PADDING} ${DRAWER_CONTENT_PADDING} 0` }}>
				{/* Error Alert */}
				{hasError && errorInfo && (
					<Alert
						type="error"
						showIcon
						message="Request Failed"
						description={<ErrorDescription errorInfo={errorInfo} />}
						className="mb-6"
					/>
				)}

				{/* Tags */}
				{logEntry.request_tags && Object.keys(logEntry.request_tags).length > 0 && (
					<TagsSection tags={logEntry.request_tags} />
				)}

				{/* Request Details */}
				<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden mb-6">
					<Card title="Request Details" size="small" bordered={false} style={{ marginBottom: 0 }}>
						<Descriptions column={2} size="small">
							<Descriptions.Item label="Model">{logEntry.model}</Descriptions.Item>
							<Descriptions.Item label="Provider">{logEntry.custom_llm_provider || "-"}</Descriptions.Item>
							{logEntry.metadata?.internal_call_type === "builtin_capability" ? (
								<>
									<Descriptions.Item label="Built-in Capability">
										<Tag color="purple">{String(logEntry.metadata?.builtin_capability || "unknown")}</Tag>
									</Descriptions.Item>
									<Descriptions.Item label="Parent Request">
										<TruncatedValue value={logEntry.metadata?.parent_request_id} />
									</Descriptions.Item>
								</>
							) : null}
							<Descriptions.Item label="Call Type">{logEntry.call_type}</Descriptions.Item>
							<Descriptions.Item label="Model ID">
								<TruncatedValue value={logEntry.model_id} />
							</Descriptions.Item>
							<Descriptions.Item label="API Base">
								<TruncatedValue value={logEntry.api_base} maxWidth={API_BASE_MAX_WIDTH} />
							</Descriptions.Item>
							{logEntry.requester_ip_address && (
								<Descriptions.Item label="IP Address">{logEntry.requester_ip_address}</Descriptions.Item>
							)}
							{hasGuardrailData && (
								<Descriptions.Item label="Guardrail">
									<GuardrailLabel label={primaryGuardrailLabel} maskedCount={totalMaskedEntities} />
								</Descriptions.Item>
							)}
						</Descriptions>
					</Card>
				</div>

				<RoutingSection logEntry={logEntry} modelResolutionChain={modelResolutionChain} />

				{/* Metrics + cost breakdown, folded into one panel */}
				<DetailInfoSection logEntry={logEntry} metadata={metadata} isInProgress={isInProgress} />

				{/* Configuration Info Message */}
				{missingData && (
					<div className="mb-6">
						<ConfigInfoMessage show={missingData} onOpenSettings={onOpenSettings} />
					</div>
				)}

				{/* Request/Response JSON */}
				{isLoadingDetails ? (
					<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden mb-6 p-8 text-center">
						<Spin size="default" />
						<div style={{ marginTop: 8, color: "#999" }}>Loading request &amp; response data...</div>
					</div>
				) : (
					<RequestResponseSection
						hasError={hasError}
						errorInfo={errorInfo}
						getRawRequest={getRawRequest}
						getRecordedDownstreamRequest={getRecordedDownstreamRequest}
						upstreamRequest={upstreamRequest}
						upstreamResponse={upstreamResponse}
						onOpenSettings={onOpenSettings}
						upstreamLogsEnabled={upstreamLogsEnabled}
						logEntry={logEntry}
					/>
				)}

				{/* Guardrail Data */}
				{hasGuardrailData && (
					<div id="guardrail-section">
						<GuardrailViewer
							data={guardrailInfo}
							accessToken={accessToken ?? null}
							logEntry={{
								request_id: logEntry.request_id,
								user: logEntry.user,
								model: logEntry.model,
								startTime: logEntry.startTime,
								metadata: logEntry.metadata,
							}}
						/>
					</div>
				)}

				{/* Vector Store Data */}
				{hasVectorStoreData && <VectorStoreViewer data={metadata.vector_store_request_metadata} />}

				{/* Metadata */}
				{logEntry.metadata && Object.keys(logEntry.metadata).length > 0 && (
					<MetadataSection metadata={logEntry.metadata} />
				)}

				{/* Bottom spacing */}
				<div style={{ height: DRAWER_CONTENT_PADDING }} />
			</div>
		</ModelPriceScope>
	);
}

// ============================================================================
// Helper Components
// ============================================================================

function ErrorDescription({ errorInfo }: { errorInfo: any }) {
	return (
		<div>
			{errorInfo.error_code && (
				<div>
					<Text strong>Error Code:</Text> {errorInfo.error_code}
				</div>
			)}
			{errorInfo.error_message && (
				<div>
					<Text strong>Message:</Text> {errorInfo.error_message}
				</div>
			)}
		</div>
	);
}

function TagsSection({ tags }: { tags: Record<string, any> }) {
	return (
		<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden p-4 mb-6">
			<Text strong style={{ display: "block", marginBottom: 8, fontSize: 16 }}>
				Tags
			</Text>
			<Space size={SPACING_MEDIUM} wrap>
				{Object.entries(tags).map(([key, value]) => (
					<Tag key={key}>
						{key}: {String(value)}
					</Tag>
				))}
			</Space>
		</div>
	);
}

function GuardrailLabel({ label, maskedCount }: { label: string; maskedCount: number }) {
	const handleClick = () => {
		const el = document.getElementById("guardrail-section");
		if (el) el.scrollIntoView({ behavior: "smooth" });
	};

	return (
		<Space size={SPACING_MEDIUM}>
			<a onClick={handleClick} style={{ cursor: "pointer" }}>
				{label}
			</a>
			{maskedCount > 0 && <Tag color="blue">{maskedCount} masked</Tag>}
		</Space>
	);
}

interface RequestResponseSectionProps {
	hasError: boolean;
	errorInfo: any;
	getRawRequest: () => any;
	getRecordedDownstreamRequest: () => any;
	upstreamRequest: unknown;
	upstreamResponse: unknown;
	onOpenSettings?: () => void;
	upstreamLogsEnabled?: boolean;
	logEntry: LogEntry;
}

function RequestResponseSection({
	hasError,
	errorInfo,
	getRawRequest,
	getRecordedDownstreamRequest,
	upstreamRequest,
	upstreamResponse,
	onOpenSettings,
	upstreamLogsEnabled,
	logEntry,
}: RequestResponseSectionProps) {
	const [activeTab, setActiveTab] = useState<typeof TAB_REQUEST | typeof TAB_RESPONSE>(TAB_REQUEST);
	const [viewMode, setViewMode] = useState<"pretty" | "json">("pretty");
	const [source, setSource] = useState<"downstream" | "upstream" | "diff">("downstream");
	const hasUpstreamTrace = Boolean(upstreamRequest || upstreamResponse);
	// 响应与 token 是流式期间唯一变化的部分，单独订阅；请求侧按回调身份缓存，
	// 避免每帧重新解析整段对话。
	const liveResponse = useLiveLogResponse(logEntry.response);
	const liveMetrics = useLiveLogMetrics({
		prompt_tokens: logEntry.prompt_tokens,
		completion_tokens: logEntry.completion_tokens,
	});
	const hasResponse = checkHasResponse(liveResponse);
	const downstreamRequest = useMemo(() => getRawRequest(), [getRawRequest]);
	const downstreamDiffRequest = useMemo(() => getRecordedDownstreamRequest(), [getRecordedDownstreamRequest]);
	const downstreamResponse = useMemo(() => {
		if (hasError && errorInfo) {
			return {
				error: {
					message: errorInfo.error_message || "An error occurred",
					type: errorInfo.error_class || "error",
					code: errorInfo.error_code || "unknown",
					param: null,
				},
			};
		}
		return formatData(liveResponse);
	}, [hasError, errorInfo, liveResponse]);
	const upstreamResponseBody =
		upstreamResponse &&
		typeof upstreamResponse === "object" &&
		!Array.isArray(upstreamResponse) &&
		"body" in upstreamResponse
			? upstreamResponse.body
			: null;
	const hasDiffData = Boolean(downstreamDiffRequest && upstreamRequest);

	const totalSpend = logEntry.spend ?? 0;
	const promptTokens = liveMetrics.prompt_tokens || 0;
	const completionTokens = liveMetrics.completion_tokens || 0;
	const totalTokens = promptTokens + completionTokens;
	const costBreakdown = logEntry.metadata?.cost_breakdown;
	const useCostBreakdown = costBreakdown?.input_cost !== undefined && costBreakdown?.output_cost !== undefined;
	const inputCost = useCostBreakdown
		? costBreakdown!.input_cost ?? 0
		: totalTokens > 0
			? (totalSpend * promptTokens) / totalTokens
			: 0;
	const outputCost = useCostBreakdown
		? costBreakdown!.output_cost ?? 0
		: totalTokens > 0
			? (totalSpend * completionTokens) / totalTokens
			: 0;

	return (
		<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden mb-6">
			<Collapse
				defaultActiveKey={["1"]}
				expandIconPosition="start"
				items={[
					{
						key: "1",
						label: (
							<div
								style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}
								onClick={(e) => {
									const target = e.target as HTMLElement;
									if (target.closest(".ant-radio-group")) {
										e.stopPropagation();
									}
								}}
							>
								<h3 className="text-lg font-medium text-gray-900" style={{ margin: 0 }}>
									Request & Response
								</h3>
								{source === "downstream" && (
									<Radio.Group size="small" value={viewMode} onChange={(e) => setViewMode(e.target.value)}>
										<Radio.Button value="pretty">Pretty</Radio.Button>
										<Radio.Button value="json">JSON</Radio.Button>
									</Radio.Group>
								)}
							</div>
						),
						children: (
							<div>
								<Tabs
									activeKey={source}
									onChange={(key) => setSource(key as "downstream" | "upstream" | "diff")}
									items={[
										{
											key: "downstream",
											label: "Downstream",
											children:
												viewMode === "pretty" ? (
													<PrettyMessagesView
														request={downstreamRequest}
											metaRequest={upstreamRequest}
														response={downstreamResponse}
														metrics={{
															prompt_tokens: promptTokens,
															completion_tokens: completionTokens,
															input_cost: inputCost,
															output_cost: outputCost,
														}}
													/>
												) : (
													<RequestResponseJsonTabs
														activeTab={activeTab}
														onTabChange={setActiveTab}
														request={downstreamRequest}
														response={downstreamResponse}
														hasResponse={hasResponse || hasError}
													/>
												),
										},
										{
											key: "upstream",
											label: "Upstream",
											children: hasUpstreamTrace ? (
												<RequestResponseJsonTabs
													activeTab={activeTab}
													onTabChange={setActiveTab}
													request={upstreamRequest}
													response={upstreamResponse}
													hasResponse={Boolean(upstreamResponse)}
												/>
											) : upstreamLogsEnabled === true ? (
												<Alert
													type="info"
													showIcon
													message="This request has no recorded upstream details"
													description={
														<span>
															Upstream log details are already enabled, so new requests record the provider exchange. This
															entry has none: it was written before that setting was turned on, or the provider call never
															completed. Check the matching audit entry for the provider response.
														</span>
													}
												/>
											) : (
												<Alert
													type="info"
													showIcon
													message="Upstream request and response details are not available"
													description={
														upstreamLogsEnabled === false ? (
															onOpenSettings ? (
																<span>
																	Enable upstream log details in Spend Logs Settings to record future provider exchanges.
																	<Button type="link" onClick={onOpenSettings} style={{ padding: 0, marginLeft: 4 }}>
																		Open settings
																	</Button>
																</span>
															) : (
																"Enable upstream log details in Spend Logs Settings to record future provider exchanges."
															)
														) : (
															"Upstream request and response details were not recorded for this exchange."
														)
													}
												/>
											),
										},
										...(hasDiffData
											? [
													{
														key: "diff",
														label: "Diff",
														children: (
															<UpstreamDownstreamDiff
																downstreamRequest={downstreamDiffRequest}
																upstreamRequest={upstreamRequest}
																downstreamResponse={downstreamResponse}
																upstreamResponse={upstreamResponseBody}
															/>
														),
													},
												]
											: []),
									]}
								/>
							</div>
						),
					},
				]}
			/>
		</div>
	);
}

interface RequestResponseJsonTabsProps {
	activeTab: typeof TAB_REQUEST | typeof TAB_RESPONSE;
	onTabChange: (key: typeof TAB_REQUEST | typeof TAB_RESPONSE) => void;
	request: unknown;
	response: unknown;
	hasResponse: boolean;
}

function RequestResponseJsonTabs({
	activeTab,
	onTabChange,
	request,
	response,
	hasResponse,
}: RequestResponseJsonTabsProps) {
	return (
		<Tabs
			activeKey={activeTab}
			onChange={(key) => onTabChange(key as typeof TAB_REQUEST | typeof TAB_RESPONSE)}
			tabBarExtraContent={
				<Text
					copyable={{
						text: JSON.stringify(activeTab === TAB_REQUEST ? request : response, null, 2),
						tooltips: ["Copy JSON", "Copied!"],
					}}
					disabled={activeTab === TAB_RESPONSE && !hasResponse}
				/>
			}
			items={[
				{
					key: TAB_REQUEST,
					label: "Request",
					children: (
						<div style={{ paddingTop: SPACING_XLARGE, paddingBottom: SPACING_XLARGE }}>
							{request ? (
								<JsonViewer data={request} mode="formatted" />
							) : (
								<div style={{ textAlign: "center", padding: 20, color: "#999", fontStyle: "italic" }}>
									Request data not available
								</div>
							)}
						</div>
					),
				},
				{
					key: TAB_RESPONSE,
					label: "Response",
					children: (
						<div style={{ paddingTop: SPACING_XLARGE, paddingBottom: SPACING_XLARGE }}>
							{hasResponse ? (
								<JsonViewer data={response} mode="formatted" />
							) : (
								<div style={{ textAlign: "center", padding: 20, color: "#999", fontStyle: "italic" }}>
									Response data not available
								</div>
							)}
						</div>
					),
				},
			]}
		/>
	);
}

export function GuardrailJumpLink({ guardrailEntries }: { guardrailEntries: any[] }) {
	const allPassed = guardrailEntries.every((e) => {
		const status = e?.guardrail_status || e?.status;
		return status === "pass" || status === "passed" || status === "success";
	});

	const handleClick = () => {
		const el = document.getElementById("guardrail-section");
		if (el) el.scrollIntoView({ behavior: "smooth" });
	};

	return (
		<div style={{ textAlign: "left", marginBottom: 12 }}>
			<div
				onClick={handleClick}
				style={{
					display: "inline-flex",
					alignItems: "center",
					gap: 6,
					padding: "4px 12px",
					borderRadius: 16,
					cursor: "pointer",
					fontSize: 13,
					fontWeight: 500,
					backgroundColor: allPassed ? "#f0fdf4" : "#fef2f2",
					color: allPassed ? "#15803d" : "#b91c1c",
					border: `1px solid ${allPassed ? "#bbf7d0" : "#fecaca"}`,
				}}
			>
				{allPassed ? "\u2713" : "\u2717"} {guardrailEntries.length} guardrail{guardrailEntries.length !== 1 ? "s" : ""}{" "}
				evaluated
				<span style={{ fontSize: 11, opacity: 0.7 }}>{"\u2193"}</span>
			</div>
		</div>
	);
}

function MetadataSection({ metadata }: { metadata: Record<string, any> }) {
	return (
		<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden mb-6">
			<Collapse
				defaultActiveKey={[]}
				expandIconPosition="start"
				items={[
					{
						key: "1",
						label: <h3 className="text-lg font-medium text-gray-900">Metadata</h3>,
						children: (
							<div>
								<div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
									<Text
										copyable={{
											text: JSON.stringify(metadata, null, 2),
											tooltips: ["Copy Metadata", "Copied!"],
										}}
									/>
								</div>
								<pre
									style={{
										maxHeight: METADATA_MAX_HEIGHT,
										overflowY: "auto",
										fontSize: FONT_SIZE_SMALL,
										fontFamily: FONT_FAMILY_MONO,
										whiteSpace: "pre-wrap",
										wordBreak: "break-all",
										margin: 0,
									}}
								>
									{JSON.stringify(metadata, null, 2)}
								</pre>
							</div>
						),
					},
				]}
			/>
		</div>
	);
}

/**
 * 进行中请求只比较静态字段。
 *
 * 推送帧每 400ms 换一次 `logEntry` 身份，但除了响应/token/耗时之外的字段引用都没变；
 * 这种情况下不重渲染详情主体，变化的区域由 context 驱动。
 * @param previous - 上一次 props
 * @param next - 本次 props
 */
function areLogDetailContentPropsEqual(previous: LogDetailContentProps, next: LogDetailContentProps): boolean {
	if (previous.onOpenSettings !== next.onOpenSettings) return false;
	if (previous.upstreamLogsEnabled !== next.upstreamLogsEnabled) return false;
	if (previous.isLoadingDetails !== next.isLoadingDetails) return false;
	if (previous.accessToken !== next.accessToken) return false;
	if (previous.logEntry === next.logEntry) return true;
	// 已结算的条目正常重渲染；只有流式期间才忽略高频字段。
	return isEntryInProgress(next.logEntry) && areSameStaticLogFields(previous.logEntry, next.logEntry);
}

/**
 * 详情页主体。
 *
 * 用 `memo` + 静态字段比较包住：流式期间抽屉每 400ms 重渲染一次，这里直接跳过；
 * 真正变化的响应/指标由 `LogDetailLiveProvider` 通过 context 送到对应区域。
 */
export const LogDetailContent = memo(LogDetailContentImpl, areLogDetailContentPropsEqual);
