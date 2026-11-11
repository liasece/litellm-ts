import { createHash } from "node:crypto";
import type { Request } from "express";
import type { DrizzleDb } from "../core/db/Database";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { buildSpendLogFromRequest } from "../spend/SpendTracker";
import { queueSpendLog } from "../spend/SpendSettlementQueue";
import { getAttachedUpstreamLogContext, type UpstreamLogContext } from "../router/UpstreamLogContext";
import { CallType, SpendLogStatus } from "../types/spend";

/** Reference to the ordinary Spend Log row created for an internal call. */
export interface BuiltinCapabilityAuditReference {
	/** Child Spend Log request ID. */
	readonly requestId: string;
}

/** One ordinary model request made by a private built-in capability. */
export interface BuiltinCapabilityModelCall {
	/** Built-in capability identifier. */
	readonly capability: "vision" | "web" | "image_generation";
	/** Worker request or main-model continuation. */
	readonly stage: "handler" | "continuation";
	/** Spend Log protocol classification. */
	readonly callType: "acompletion" | "amessages" | "aimage_generation" | "asearch";
	/** Logical model used by this request. */
	readonly model: string;
	/** Private tool call that triggered the request. */
	readonly toolCallId: string;
	/** 执行链元素的稳定标识，例如 model:gpt-5.4 或 deepseek_tools:ds-prod。 */
	readonly executor?: string;
	/** 直连执行者使用的命名 Credential 名称（非密钥本身）。 */
	readonly credentialName?: string;
	/**
	 * 直连工具调用的固定费用（美元）。
	 *
	 * 直连执行者不产生模型调用，token 费用恒 0；该值让按次计费出现在
	 * SpendLogs.spend 与 metadata.cost_breakdown.tool_usage_cost 中。
	 */
	readonly fixedCostUsd?: number;
	/** Actual messages sent to the model. */
	readonly messages: import("../types/openai").Message[];
	/** Full protocol request body, when relevant. */
	readonly requestBody?: Record<string, unknown>;
	/** Attempt start time. */
	readonly startTime: Date;
	/** Attempt end time. */
	readonly endTime: Date;
	/** Successful model response. */
	readonly response?: Record<string, unknown>;
	/** Provider or routing failure. */
	readonly error?: unknown;
	/**
	 * 本次内部调用自己的上游交换。
	 *
	 * 内部调用运行在独立的旁路子作用域里，外层请求的通道记录的是外层交换；
	 * 由执行者显式带上，审计行才不会写错对象或缺详情。
	 */
	readonly upstreamLogContext?: UpstreamLogContext;
	/** Delegated image references. */
	readonly imageRefs?: string[];
	/** Delegated visual question. */
	readonly question?: string;
	/** Requested visual detail. */
	readonly detail?: string;
	/** Image creation/editing action. */
	readonly action?: "create" | "edit";
	/** Image generation/editing prompt. */
	readonly prompt?: string;
	/** Delegated web query. */
	readonly query?: string;
	/** Delegated webpage URL. */
	readonly url?: string;
}

/** Records one private built-in capability model request. */
export type BuiltinCapabilityAuditHook = (call: BuiltinCapabilityModelCall) => Promise<BuiltinCapabilityAuditReference>;

interface BuiltinCapabilityAuditorOptions {
	/** Production database used by ordinary Spend Logs. */
	readonly db?: DrizzleDb;
	/** Authenticated outer HTTP request. */
	readonly req: Request;
	/** Spend Log request ID of the outer user request. */
	readonly parentRequestId?: string;
}

function mapCallType(callType: BuiltinCapabilityModelCall["callType"]): CallType {
	switch (callType) {
		case "amessages":
			return CallType.AMessages;
		case "aimage_generation":
			return CallType.AImageGeneration;
		case "asearch":
			return CallType.ASearch;
		default:
			return CallType.ACompletion;
	}
}

/**
 * Create an endpoint-owned recorder that persists every capability-model
 * attempt as an ordinary Spend Log row in the same session as its parent.
 * @param options
 */
