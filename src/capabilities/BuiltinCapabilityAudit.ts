import { createHash } from "node:crypto";
import type { Request } from "express";
import type { DrizzleDb } from "../core/db/Database";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { buildSpendLogFromRequest } from "../spend/SpendTracker";
import { queueSpendLog } from "../spend/SpendSettlementQueue";
import { getAttachedUpstreamLogContext, UPSTREAM_STREAM_RESPONSE_KEY, type UpstreamLogContext } from "../router/UpstreamLogContext";
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 从实际请求体里取下游能看到的消息列表：chat 用 `messages`，Responses 用 `input`。
 * 审计行的 `messages` 列与 `proxy_server_request.body` 必须描述同一次真实请求。
 * @param body - 实际发往 provider 的请求体
 */
function messagesFromRequestBody(body: unknown): unknown | undefined {
	const record = asRecord(body);
	if (record === undefined) {
		return undefined;
	}
	if (Array.isArray(record["messages"])) {
		return record["messages"];
	}
	if (Array.isArray(record["input"])) {
		return record["input"];
	}
	return undefined;
}

interface AuditedExchange {
	/** 写进 proxy_server_request.body 的请求体。 */
	readonly requestBody: unknown;
	/** 写进 messages 列的请求消息/输入项。 */
	readonly messages: unknown;
	/** 写进 response 列的上游响应体。 */
	readonly response: unknown;
}

/**
 * 取回流式终态响应并补进这次调用的上游交换。
 *
 * 流式主轮先把原生响应映射成 chat 再交给能力循环，映射结果上的临时键是审计行
 * 唯一能拿到真实上游响应的地方；读完立刻删除，避免它进入父请求的响应与日志。
 * @param context - 该次调用的上游交换（可能没有响应体）
 * @param response - 能力层拿到的调用结果
 */
function consumeStreamedUpstreamResponse(
	context: UpstreamLogContext | undefined,
	response: unknown,
): UpstreamLogContext | undefined {
	const record = asRecord(response);
	if (record === undefined || !(UPSTREAM_STREAM_RESPONSE_KEY in record)) {
		return context;
	}
	const body = record[UPSTREAM_STREAM_RESPONSE_KEY];
	delete record[UPSTREAM_STREAM_RESPONSE_KEY];
	if (context?.response === undefined || body === undefined) {
		return context;
	}
	return { ...context, response: { ...context.response, body: body } };
}

/**
 * 内部调用的审计行保存该次调用真实的上游交换：请求体是实际发往 provider 的 body，
 * 响应体是 provider 实际返回的 body。只有拿不到上游交换时才退回能力层构造的调用形状，
 * 这样直连执行者、测试桩和旧调用仍能落一行完整的审计记录。
 *
 * 注意：审计标记（internal_call / parent_request_id 等）只写 SpendLogs.metadata；
 * 不要注入真实请求体，否则日志里的请求就不再是线上发出的那个请求。
 * @param call - 一次内部能力调用
 * @param fallbackRequestBody - 拿不到上游请求体时使用的调用层请求体
 * @param upstreamLogContext - 该次调用自己的上游交换
 */
function resolveAuditedExchange(
	call: BuiltinCapabilityModelCall,
	fallbackRequestBody: Record<string, unknown>,
	upstreamLogContext: UpstreamLogContext | undefined,
): AuditedExchange {
	const upstreamRequestBody = asRecord(upstreamLogContext?.request.body);
	const upstreamResponseBody = upstreamLogContext?.response?.body;
	const requestBody = upstreamRequestBody ?? fallbackRequestBody;
	return {
		requestBody: requestBody,
		messages: messagesFromRequestBody(requestBody) ?? call.messages,
		// 失败调用可能也收到 4xx 响应体，但那一行由 error 与 upstream_response 说明；
		// response 列保持成功响应语义，避免详情页把错误当成功结果渲染。
		response: call.error === undefined && upstreamResponseBody !== undefined ? upstreamResponseBody : call.response,
	};
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
		const upstreamLogContext = consumeStreamedUpstreamResponse(
			call.upstreamLogContext ?? getAttachedUpstreamLogContext(call.response) ?? getAttachedUpstreamLogContext(call.error),
			call.response,
		);
		const audited = resolveAuditedExchange(
			call,
			{
				...call.requestBody,
				model: call.model,
				messages: call.messages,
				metadata: {
					...requestMetadata,
					...auditMetadata,
				},
			},
			upstreamLogContext,
		);
		// 审计行描述的是网关自己发起的内部调用：worker 不向外写流，continuation 的首字
		// 属于主请求而不是这一行，单独测不到该行自己的「首个 token 写回下游」时刻。
		// 凭空把 endTime 当首字会让 Logs 页把整段耗时读成 TTFT；这里显式写 NULL。
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
			messages: audited.messages,
			proxyServerRequestUrl: `/internal/builtin-capabilities/${call.capability}`,
			proxyServerRequestBody: audited.requestBody,
			response: audited.response,
			usage: call.response?.["usage"] as Record<string, unknown> | undefined,
			error: call.error,
			// 只用该次内部调用自己的上游交换：显式捕获值，或它自己结果对象上的挂载值；
			// 绝不借用外层请求通道，否则审计行会写成主请求的上游。
			upstreamLogContext: upstreamLogContext,
			// 内部调用只记录自己的上游交换，禁止借用外层请求的通道记录。
			disableAmbientUpstreamContext: true,
			// 审计行描述的是网关自己发起的旁路调用，不是用户的请求：Feature 列只标记
			// 用户请求被哪些能力处理过，因此这里显式写入空集合，绝不读外层主请求的账本。
			appliedFeatures: [],
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
