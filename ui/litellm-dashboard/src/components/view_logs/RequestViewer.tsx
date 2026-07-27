import GuardrailViewer from "@/components/view_logs/GuardrailViewer/GuardrailViewer";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { truncateString } from "@/utils/textUtils";
import type { Row } from "@tanstack/react-table";
import { Tag, Tooltip } from "antd";
import type { LogEntry } from "./columns";
import { ConfigInfoMessage } from "./ConfigInfoMessage";
import { CostBreakdownViewer } from "./CostBreakdownViewer";
import { ErrorViewer } from "./ErrorViewer";
import { RequestResponsePanel } from "./RequestResponsePanel";
import { VectorStoreViewer } from "./VectorStoreViewer";

export function RequestViewer({ row, onOpenSettings }: { row: Row<LogEntry>; onOpenSettings?: () => void }) {
	// Helper function to clean metadata by removing specific fields
	const formatData = (input: any) => {
		if (typeof input === "string") {
			try {
				return JSON.parse(input);
			} catch {
				return input;
			}
		}
		return input;
	};

	// New helper function to get raw request
	const getRawRequest = () => {
		// First check if proxy_server_request exists in metadata
		if (row.original?.proxy_server_request) {
			return formatData(row.original.proxy_server_request);
		}
		// Fall back to messages if proxy_server_request is empty
		return formatData(row.original.messages);
	};

	// Extract error information from metadata if available
	const metadata = row.original.metadata || {};
	const hasError = metadata.status === "failure";
	const errorInfo = hasError ? metadata.error_information : null;

	// Check if request/response data is missing
	const hasMessages =
		row.original.messages &&
		(Array.isArray(row.original.messages)
			? row.original.messages.length > 0
			: Object.keys(row.original.messages).length > 0);
	const hasResponse = row.original.response && Object.keys(formatData(row.original.response)).length > 0;
	const missingData = !hasMessages && !hasResponse && !hasError;

	// Format the response with error details if present
	const formattedResponse = () => {
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
		return formatData(row.original.response);
	};

	// Extract vector store request metadata if available
	const hasVectorStoreData =
		metadata.vector_store_request_metadata &&
		Array.isArray(metadata.vector_store_request_metadata) &&
		metadata.vector_store_request_metadata.length > 0;

	// Extract guardrail information from metadata if available
	const guardrailInfo = row.original.metadata?.guardrail_information;
	const guardrailEntries = Array.isArray(guardrailInfo) ? guardrailInfo : guardrailInfo ? [guardrailInfo] : [];
	const hasGuardrailData = guardrailEntries.length > 0;

	// Calculate total masked entities if guardrail data exists
	const totalMaskedEntities = guardrailEntries.reduce((sum, entry) => {
		const maskedCounts = entry?.masked_entity_count;
		if (!maskedCounts) {
			return sum;
		}
		return (
			sum +
			Object.values(maskedCounts).reduce<number>((acc, count) => (typeof count === "number" ? acc + count : acc), 0)
		);
	}, 0);

	const primaryGuardrailLabel =
		guardrailEntries.length === 1
			? (guardrailEntries[0]?.guardrail_name ?? "-")
			: guardrailEntries.length > 1
				? `${guardrailEntries.length} guardrails`
				: "-";

	const truncatedRequestId = truncateString(row.original.request_id, 64);

	return (
		<div className="p-6 bg-gray-50 space-y-6 w-full max-w-full overflow-hidden box-border">
			{/* Combined Info Card */}
			<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden">
				<div className="p-4 border-b">
					<h3 className="text-lg font-medium">Request Details</h3>
				</div>
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 w-full max-w-full overflow-hidden">
					<div className="space-y-2">
						<div className="flex">
							<span className="font-medium w-1/3">Request ID:</span>
							{row.original.request_id.length > 64 ? (
								<Tooltip title={row.original.request_id}>
									<span className="font-mono text-sm">{truncatedRequestId}</span>
								</Tooltip>
							) : (
								<span className="font-mono text-sm">{row.original.request_id}</span>
							)}
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Model:</span>
							<span>{row.original.model}</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Model ID:</span>
							<span>{row.original.model_id}</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Call Type:</span>
							<span>{row.original.call_type}</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Provider:</span>
							<span>{row.original.custom_llm_provider || "-"}</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">API Base:</span>
							<Tooltip title={row.original.api_base || "-"}>
								<span className="max-w-[15ch] truncate block">{row.original.api_base || "-"}</span>
							</Tooltip>
						</div>
						{row?.original?.requester_ip_address && (
							<div className="flex">
								<span className="font-medium w-1/3">IP Address:</span>
								<span>{row?.original?.requester_ip_address}</span>
							</div>
						)}
						{hasGuardrailData && (
							<div className="flex">
								<span className="font-medium w-1/3">Guardrail:</span>
								<div>
									<span className="font-mono">{primaryGuardrailLabel}</span>
									{totalMaskedEntities > 0 && (
										<span className="ml-2 px-2 py-0.5 bg-blue-50 text-blue-700 rounded-md text-xs font-medium">
											{totalMaskedEntities} masked
										</span>
									)}
								</div>
							</div>
						)}
					</div>
					<div className="space-y-2">
						<div className="flex">
							<span className="font-medium w-1/3">Tokens:</span>
							<span>
								{formatNumberWithCommas(row.original.total_tokens, 0, false)} (
								{formatNumberWithCommas(row.original.prompt_tokens, 0, false)} prompt tokens +{" "}
								{formatNumberWithCommas(row.original.completion_tokens, 0, false)} completion tokens)
							</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Cache Read Tokens:</span>
							<span>
								{formatNumberWithCommas(row.original.metadata?.additional_usage_values?.cache_read_input_tokens || 0)}
							</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Cache Creation Tokens:</span>
							<span>
								{formatNumberWithCommas(row.original.metadata?.additional_usage_values.cache_creation_input_tokens)}
							</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Cost:</span>
							<span>${formatNumberWithCommas(row.original.spend || 0, 6)}</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Cache Hit:</span>
							<span>{row.original.cache_hit}</span>
						</div>

						<div className="flex">
							<span className="font-medium w-1/3">Status:</span>
							<span
								className={`px-2 py-1 rounded-md text-xs font-medium inline-block text-center min-w-16 ${
									(row.original.metadata?.status || row.original.status || "success").toLowerCase() === "in_progress"
										? "bg-amber-100 text-amber-800"
										: (row.original.metadata?.status || row.original.status || "success").toLowerCase() === "failure"
											? "bg-red-100 text-red-800"
											: "bg-green-100 text-green-800"
								}`}
							>
								{(row.original.metadata?.status || row.original.status || "success").toLowerCase() === "in_progress"
									? "In Progress"
									: (row.original.metadata?.status || row.original.status || "success").toLowerCase() === "failure"
										? "Failure"
										: "Success"}
							</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Start Time:</span>
							<span>{row.original.startTime}</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">End Time:</span>
							<span>{row.original.endTime}</span>
						</div>
						<div className="flex">
							<span className="font-medium w-1/3">Duration:</span>
							<span>
								{row.original.request_duration_ms != null ? (row.original.request_duration_ms / 1000).toFixed(3) : "-"}{" "}
								s.
							</span>
						</div>
						{row.original.metadata?.litellm_overhead_time_ms !== undefined && (
							<div className="flex">
								<span className="font-medium w-1/3">LiteLLM Overhead:</span>
								<span>{row.original.metadata.litellm_overhead_time_ms} ms</span>
							</div>
						)}
						<div className="flex">
							<span className="font-medium w-1/3">Retries:</span>
							<span>
								{row.original.metadata?.attempted_retries !== undefined &&
								row.original.metadata?.attempted_retries !== null ? (
									row.original.metadata.attempted_retries > 0 ? (
										`${row.original.metadata.attempted_retries}${row.original.metadata.max_retries !== undefined && row.original.metadata.max_retries !== null ? ` / ${row.original.metadata.max_retries}` : ""}`
									) : (
										<Tag color="green">None</Tag>
									)
								) : (
									"-"
								)}
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Cost Breakdown - Show if cost breakdown data is available */}
			<CostBreakdownViewer
				costBreakdown={row.original.metadata?.cost_breakdown}
				totalSpend={row.original.spend ?? 0}
				promptTokens={row.original.prompt_tokens}
				completionTokens={row.original.completion_tokens}
				cacheHit={row.original.cache_hit}
			/>

			{/* Configuration Info Message - Show when data is missing */}
			<ConfigInfoMessage show={missingData} onOpenSettings={onOpenSettings} />

			{/* Request/Response Panel */}
			<div className="w-full max-w-full overflow-hidden">
				<RequestResponsePanel
					row={row}
					hasMessages={hasMessages}
					hasResponse={hasResponse}
					hasError={hasError}
					errorInfo={errorInfo}
					getRawRequest={getRawRequest}
					formattedResponse={formattedResponse}
				/>
			</div>

			{/* Guardrail Data - Show only if present */}
			{hasGuardrailData && <GuardrailViewer data={guardrailInfo} />}

			{/* Vector Store Request Data - Show only if present */}
			{hasVectorStoreData && <VectorStoreViewer data={metadata.vector_store_request_metadata} />}

			{/* Error Card - Only show for failures */}
			{hasError && errorInfo && <ErrorViewer errorInfo={errorInfo} />}

			{/* Tags Card - Only show if there are tags */}
			{row.original.request_tags && Object.keys(row.original.request_tags).length > 0 && (
				<div className="bg-white rounded-lg shadow">
					<div className="flex justify-between items-center p-4 border-b">
						<h3 className="text-lg font-medium">Request Tags</h3>
					</div>
					<div className="p-4">
						<div className="flex flex-wrap gap-2">
							{Object.entries(row.original.request_tags).map(([key, value]) => (
								<span key={key} className="px-2 py-1 bg-gray-100 rounded-full text-xs">
									{key}: {String(value)}
								</span>
							))}
						</div>
					</div>
				</div>
			)}

			{/* Metadata Card - Only show if there's metadata */}
			{row.original.metadata && Object.keys(row.original.metadata).length > 0 && (
				<div className="bg-white rounded-lg shadow">
					<div className="flex justify-between items-center p-4 border-b">
						<h3 className="text-lg font-medium">Metadata</h3>
						<button
							onClick={() => {
								navigator.clipboard.writeText(JSON.stringify(row.original.metadata, null, 2));
							}}
							className="p-1 hover:bg-gray-200 rounded"
							title="Copy metadata"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							>
								<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
								<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
							</svg>
						</button>
					</div>
					<div className="p-4 overflow-auto max-h-64">
						<pre className="text-xs font-mono whitespace-pre-wrap break-all">
							{JSON.stringify(row.original.metadata, null, 2)}
						</pre>
					</div>
				</div>
			)}
		</div>
	);
}