export function createBuiltinCapabilityAuditHook(options: BuiltinCapabilityAuditorOptions): BuiltinCapabilityAuditHook | undefined {
	const { db, req, parentRequestId } = options;
	const auth = req.auth;
	if (!db || !auth || !parentRequestId) {
		return undefined;
	}
	let sequence = 0;
	return async (call: BuiltinCapabilityModelCall) => {
		sequence += 1;
		const requestId = createHash("sha256")
			.update(parentRequestId)
			.update(`\0builtin-capability\0${call.capability}\0`)
			.update(String(sequence))
			.update("\0")
			.update(call.toolCallId)
			.digest("hex");
		const spendInfo = call.response?.["_spendInfo"] as DeploymentSpendInfo | undefined;
		const status = call.error ? SpendLogStatus.Failure : SpendLogStatus.Success;
		const requestMetadata =
			typeof call.requestBody?.["metadata"] === "object" && call.requestBody["metadata"] !== null
				? (call.requestBody["metadata"] as Record<string, unknown>)
				: {};
		const auditMetadata = {
			internal_call: true,
			internal_call_type: "builtin_capability",
			builtin_capability: call.capability,
			builtin_capability_stage: call.stage,
			parent_request_id: parentRequestId,
			tool_call_id: call.toolCallId,
			...(call.executor === undefined ? {} : { builtin_capability_executor: call.executor }),
			...(call.credentialName === undefined ? {} : { builtin_capability_credential: call.credentialName }),
		};
		// 内置能力的每一次内部调用都是本地发起的非流式子请求（Handler 直连工具连模型调用都没有），
		// 观测不到「首个 token 写回下游」的时刻，只有请求时长（endTime - startTime）。
		// 凭空把 endTime 当首字会让 Logs 页把整段耗时读成 TTFT，与详情页（endTime 即无 TTFT）自相矛盾；
		// 这里显式写 NULL，列表与详情都显示 `-`。
		const log = await buildSpendLogFromRequest({
			req: req,
			auth: auth,
			requestId: requestId,
			callType: mapCallType(call.callType),
			model: call.model,
			modelGroup: call.model,
			modelId: spendInfo?.modelId,
			customLlmProvider: spendInfo?.customLlmProvider,
			apiBase: spendInfo?.apiBase,
			customCostPerToken: spendInfo?.customCostPerToken,
			deploymentModel: spendInfo?.deploymentModel,
			startTime: call.startTime,
			endTime: call.endTime,
			completionStartTime: null,
			messages: call.messages,
			proxyServerRequestUrl: `/internal/builtin-capabilities/${call.capability}`,
			proxyServerRequestBody: {
				...call.requestBody,
				model: call.model,
				messages: call.messages,
				metadata: {
					...requestMetadata,
					...auditMetadata,
				},
			},
			response: call.response,
			usage: call.response?.["usage"] as Record<string, unknown> | undefined,
			error: call.error,
			// 只用该次内部调用自己的上游交换：显式捕获值，或它自己结果对象上的挂载值；
			// 绝不借用外层请求通道，否则审计行会写成主请求的上游。
			upstreamLogContext: call.upstreamLogContext ?? getAttachedUpstreamLogContext(call.response) ?? getAttachedUpstreamLogContext(call.error),
			// 内部调用只记录自己的上游交换，禁止借用外层请求的通道记录。
			disableAmbientUpstreamContext: true,
			status: status,
			requestTags: ["litellm:internal", `builtin:${call.capability}`],
			...(call.fixedCostUsd === undefined ? {} : { fixedCostUsd: call.fixedCostUsd }),
			metadataOverrides: { ...auditMetadata, cache_namespace: `builtin:${call.capability}` },
		});
		await queueSpendLog(db, log);
		return { requestId: requestId };
	};
}

/** Backwards-compatible vision-specific factory. */
export const createVisionCapabilityAuditHook = createBuiltinCapabilityAuditHook;

/** Web capability audit factory. */
export const createWebCapabilityAuditHook = createBuiltinCapabilityAuditHook;

/** Image generation capability audit factory. */
export const createImageGenerationCapabilityAuditHook = createBuiltinCapabilityAuditHook;
