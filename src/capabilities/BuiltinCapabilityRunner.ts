import { ApiError } from "../core/api/ApiError";
import type { Router } from "../router/Router";
import type { Message } from "../types/openai";
import type { BuiltinCapabilityAuditHook } from "./BuiltinCapabilityAudit";
import {
	prepareAnthropicVisionRequest,
	resolveVisionCapability,
	runAnthropicVisionAgentLoop,
	runOpenAIVisionAgentLoop,
} from "./VisionCapability";
import type { VisionImageStore } from "./VisionImageStore";
import {
	prepareAnthropicWebRequest,
	prepareOpenAIWebRequest,
	runAnthropicWebAgentLoop,
	runOpenAIWebAgentLoop,
	type PreparedWebRequest,
} from "./WebCapability";

type Completion = (model: string, messages: Message[], optionalParams: Record<string, unknown>) => Promise<Record<string, unknown>>;

function createMainModelTurnGuard(maxTurns: number): () => void {
	let consumedTurns = 0;
	return () => {
		if (consumedTurns >= maxTurns) {
			throw ApiError.unavailable(`组合内置能力处理超过 ${maxTurns} 个主模型轮次仍未完成`);
		}
		consumedTurns++;
	};
}

/**
 * Composes web outside vision and applies one shared main-model turn budget
 * when both private capability families are active.
 * @param router
 * @param model
 * @param messages
 * @param optionalParams
 * @param complete
 * @param options
 */
export async function runOpenAIBuiltinCapabilityAgentLoop(
	router: Router,
	model: string,
	messages: Array<Record<string, unknown>>,
	optionalParams: Record<string, unknown>,
	complete: Completion = (completionModel, completionMessages, params) => router.completion(completionModel, completionMessages, params),
	options: {
		visionAudit?: BuiltinCapabilityAuditHook;
		webAudit?: BuiltinCapabilityAuditHook;
		visionImageStore: VisionImageStore;
		preparedWeb?: PreparedWebRequest<Record<string, unknown>>;
	},
): Promise<Record<string, unknown>> {
	const preparedWeb = options.preparedWeb ?? (await prepareOpenAIWebRequest(router, model, messages));
	const visionBinding = await resolveVisionCapability(router, model);
	const guardMainModelTurn =
		preparedWeb && visionBinding
			? createMainModelTurnGuard(preparedWeb.binding.maxIterations + visionBinding.maxIterations)
			: undefined;
	const completeMainModel: Completion = async (completionModel, completionMessages, params) => {
		guardMainModelTurn?.();
		return complete(completionModel, completionMessages, params);
	};
	const completeWithVision: Completion = (completionModel, completionMessages, params) =>
		runOpenAIVisionAgentLoop(
			router,
			completionModel,
			completionMessages as unknown as Array<Record<string, unknown>>,
			params,
			completeMainModel,
			{ audit: options.visionAudit, imageStore: options.visionImageStore, workerComplete: complete },
		);
	return runOpenAIWebAgentLoop(router, model, messages, optionalParams, completeWithVision, {
		audit: options.webAudit,
		preparedRequest: preparedWeb,
		workerComplete: complete,
	});
}

/**
 * Composes the same capability stack for native Anthropic Messages. The
 * returned body is always the caller's clean request, never the hidden
 * instruction/tool transcript used inside the loop.
 * @param router
 * @param model
 * @param body
 * @param complete
 * @param options
 */
export async function runAnthropicBuiltinCapabilityAgentLoop(
	router: Router,
	model: string,
	body: Record<string, unknown>,
	complete: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
	options: {
		visionAudit?: BuiltinCapabilityAuditHook;
		webAudit?: BuiltinCapabilityAuditHook;
		visionImageStore: VisionImageStore;
		preparedWeb?: PreparedWebRequest<Record<string, unknown>> & { body: Record<string, unknown> };
		workerComplete?: Completion;
	},
): Promise<{ response: Record<string, unknown>; body: Record<string, unknown> }> {
	const preparedWeb = options.preparedWeb ?? (await prepareAnthropicWebRequest(router, model, body));
	const visionBinding = await resolveVisionCapability(router, model);
	const guardMainModelTurn =
		preparedWeb && visionBinding
			? createMainModelTurnGuard(preparedWeb.binding.maxIterations + visionBinding.maxIterations)
			: undefined;
	const completeMainModel = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
		guardMainModelTurn?.();
		return complete(requestBody);
	};
	const completeWithVision = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const preparedVision = await prepareAnthropicVisionRequest(router, model, requestBody, options.visionImageStore);
		if (!preparedVision) {
			return completeMainModel(requestBody);
		}
		const result = await runAnthropicVisionAgentLoop(router, preparedVision, completeMainModel, options.visionAudit);
		return result.response;
	};
	if (!preparedWeb) {
		const response = await completeWithVision(body);
		return { response: response, body: body };
	}
	const result = await runAnthropicWebAgentLoop(router, preparedWeb, completeWithVision, options.webAudit, options.workerComplete);
	return { response: result.response, body: body };
}
