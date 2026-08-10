import { ApiError } from "../core/api/ApiError";
import type { Router } from "../router/Router";
import type { Message } from "../types/openai";
import type { BuiltinCapabilityAuditHook } from "./BuiltinCapabilityAudit";
import {
	prepareAnthropicVisionRequest,
	resolveVisionCapability,
	runAnthropicVisionAgentLoop,
	runOpenAIVisionAgentLoop,
	type PreparedVisionRequest,
} from "./VisionCapability";
import type { VisionImageStore } from "./VisionImageStore";
import {
	resolveImageGenerationCapability,
	runAnthropicImageGenerationAgentLoop,
	runOpenAIImageGenerationAgentLoop,
	type PreparedImageGenerationRequest,
} from "./ImageGenerationCapability";
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
		imageGenerationAudit?: BuiltinCapabilityAuditHook;
		webAudit?: BuiltinCapabilityAuditHook;
		visionImageStore: VisionImageStore;
		preparedWeb?: PreparedWebRequest<Record<string, unknown>>;
		preparedVision?: PreparedVisionRequest<Record<string, unknown>>;
		preparedImageGeneration?: PreparedImageGenerationRequest<Record<string, unknown>>;
	},
): Promise<Record<string, unknown>> {
	const preparedWeb = options.preparedWeb ?? (await prepareOpenAIWebRequest(router, model, messages));
	const visionBinding = await resolveVisionCapability(router, model);
	const imageGenerationBinding = await resolveImageGenerationCapability(router, model);
	const combinedMaxTurns =
		(preparedWeb?.binding.maxIterations ?? 0) +
		(visionBinding?.maxIterations ?? 0) +
		(imageGenerationBinding?.maxIterations ?? 0);
	const guardMainModelTurn =
		[preparedWeb, visionBinding, imageGenerationBinding].filter(Boolean).length > 1
			? createMainModelTurnGuard(combinedMaxTurns)
			: undefined;
	const completeMainModel: Completion = async (completionModel, completionMessages, params) => {
		guardMainModelTurn?.();
		return complete(completionModel, completionMessages, params);
	};
	const completeWithImageGeneration: Completion = (completionModel, completionMessages, params) =>
		runOpenAIImageGenerationAgentLoop(
			router,
			completionModel,
			completionMessages as unknown as Array<Record<string, unknown>>,
			params,
			completeMainModel,
			{
				audit: options.imageGenerationAudit,
				imageStore: options.visionImageStore,
				preparedRequest: options.preparedImageGeneration,
			},
		);
	const completeWithVision: Completion = (completionModel, completionMessages, params) =>
		runOpenAIVisionAgentLoop(
			router,
			completionModel,
			completionMessages as unknown as Array<Record<string, unknown>>,
			params,
			completeWithImageGeneration,
			{
				audit: options.visionAudit,
				imageStore: options.visionImageStore,
				preparedRequest: options.preparedVision,
				workerComplete: complete,
			},
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
		imageGenerationAudit?: BuiltinCapabilityAuditHook;
		webAudit?: BuiltinCapabilityAuditHook;
		visionImageStore: VisionImageStore;
		preparedWeb?: PreparedWebRequest<Record<string, unknown>> & { body: Record<string, unknown> };
		workerComplete?: Completion;
	},
): Promise<{ response: Record<string, unknown>; body: Record<string, unknown> }> {
	const preparedWeb = options.preparedWeb ?? (await prepareAnthropicWebRequest(router, model, body));
	const visionBinding = await resolveVisionCapability(router, model);
	const imageGenerationBinding = await resolveImageGenerationCapability(router, model);
	const combinedMaxTurns =
		(preparedWeb?.binding.maxIterations ?? 0) +
		(visionBinding?.maxIterations ?? 0) +
		(imageGenerationBinding?.maxIterations ?? 0);
	const guardMainModelTurn =
		[preparedWeb, visionBinding, imageGenerationBinding].filter(Boolean).length > 1
			? createMainModelTurnGuard(combinedMaxTurns)
			: undefined;
	const completeMainModel = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
		guardMainModelTurn?.();
		return complete(requestBody);
	};
	const completeWithImageGeneration = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const result = await runAnthropicImageGenerationAgentLoop(router, model, requestBody, completeMainModel, {
			audit: options.imageGenerationAudit,
			imageStore: options.visionImageStore,
		});
		return result.response;
	};
	const completeWithVision = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const preparedVision = await prepareAnthropicVisionRequest(router, model, requestBody, options.visionImageStore);
		if (!preparedVision) {
			return completeWithImageGeneration(requestBody);
		}
		const result = await runAnthropicVisionAgentLoop(router, preparedVision, completeWithImageGeneration, options.visionAudit);
		return result.response;
	};
	if (!preparedWeb) {
		const response = await completeWithVision(body);
		return { response: response, body: body };
	}
	const result = await runAnthropicWebAgentLoop(router, preparedWeb, completeWithVision, options.webAudit, options.workerComplete);
	return { response: result.response, body: body };
}
