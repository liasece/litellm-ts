import { createHash } from "node:crypto";
import type { Request } from "express";
import type { DrizzleDb } from "../core/db/Database";
import type { DeploymentSpendInfo } from "../router/RouterSpendInfo";
import { buildSpendLogFromRequest, trackSpendLog } from "../spend/SpendTracker";
import { CallType, SpendLogStatus } from "../types/spend";
import type {
	VisionCapabilityAuditHook,
	VisionCapabilityModelCall,
} from "./VisionCapability";

interface VisionCapabilityAuditorOptions {
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
export function createVisionCapabilityAuditHook(
	options: VisionCapabilityAuditorOptions,
): VisionCapabilityAuditHook | undefined {
	const { db, req, parentRequestId } = options;
	const auth = req.auth;
	if (!db || !auth || !parentRequestId) {
		return undefined;
	}
	let sequence = 0;
	return async (call: VisionCapabilityModelCall) => {
		sequence += 1;
		const requestId = createHash("sha256")
			.update(parentRequestId)
			.update("\0builtin-capability\0vision\0")
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
			proxyServerRequestUrl: "/internal/builtin-capabilities/vision",
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
