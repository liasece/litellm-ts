import { ImageGenerationTargets } from "./ImageGenerationTargets";
import type { ImageCompletionHistory } from "./ImageCompletionHistory";
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
	MAX_CLIENT_WEB_TURNS,
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
		/** Authenticated upstream history and image operation bookkeeping. */
		imageHistory?: ImageCompletionHistory;
		webAudit?: BuiltinCapabilityAuditHook;
		visionImageStore: VisionImageStore;
		preparedWeb?: PreparedWebRequest<Record<string, unknown>>;
		preparedVision?: PreparedVisionRequest<Record<string, unknown>>;
		preparedImageGeneration?: PreparedImageGenerationRequest<Record<string, unknown>>;
		/** 工具 worker 调用：始终非流式，输出不进入下游流。 */
		workerComplete?: Completion;
	},
): Promise<Record<string, unknown>> {
	const preparedWeb =
		options.preparedWeb ??
		(await prepareOpenAIWebRequest(
			router,
			model,
			messages,
			Array.isArray(optionalParams["tools"]) ? (optionalParams["tools"] as unknown[]) : [],
		));
	const visionBinding = await resolveVisionCapability(router, model);
	const imageGenerationBinding = await resolveImageGenerationCapability(router, model);
	// 客户端自带网络工具时，那些轮次不占私有 max_iterations；组合护栏也要把这段预算让出来，
	// 否则多能力叠加时会在客户端工具的收尾轮之前抛出 503。
	const clientWebTurns = (preparedWeb?.clientTools ?? []).length > 0 ? MAX_CLIENT_WEB_TURNS : 0;
	const combinedMaxTurns =
		(preparedWeb?.binding.maxIterations ?? 0) +
		(visionBinding?.maxIterations ?? 0) +
		(imageGenerationBinding?.maxIterations ?? 0) +
		clientWebTurns;
	const guardMainModelTurn =
		[preparedWeb, visionBinding, imageGenerationBinding].filter(Boolean).length > 1
			? createMainModelTurnGuard(combinedMaxTurns)
			: undefined;
	const completeMainModel: Completion = async (completionModel, completionMessages, params) => {
		guardMainModelTurn?.();
		return complete(completionModel, completionMessages, params);
	};
	const imageTargets = new ImageGenerationTargets(options.imageHistory?.continuingAssets);
	const completeWithImageGeneration: Completion = (completionModel, completionMessages, params) =>
		runOpenAIImageGenerationAgentLoop(
			router,
			completionModel,
			completionMessages as unknown as Array<Record<string, unknown>>,
			params,
			completeMainModel,
			{
				audit: options.imageGenerationAudit,
				imageHistory: options.imageHistory,
				targets: imageTargets,
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
				workerComplete: options.workerComplete ?? complete,
			},
		);
	return runOpenAIWebAgentLoop(router, model, messages, optionalParams, completeWithVision, {
		audit: options.webAudit,
		preparedRequest: preparedWeb,
		workerComplete: options.workerComplete ?? complete,
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
		/** Authenticated upstream history and image operation bookkeeping. */
		imageHistory?: ImageCompletionHistory;
		webAudit?: BuiltinCapabilityAuditHook;
		visionImageStore: VisionImageStore;
		preparedWeb?: PreparedWebRequest<Record<string, unknown>> & { body: Record<string, unknown> };
		workerComplete?: Completion;
	},
): Promise<{ response: Record<string, unknown>; body: Record<string, unknown> }> {
	const preparedWeb = options.preparedWeb ?? (await prepareAnthropicWebRequest(router, model, body));
	const visionBinding = await resolveVisionCapability(router, model);
	const imageGenerationBinding = await resolveImageGenerationCapability(router, model);
	// 客户端自带网络工具时，那些轮次不占私有 max_iterations；组合护栏也要把这段预算让出来，
	// 否则多能力叠加时会在客户端工具的收尾轮之前抛出 503。
	const clientWebTurns = (preparedWeb?.clientTools ?? []).length > 0 ? MAX_CLIENT_WEB_TURNS : 0;
	const combinedMaxTurns =
		(preparedWeb?.binding.maxIterations ?? 0) +
		(visionBinding?.maxIterations ?? 0) +
		(imageGenerationBinding?.maxIterations ?? 0) +
		clientWebTurns;
	const guardMainModelTurn =
		[preparedWeb, visionBinding, imageGenerationBinding].filter(Boolean).length > 1
			? createMainModelTurnGuard(combinedMaxTurns)
			: undefined;
	const completeMainModel = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
		guardMainModelTurn?.();
		return complete(requestBody);
	};
	const imageTargets = new ImageGenerationTargets(options.imageHistory?.continuingAssets);
	const completeWithImageGeneration = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
		const result = await runAnthropicImageGenerationAgentLoop(router, model, requestBody, completeMainModel, {
			audit: options.imageGenerationAudit,
			imageHistory: options.imageHistory,
			targets: imageTargets,
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
