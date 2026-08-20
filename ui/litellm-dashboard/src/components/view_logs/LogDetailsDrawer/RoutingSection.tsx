import { ArrowRightOutlined, CheckCircleOutlined, ExclamationCircleOutlined } from "@ant-design/icons";
import { Collapse, Space, Tag, Typography } from "antd";
import type { LogEntry, ModelResolutionChainEntry } from "../columns";

const { Text } = Typography;

interface RoutingTraceEntry {
	fallback_index: number;
	from_model: string;
	to_model: string;
	to_resolved_model: string;
	resolution_path: string[];
	routing_type: "general_fallback" | "context_window_fallback" | "content_policy_fallback";
	reason:
		| "no_available_deployment"
		| "rate_limit"
		| "context_window_exceeded"
		| "content_policy_violation"
		| "upstream_error";
	attempted_deployment?: string;
	error_information: {
		error_type: string;
		error_code: string | number | null;
		error_message: string;
	};
}

function normalizeRoutingTrace(value: unknown): RoutingTraceEntry[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((raw) => {
		if (typeof raw !== "object" || raw === null) return [];
		const entry = raw as Partial<RoutingTraceEntry>;
		const error = entry.error_information;
		if (
			!Number.isInteger(entry.fallback_index) ||
			(entry.fallback_index ?? 0) < 1 ||
			typeof entry.from_model !== "string" ||
			typeof entry.to_model !== "string" ||
			typeof entry.to_resolved_model !== "string" ||
			!Array.isArray(entry.resolution_path) ||
			!entry.resolution_path.every((node) => typeof node === "string") ||
			!(["general_fallback", "context_window_fallback", "content_policy_fallback"] as const).includes(
				entry.routing_type as RoutingTraceEntry["routing_type"],
			) ||
			!(
				[
					"no_available_deployment",
					"rate_limit",
					"context_window_exceeded",
					"content_policy_violation",
					"upstream_error",
				] as const
			).includes(entry.reason as RoutingTraceEntry["reason"]) ||
			!error ||
			typeof error.error_type !== "string" ||
			!(typeof error.error_code === "string" || typeof error.error_code === "number" || error.error_code === null) ||
			typeof error.error_message !== "string"
		) {
			return [];
		}
		return [{ ...(entry as RoutingTraceEntry), resolution_path: [...entry.resolution_path] }];
	});
}

const ROUTING_TYPE_LABELS: Record<RoutingTraceEntry["routing_type"], string> = {
	general_fallback: "General fallback",
	context_window_fallback: "Context window fallback",
	content_policy_fallback: "Content policy fallback",
};

const REASON_LABELS: Record<RoutingTraceEntry["reason"], string> = {
	no_available_deployment: "No available deployment",
	rate_limit: "Rate limit",
	context_window_exceeded: "Context window exceeded",
	content_policy_violation: "Content policy violation",
	upstream_error: "Upstream error",
};

function findResolution(entries: ModelResolutionChainEntry[], fallbackIndex: number) {
	return entries.find((entry) => entry.fallback_index === fallbackIndex);
}

