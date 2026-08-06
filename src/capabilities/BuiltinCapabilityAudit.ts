import { createHash } from "node:crypto";
import type { Request } from "express";
import type { DrizzleDb } from "../core/db/Database";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { buildSpendLogFromRequest, trackSpendLog } from "../spend/SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";

/** Reference to the ordinary Spend Log row created for an internal call. */
export interface BuiltinCapabilityAuditReference {
	/** Child Spend Log request ID. */
	readonly requestId: string;
}

/** One ordinary model request made by a private built-in capability. */
export interface BuiltinCapabilityModelCall {
	/** Built-in capability identifier. */
	readonly capability: "vision" | "web";
	/** Worker request or main-model continuation. */
	readonly stage: "handler" | "continuation";
	/** Spend Log protocol classification. */
	readonly callType: "acompletion" | "amessages";
	/** Logical model used by this request. */
	readonly model: string;
	/** Private tool call that triggered the request. */
	readonly toolCallId: string;
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
	/** Delegated image references. */
	readonly imageRefs?: string[];
	/** Delegated visual question. */
	readonly question?: string;
	/** Requested visual detail. */
	readonly detail?: string;
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
		};
		const log = await buildSpendLogFromRequest({
			req: req,
			auth: auth,
			requestId: requestId,
			callType: call.callType === "amessages" ? CallType.AMessages : CallType.ACompletion,
			model: call.model,
			modelGroup: call.model,
			modelId: spendInfo?.modelId,
			customLlmProvider: spendInfo?.customLlmProvider,
			apiBase: spendInfo?.apiBase,
			customCostPerToken: spendInfo?.customCostPerToken,
			deploymentModel: spendInfo?.deploymentModel,
			startTime: call.startTime,
			endTime: call.endTime,
			completionStartTime: call.endTime,
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
			status: status,
			requestTags: ["litellm:internal", `builtin:${call.capability}`],
			metadataOverrides: {
				internal_call: true,
				internal_call_type: "builtin_capability",
				builtin_capability: call.capability,
				builtin_capability_stage: call.stage,
				parent_request_id: parentRequestId,
				tool_call_id: call.toolCallId,
				cache_namespace: `builtin:${call.capability}`,
			},
		});
		await trackSpendLog(db, log);
		return { requestId: requestId };
	};
}

/** Backwards-compatible vision-specific factory. */
export const createVisionCapabilityAuditHook = createBuiltinCapabilityAuditHook;

/** Web capability audit factory. */
export const createWebCapabilityAuditHook = createBuiltinCapabilityAuditHook;