export function RoutingSection({
	logEntry,
	modelResolutionChain,
}: {
	logEntry: LogEntry;
	modelResolutionChain: ModelResolutionChainEntry[];
}) {
	const metadata = logEntry.metadata ?? {};
	const fallbackModels = Array.isArray(metadata.fallback_models)
		? metadata.fallback_models.filter(
				(model: unknown): model is string => typeof model === "string" && model.length > 0,
			)
		: [];
	const routingTrace = normalizeRoutingTrace(metadata.routing_trace).sort(
		(left, right) => left.fallback_index - right.fallback_index,
	);
	const originalResolution = modelResolutionChain.find((entry) => entry.fallback_index === 0);
	const originalModel = fallbackModels[0] ?? originalResolution?.input_model ?? logEntry.model;
	const fallbackCount = Math.max(fallbackModels.length - 1, ...routingTrace.map((entry) => entry.fallback_index), 0);
	const hasRoutingData = fallbackCount > 0 || modelResolutionChain.length > 0;
	const finalStatusClasses =
		metadata.status === "failure" ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50";
	const finalStatusIconClass = metadata.status === "failure" ? "text-red-600" : "text-emerald-600";

	if (!hasRoutingData) return null;

	return (
		<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden mb-6">
			<Collapse
				defaultActiveKey={[]}
				expandIconPosition="start"
				items={[
					{
						key: "routing",
						label: (
							<div className="flex items-center gap-2">
								<h3 className="text-lg font-medium text-gray-900 m-0">Routing</h3>
								{fallbackCount > 0 && (
									<Tag color="orange">
										{fallbackCount} fallback{fallbackCount === 1 ? "" : "s"}
									</Tag>
								)}
							</div>
						),
						children: (
							<div className="space-y-4" data-testid="routing-details">
								<div className="rounded-md border border-slate-200 bg-slate-50 p-3">
									<Text type="secondary" className="block text-xs uppercase tracking-wide">
										Original request
									</Text>
									<Text code>{originalModel}</Text>
									{originalResolution?.resolution_path.length ? (
										<div className="mt-2 text-xs text-slate-600">
											Resolution: {originalResolution.resolution_path.join(" → ")}
										</div>
									) : null}
								</div>

								{Array.from({ length: fallbackCount }, (_, offset) => offset + 1).map((fallbackIndex) => {
									const trace = routingTrace.find((entry) => entry.fallback_index === fallbackIndex);
									const resolution = findResolution(modelResolutionChain, fallbackIndex);
									const fromModel = trace?.from_model ?? fallbackModels[fallbackIndex - 1] ?? "Unknown";
									const toModel =
										trace?.to_model ?? resolution?.input_model ?? fallbackModels[fallbackIndex] ?? "Unknown";
									const resolvedTarget =
										trace?.to_resolved_model ?? resolution?.resolved_model ?? fallbackModels[fallbackIndex] ?? toModel;
									const resolutionPath = trace?.resolution_path ?? resolution?.resolution_path ?? [toModel];

									return (
										<div key={fallbackIndex} className="rounded-md border border-slate-200 p-3">
											<div className="flex flex-wrap items-center gap-2">
												<Text strong>Hop {fallbackIndex}</Text>
												{trace && <Tag color="blue">{ROUTING_TYPE_LABELS[trace.routing_type]}</Tag>}
											</div>
											<Space wrap className="mt-2 font-mono">
												<Text code>{fromModel}</Text>
												<ArrowRightOutlined className="text-slate-400" />
												<Text code>{resolvedTarget}</Text>
											</Space>
											{resolutionPath.length > 1 && (
												<div className="mt-2 text-xs text-slate-600">Resolution: {resolutionPath.join(" → ")}</div>
											)}
											{trace?.attempted_deployment && (
												<div className="mt-2 text-xs text-slate-600">
													Failed upstream: <Text code>{trace.attempted_deployment}</Text>
												</div>
											)}
											<div className="mt-3 rounded bg-red-50 p-3 text-sm">
												{trace ? (
													<>
														<div className="mb-1 flex flex-wrap items-center gap-2">
															<Tag color="red">{REASON_LABELS[trace.reason]}</Tag>
															<Text type="secondary">
																{trace.error_information.error_type}
																{trace.error_information.error_code !== null
																	? ` · ${trace.error_information.error_code}`
																	: ""}
															</Text>
														</div>
														<div className="whitespace-pre-wrap break-words text-red-900">
															{trace.error_information.error_message}
														</div>
													</>
												) : (
													<Text type="secondary">Fallback reason and error were not recorded for this log.</Text>
												)}
											</div>
										</div>
									);
								})}

								<div className={`rounded-md border p-3 ${finalStatusClasses}`}>
									<div className="flex items-center gap-2">
										{metadata.status === "failure" ? (
											<ExclamationCircleOutlined className={finalStatusIconClass} />
										) : (
											<CheckCircleOutlined className={finalStatusIconClass} />
										)}
										<Text strong>
											{metadata.status === "failure" ? "Final attempted upstream" : "Final upstream model"}
										</Text>
									</div>
									<div className="mt-1">
										<Text code>{logEntry.model}</Text>
									</div>
								</div>
							</div>
						),
					},
				]}
			/>
		</div>
	);
}
