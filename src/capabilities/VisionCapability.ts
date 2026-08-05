import { ApiError } from "../core/api/ApiError";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { Router } from "../router/Router";
import type { Message, ToolCall, Usage } from "../types/openai";
import { BUILTIN_CAPABILITIES_CONFIG_PARAM, normalizeBuiltinCapabilitiesConfig } from "./BuiltinCapabilitiesConfig";
import {
	createVisionImageStore,
	storeVisionImageUrl,
	type StoredVisionImage,
	type VisionImageStore,
} from "./VisionImageStore";

export const PRIVATE_VISION_TOOL_NAME = "litellm__vision_inspect";

/**
 * Configuration resolved for the private vision worker.
 */
export interface VisionCapabilityBinding {
	/** Whether the private tool is injected before any image enters the transcript. */
	alwaysInject: boolean;
	/**
	 *
	 */
	handlerModel: string;
	/**
	 * 独立于主模型路由的能力 fallback 顺序。
	 */
	fallbackModels: string[];
	/**
	 *
	 */
	maxIterations: number;
	/**
	 *
	 */
	maxOutputTokens: number;
}

/**
 * Request-local image retained outside the text-only model transcript.
 */
export interface VisionImage {
	/**
	 *
	 */
	ref: string;
	/**
	 *
	 */
	chatPart: Record<string, unknown>;
}

/**
 * Request-local private image registry and rewritten transcript.
 * @template TMessage
 */
export interface PreparedVisionRequest<TMessage> {
	/**
	 *
	 */
	messages: TMessage[];
	/**
	 *
	 */
	images: Map<string, VisionImage>;
	/** Content-addressed backing store used to resolve image hashes. */
	imageStore: VisionImageStore;
	/**
	 *
	 */
	binding: VisionCapabilityBinding;
}

type Completion = (model: string, messages: Message[], optionalParams: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** One ordinary model request made by the private capability executor. */
export interface VisionCapabilityModelCall {
	/** Built-in capability identifier. */
	readonly capability: "vision";
	/** Which model request in the private capability flow is being recorded. */
	readonly stage: "handler" | "continuation";
	/** Spend Log protocol classification for this model request. */
	readonly callType: "acompletion" | "amessages";
	/** Model group requested for this attempt. */
	readonly model: string;
	/** Private tool call that triggered the model request. */
	readonly toolCallId: string;
	/** Delegated image references. */
	readonly imageRefs?: string[];
	/** Model-authored inspection question. */
	readonly question?: string;
	/** Requested inspection detail. */
	readonly detail?: string;
	/** Actual messages sent to the capability model. */
	readonly messages: Message[];
	/** Actual request body, when the protocol carries fields beyond messages. */
	readonly requestBody?: Record<string, unknown>;
	/** Attempt start time. */
	readonly startTime: Date;
	/** Attempt completion time. */
	readonly endTime: Date;
	/** Successful model response, when available. */
	readonly response?: Record<string, unknown>;
	/** Provider or routing failure, when the attempt failed. */
	readonly error?: unknown;
}

/** Result returned by the endpoint-owned ordinary Spend Log recorder. */
export interface VisionCapabilityAuditReference {
	/** Child Spend Log request ID. */
	readonly requestId: string;
}

/** Records capability model calls using the authenticated parent request. */
export type VisionCapabilityAuditHook = (call: VisionCapabilityModelCall) => Promise<VisionCapabilityAuditReference>;

interface VisionExecutionAttempt {
	readonly request_id: string;
	readonly model: string;
	readonly status: "success" | "failure";
	readonly start_time: string;
	readonly end_time: string;
	readonly error?: string;
}

function getResolvedModel(router: Router, model: string): string {
	const resolver = router.resolveModelGroupWithTrace;
	if (typeof resolver !== "function") {
		return model;
	}
	return resolver.call(router, model).resolvedModel;
}

/**
 * Check whether a logical model or alias resolves to at least one vision-capable deployment.
 * @param router
 * @param model
 */
export function isVisionCapableHandler(router: Router, model: string): boolean {
	const resolvedModel = getResolvedModel(router, model);
	return router
		.getDeployments()
		.some(
			(deployment) =>
				(deployment.model_name === resolvedModel || deployment.model_info?.model_name === resolvedModel) &&
				deployment.model_info?.supports_vision === true,
		);
}

/**
 * Resolve the private vision worker configured on a logical model.
 * @param router
 * @param model
 * @throws {ApiError} When an enabled binding has no handler model.
 */
export async function resolveVisionCapability(router: Router, model: string): Promise<VisionCapabilityBinding | undefined> {
	if (typeof router.getDeployments !== "function") {
		return undefined;
	}
	const resolvedModel = getResolvedModel(router, model);
	const modelDeployments = router
		.getDeployments()
		.filter(
			(candidate) =>
				candidate.model_name === resolvedModel ||
				candidate.model_info?.model_name === resolvedModel ||
				candidate.model_name === model,
		);
	if (
		!modelDeployments.some(
			(deployment) =>
				deployment.model_info?.enabled_builtin_capabilities?.includes("vision") &&
				deployment.model_info?.supports_function_calling !== false,
		)
	) {
		return undefined;
	}
	const definitions = normalizeBuiltinCapabilitiesConfig(await dbConfigProvider.getParam(BUILTIN_CAPABILITIES_CONFIG_PARAM));
	const raw = definitions.vision;
	if (!raw.enabled) {
		return undefined;
	}
	if (typeof raw.handler_model !== "string" || raw.handler_model.trim().length === 0) {
		throw ApiError.unavailable(`模型 ${model} 的 vision capability 缺少 handler_model`);
	}
	if (!isVisionCapableHandler(router, raw.handler_model)) {
		throw ApiError.unavailable(`vision capability 执行模型不支持图片: ${raw.handler_model}`);
	}
	return {
		alwaysInject: raw.always_inject,
		handlerModel: raw.handler_model,
		fallbackModels: raw.fallback_models.filter((candidate) => isVisionCapableHandler(router, candidate)),
		maxIterations: clampInteger(raw.max_iterations, 1, 8, 4),
		maxOutputTokens: clampInteger(raw.max_output_tokens, 128, 16_384, 2_048),
	};
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function visionInstruction(refs: string[]): string {
	const introduction =
		refs.length > 0
			? "LiteLLM replaced image bytes with private image references because this model is text-only."
			: "LiteLLM provides a private vision tool for images that may appear in later requests because this model is text-only.";
	const imageReferenceInstruction =
		refs.length > 0
			? `Available image references: ${refs.join(", ")}.`
			: "No private image references are currently available. Do not call the private vision tool until a later request contains image bytes; if the user gives a filesystem path, use a client-provided file tool first.";
	return [
		introduction,
		imageReferenceInstruction,
		`Call ${PRIVATE_VISION_TOOL_NAME} whenever the answer depends on visual evidence.`,
		"The call is private: formulate a precise question that reflects the user's current request and the exact visual details you need.",
		"When calling this private tool, call it alone in that assistant turn. After receiving its result, decide whether to call any client-provided tools.",
		"You may call it again with a different focus. Do not claim to have inspected an image without using the tool.",
		"If the request does not depend on image pixels, answer normally. Never mention this private tool or the replacement process.",
	].join(" ");
}

function privateOpenAITool(): Record<string, unknown> {
	return {
		type: "function",
		function: {
			name: PRIVATE_VISION_TOOL_NAME,
			description:
				"Privately inspect one or more image references. Choose the question and visual focus required to answer the user accurately.",
			parameters: {
				type: "object",
				additionalProperties: false,
				properties: {
					image_refs: {
						type: "array",
						items: { type: "string" },
						minItems: 1,
						description: "SHA-256 image references copied exactly from the available image references.",
					},
					question: {
						type: "string",
						description: "A precise, context-aware question for the vision model.",
					},
					detail: {
						type: "string",
						enum: ["auto", "low", "high"],
						description: "Requested inspection detail.",
					},
				},
				required: ["image_refs", "question"],
			},
		},
	};
}

function assertPrivateToolNameAvailable(tools: unknown[], protocol: "openai" | "anthropic"): void {
	const collides = tools.some((tool) => {
		if (typeof tool !== "object" || tool === null) {
			return false;
		}
		const record = tool as Record<string, unknown>;
		if (protocol === "anthropic") {
			return record["name"] === PRIVATE_VISION_TOOL_NAME;
		}
		const fn = record["function"];
		return (
			record["type"] === "function" &&
			typeof fn === "object" &&
			fn !== null &&
			(fn as Record<string, unknown>)["name"] === PRIVATE_VISION_TOOL_NAME
		);
	});
	if (collides) {
		throw ApiError.badRequest(`工具名 ${PRIVATE_VISION_TOOL_NAME} 为 LiteLLM 内部保留名称`);
	}
}

/**
 *
 */
export function privateAnthropicVisionTool(): Record<string, unknown> {
	const openAI = privateOpenAITool();
	const fn = openAI["function"] as Record<string, unknown>;
	return {
		name: fn["name"],
		description: fn["description"],
		input_schema: fn["parameters"],
	};
}

function normalizeChatImagePart(part: Record<string, unknown>): Record<string, unknown> | undefined {
	if (part["type"] !== "image_url") {
		return undefined;
	}
	const imageUrl = part["image_url"];
	if (typeof imageUrl === "string") {
		return { type: "image_url", image_url: { url: imageUrl } };
	}
	if (typeof imageUrl === "object" && imageUrl !== null) {
		const imageUrlRecord = imageUrl as Record<string, unknown>;
		if (typeof imageUrlRecord["url"] !== "string") {
			return undefined;
		}
		return { type: "image_url", image_url: { ...imageUrlRecord } };
	}
	return undefined;
}

/**
 * Remove image bytes/URLs from the main-model transcript, retain them in a
 * request-local registry, and give the model stable private references.
 * @param router
 * @param model
 * @param messages
 * @param imageStore
 */
export async function prepareOpenAIVisionRequest(
	router: Router,
	model: string,
	messages: Array<Record<string, unknown>>,
	imageStore: VisionImageStore = createVisionImageStore(),
): Promise<PreparedVisionRequest<Record<string, unknown>> | undefined> {
	const binding = await resolveVisionCapability(router, model);
	if (!binding) {
		return undefined;
	}
	const images = new Map<string, VisionImage>();
	const rewritten: Array<Record<string, unknown>> = [];
	for (const message of messages) {
		const content = message["content"];
		if (!Array.isArray(content)) {
			rewritten.push({ ...message });
			continue;
		}
		const parts: unknown[] = [];
		for (const rawPart of content) {
			if (typeof rawPart !== "object" || rawPart === null) {
				parts.push(rawPart);
				continue;
			}
			const part = rawPart as Record<string, unknown>;
			const normalized = normalizeChatImagePart(part);
			if (!normalized) {
				parts.push({ ...part });
				continue;
			}
			const imageUrl = normalized["image_url"] as Record<string, unknown>;
			const stored = await storeVisionImageUrl(imageStore, String(imageUrl["url"]));
			const image = storedVisionImageToVisionImage(stored);
			images.set(image.ref, image);
			parts.push({ type: "text", text: `[Private image reference: ${image.ref}]` });
		}
		rewritten.push({ ...message, content: parts });
	}
	if (images.size === 0 && !binding.alwaysInject) {
		return undefined;
	}
	rewritten.unshift({ role: "system", content: visionInstruction([...images.keys()]) });
	return { messages: rewritten, images: images, imageStore: imageStore, binding: binding };
}

function anthropicImageToChatPart(part: Record<string, unknown>): Record<string, unknown> | undefined {
	if (part["type"] !== "image") {
		return undefined;
	}
	const source = part["source"];
	if (typeof source !== "object" || source === null) {
		return undefined;
	}
	const sourceRecord = source as Record<string, unknown>;
	if (sourceRecord["type"] === "base64" && typeof sourceRecord["data"] === "string") {
		const mediaType = typeof sourceRecord["media_type"] === "string" ? sourceRecord["media_type"] : "image/jpeg";
		return { type: "image_url", image_url: { url: `data:${mediaType};base64,${sourceRecord["data"]}` } };
	}
	if (sourceRecord["type"] === "url" && typeof sourceRecord["url"] === "string") {
		return { type: "image_url", image_url: { url: sourceRecord["url"] } };
	}
	return undefined;
}

async function rewriteAnthropicImagePart(
	rawPart: unknown,
	images: Map<string, VisionImage>,
	imageStore: VisionImageStore,
): Promise<unknown> {
	if (typeof rawPart !== "object" || rawPart === null) {
		return rawPart;
	}
	const part = rawPart as Record<string, unknown>;
	const normalized = anthropicImageToChatPart(part);
	if (normalized) {
		const imageUrl = normalized["image_url"] as Record<string, unknown>;
		const stored = await storeVisionImageUrl(imageStore, String(imageUrl["url"]));
		const image = storedVisionImageToVisionImage(stored);
		images.set(image.ref, image);
		return { type: "text", text: `[Private image reference: ${image.ref}]` };
	}
	if (part["type"] === "tool_result" && Array.isArray(part["content"])) {
		return {
			...part,
			content: await Promise.all(
				(part["content"] as unknown[]).map((nestedPart) => rewriteAnthropicImagePart(nestedPart, images, imageStore)),
			),
		};
	}
	return { ...part };
}

/**
 * Anthropic Messages equivalent of prepareOpenAIVisionRequest.
 * @param router
 * @param model
 * @param body
 * @param imageStore
 */
export async function prepareAnthropicVisionRequest(
	router: Router,
	model: string,
	body: Record<string, unknown>,
	imageStore: VisionImageStore = createVisionImageStore(),
): Promise<(PreparedVisionRequest<Record<string, unknown>> & { body: Record<string, unknown> }) | undefined> {
	const binding = await resolveVisionCapability(router, model);
	if (!binding) {
		return undefined;
	}
	const sourceMessages = Array.isArray(body["messages"]) ? (body["messages"] as Array<Record<string, unknown>>) : [];
	const images = new Map<string, VisionImage>();
	const messages: Array<Record<string, unknown>> = [];
	for (const message of sourceMessages) {
		const content = message["content"];
		if (!Array.isArray(content)) {
			messages.push({ ...message });
			continue;
		}
		messages.push({
			...message,
			content: await Promise.all(content.map((rawPart) => rewriteAnthropicImagePart(rawPart, images, imageStore))),
		});
	}
	if (images.size === 0 && !binding.alwaysInject) {
		return undefined;
	}
	const existingSystem = body["system"];
	const instruction = visionInstruction([...images.keys()]);
	const system =
		typeof existingSystem === "string"
			? `${existingSystem}\n\n${instruction}`
			: Array.isArray(existingSystem)
				? [...existingSystem, { type: "text", text: instruction }]
				: instruction;
	const tools = Array.isArray(body["tools"]) ? body["tools"] : [];
	assertPrivateToolNameAvailable(tools, "anthropic");
	return {
		body: { ...body, system: system, messages: messages, tools: [...tools, privateAnthropicVisionTool()] },
		messages: messages,
		images: images,
		imageStore: imageStore,
		binding: binding,
	};
}

function parseVisionArguments(raw: string): { imageRefs: string[]; question: string; detail: string } {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw ApiError.badRequest("图片检查参数不是有效 JSON");
	}
	const record = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
	const imageRefs = Array.isArray(record["image_refs"])
		? record["image_refs"].filter((ref): ref is string => typeof ref === "string")
		: [];
	const question = typeof record["question"] === "string" ? record["question"].trim() : "";
	if (imageRefs.length === 0 || question.length === 0) {
		throw ApiError.badRequest("图片检查参数缺少必要字段");
	}
	return {
		imageRefs: imageRefs,
		question: question,
		detail: record["detail"] === "low" || record["detail"] === "high" ? record["detail"] : "auto",
	};
}

function anthropicVisionInputArguments(input: unknown): string {
	return typeof input === "string" ? input : JSON.stringify(input ?? {});
}

function storedVisionImageToVisionImage(image: StoredVisionImage, detail?: string): VisionImage {
	return {
		ref: image.ref,
		chatPart: {
			type: "image_url",
			image_url: {
				url: `data:${image.mediaType};base64,${image.base64Data}`,
				...(detail === "low" || detail === "high" ? { detail: detail } : {}),
			},
		},
	};
}

async function resolveVisionImage(
	images: Map<string, VisionImage>,
	imageStore: VisionImageStore,
	ref: string,
	detail: string,
): Promise<VisionImage | undefined> {
	const exact = images.get(ref);
	if (exact) {
		const persisted = await imageStore.get(ref);
		return persisted ? storedVisionImageToVisionImage(persisted, detail) : exact;
	}
	const persisted = await imageStore.get(ref);
	if (persisted) {
		return storedVisionImageToVisionImage(persisted, detail);
	}
	// A client tool often returns a path/URL while the image bytes are carried
	// in the same request as one rewritten image part. Preserve that common
	// one-image case without guessing when several images are present.
	if (images.size === 1 && /^(?:[a-z][a-z0-9+.-]*:\/\/|\/|[A-Za-z]:[\\/])/.test(ref.trim())) {
		return images.values().next().value as VisionImage | undefined;
	}
	return undefined;
}

function hasTruncatedAnthropicVisionArguments(response: Record<string, unknown>): boolean {
	if (response["stop_reason"] !== "max_tokens") {
		return false;
	}
	const content = Array.isArray(response["content"]) ? (response["content"] as Array<Record<string, unknown>>) : [];
	return content.some((block) => {
		if (block?.["type"] !== "tool_use" || block["name"] !== PRIVATE_VISION_TOOL_NAME) {
			return false;
		}
		try {
			parseVisionArguments(anthropicVisionInputArguments(block["input"]));
			return false;
		} catch {
			return true;
		}
	});
}

function extractAssistant(result: Record<string, unknown>): Record<string, unknown> {
	const choices = result["choices"];
	const choice = Array.isArray(choices) ? choices[0] : undefined;
	const message = typeof choice === "object" && choice !== null ? (choice as Record<string, unknown>)["message"] : undefined;
	if (typeof message !== "object" || message === null) {
		throw ApiError.unavailable("主模型没有返回可解析的 assistant message");
	}
	return message as Record<string, unknown>;
}

function extractToolCalls(message: Record<string, unknown>): ToolCall[] {
	return Array.isArray(message["tool_calls"]) ? (message["tool_calls"] as ToolCall[]) : [];
}

function textFromCompletion(result: Record<string, unknown>): string {
	const message = extractAssistant(result);
	const content = message["content"];
	if (typeof content === "string" && content.trim().length > 0) {
		return content;
	}
	if (Array.isArray(content)) {
		const text = content
			.map((part) => (typeof part === "object" && part !== null && typeof part["text"] === "string" ? part["text"] : ""))
			.join("");
		if (text.trim()) {
			return text;
		}
	}
	throw ApiError.unavailable("识图模型没有返回文本结果");
}

function addUsage(target: Record<string, unknown>, source: Record<string, unknown>): void {
	const targetUsage = target["usage"] as (Usage & Record<string, number>) | undefined;
	const sourceUsage = source["usage"] as (Usage & Record<string, number>) | undefined;
	if (!targetUsage || !sourceUsage) {
		return;
	}
	const targetUsesAnthropic = typeof targetUsage["input_tokens"] === "number" || typeof targetUsage["output_tokens"] === "number";
	if (targetUsesAnthropic) {
		targetUsage["input_tokens"] = (targetUsage["input_tokens"] ?? 0) + (sourceUsage["input_tokens"] ?? sourceUsage.prompt_tokens ?? 0);
		targetUsage["output_tokens"] =
			(targetUsage["output_tokens"] ?? 0) + (sourceUsage["output_tokens"] ?? sourceUsage.completion_tokens ?? 0);
	} else {
		targetUsage.prompt_tokens += sourceUsage.prompt_tokens ?? sourceUsage["input_tokens"] ?? 0;
		targetUsage.completion_tokens += sourceUsage.completion_tokens ?? sourceUsage["output_tokens"] ?? 0;
		targetUsage.total_tokens +=
			sourceUsage.total_tokens ??
			(sourceUsage.prompt_tokens ?? sourceUsage["input_tokens"] ?? 0) +
				(sourceUsage.completion_tokens ?? sourceUsage["output_tokens"] ?? 0);
	}
	if (typeof sourceUsage.cost === "number") {
		targetUsage.cost = (targetUsage.cost ?? 0) + sourceUsage.cost;
	}
}

/**
 * Execute a model-authored private vision request through the configured worker.
 * @param router
 * @param binding
 * @param images
 * @param rawArguments
 * @param complete
 * @param options
 */
export async function executeVisionToolCall(
	router: Router,
	binding: VisionCapabilityBinding,
	images: Map<string, VisionImage>,
	rawArguments: string,
	complete: Completion = (model, messages, params) => router.completion(model, messages, params),
	options: { audit?: VisionCapabilityAuditHook; toolCallId?: string; imageStore?: VisionImageStore } = {},
): Promise<{ text: string; raw: Record<string, unknown>; model: string; attempts: VisionExecutionAttempt[] }> {
	const args = parseVisionArguments(rawArguments);
	const imageStore = options.imageStore ?? createVisionImageStore();
	const selected = await Promise.all(
		args.imageRefs.map(async (ref) => {
			const image = await resolveVisionImage(images, imageStore, ref, args.detail);
			if (!image) {
				return undefined;
			}
			return image;
		}),
	);
	const missingRefs = args.imageRefs.filter((_, index) => selected[index] === undefined);
	if (missingRefs.length > 0) {
		const text = [
			`No image bytes are available for reference(s): ${missingRefs.join(", ")}.`,
			"This request may refer to a client-side filesystem path or a previous tool result.",
			"Use an available client file/image tool first, then ask for visual inspection again after the image is returned.",
		].join(" ");
		return {
			text: text,
			raw: { error: { type: "image_reference_unavailable", references: missingRefs } },
			model: "unavailable",
			attempts: [],
		};
	}
	const content: Array<Record<string, unknown>> = [
		{
			type: "text",
			text: [
				"You are the visual perception worker for another model.",
				`Inspect the supplied image(s) and answer only this delegated question: ${args.question}`,
				`Requested detail: ${args.detail}.`,
				"Report concrete visual evidence, uncertainty, and image-reference attribution. Do not answer unrelated parts of the end-user request.",
			].join("\n"),
		},
		...(selected as VisionImage[]).map((image) => image.chatPart),
	];
	const capabilityModels = [...new Set([binding.handlerModel, ...binding.fallbackModels])];
	const attempts: VisionExecutionAttempt[] = [];
	const toolCallId = options.toolCallId ?? "vision_call";
	let lastError: unknown;
	for (const capabilityModel of capabilityModels) {
		const startTime = new Date();
		let raw: Record<string, unknown>;
		try {
			raw = await complete(capabilityModel, [{ role: "user", content: content } as unknown as Message], {
				stream: false,
				max_completion_tokens: binding.maxOutputTokens,
			});
		} catch (error) {
			lastError = error;
			const endTime = new Date();
			const auditReference = options.audit
				? await options.audit({
						capability: "vision",
						stage: "handler",
						callType: "acompletion",
						model: capabilityModel,
						toolCallId: toolCallId,
						imageRefs: args.imageRefs,
						question: args.question,
						detail: args.detail,
						messages: [{ role: "user", content: content } as unknown as Message],
						startTime: startTime,
						endTime: endTime,
						error: error,
					})
				: { requestId: `${toolCallId}:${capabilityModel}` };
			attempts.push({
				request_id: auditReference.requestId,
				model: capabilityModel,
				status: "failure",
				start_time: startTime.toISOString(),
				end_time: endTime.toISOString(),
				error: error instanceof Error ? error.message : String(error),
			});
			continue;
		}
		const endTime = new Date();
		const auditReference = options.audit
			? await options.audit({
					capability: "vision",
					stage: "handler",
					callType: "acompletion",
					model: capabilityModel,
					toolCallId: toolCallId,
					imageRefs: args.imageRefs,
					question: args.question,
					detail: args.detail,
					messages: [{ role: "user", content: content } as unknown as Message],
					startTime: startTime,
					endTime: endTime,
					response: raw,
				})
			: { requestId: `${toolCallId}:${capabilityModel}` };
		attempts.push({
			request_id: auditReference.requestId,
			model: capabilityModel,
			status: "success",
			start_time: startTime.toISOString(),
			end_time: endTime.toISOString(),
		});
		return { text: textFromCompletion(raw), raw: raw, model: capabilityModel, attempts: attempts };
	}
	throw lastError ?? ApiError.unavailable("识图能力没有可用的执行模型");
}

/**
 * Full private OpenAI-style agent loop. The main model alone decides whether
 * visual inspection is needed and what question the worker should answer.
 * @param router
 * @param model
 * @param messages
 * @param optionalParams
 * @param complete
 * @param options
 */
export async function runOpenAIVisionAgentLoop(
	router: Router,
	model: string,
	messages: Array<Record<string, unknown>>,
	optionalParams: Record<string, unknown>,
	complete: Completion = (completionModel, completionMessages, params) => router.completion(completionModel, completionMessages, params),
	options: {
		audit?: VisionCapabilityAuditHook;
		imageStore?: VisionImageStore;
		preparedRequest?: PreparedVisionRequest<Record<string, unknown>>;
	} = {},
): Promise<Record<string, unknown>> {
	const imageStore = options.imageStore ?? createVisionImageStore();
	const prepared = options.preparedRequest ?? (await prepareOpenAIVisionRequest(router, model, messages, imageStore));
	if (!prepared) {
		return complete(model, messages as unknown as Message[], optionalParams);
	}
	const tools = Array.isArray(optionalParams["tools"]) ? optionalParams["tools"] : [];
	assertPrivateToolNameAvailable(tools, "openai");
	const params = {
		...optionalParams,
		stream: false,
		tools: [...tools, privateOpenAITool()],
		parallel_tool_calls: false,
	};
	const transcript = [...prepared.messages];
	const consumed: Record<string, unknown>[] = [];
	const internalCalls: Record<string, unknown>[] = [];
	let pendingInternalCalls: Record<string, unknown>[] = [];
	let pendingToolCallIds: string[] = [];
	for (let iteration = 0; iteration < prepared.binding.maxIterations; iteration++) {
		const requestMessages = [...transcript] as unknown as Message[];
		const isContinuation = pendingInternalCalls.length > 0;
		const continuationStartTime = new Date();
		let result: Record<string, unknown>;
		try {
			result = await complete(model, requestMessages, params);
		} catch (error) {
			if (isContinuation && options.audit) {
				await options.audit({
					capability: "vision",
					stage: "continuation",
					callType: "acompletion",
					model: model,
					toolCallId: pendingToolCallIds.join(","),
					messages: requestMessages,
					requestBody: { ...params, model: model, messages: requestMessages },
					startTime: continuationStartTime,
					endTime: new Date(),
					error: error,
				});
			}
			throw error;
		}
		if (isContinuation) {
			const continuationEndTime = new Date();
			const auditReference = options.audit
				? await options.audit({
						capability: "vision",
						stage: "continuation",
						callType: "acompletion",
						model: model,
						toolCallId: pendingToolCallIds.join(","),
						messages: requestMessages,
						requestBody: { ...params, model: model, messages: requestMessages },
						startTime: continuationStartTime,
						endTime: continuationEndTime,
						response: result,
					})
				: { requestId: `${pendingToolCallIds.join(",")}:continuation` };
			const continuation = {
				request_id: auditReference.requestId,
				model: model,
				status: "success",
				start_time: continuationStartTime.toISOString(),
				end_time: continuationEndTime.toISOString(),
			};
			for (const internalCall of pendingInternalCalls) {
				internalCall["continuation"] = continuation;
			}
			pendingInternalCalls = [];
			pendingToolCallIds = [];
		}
		const assistant = extractAssistant(result);
		const calls = extractToolCalls(assistant);
		const privateCalls = calls.filter((call) => call.function?.name === PRIVATE_VISION_TOOL_NAME);
		if (privateCalls.length === 0) {
			for (const prior of consumed) {
				addUsage(result, prior);
			}
			return result;
		}
		// A model may still emit the private tool beside client-provided tools
		// even when parallel_tool_calls is disabled. Consume only the private
		// calls in this hidden turn, then let the model re-decide which public
		// tools remain necessary after it sees the visual result.
		transcript.push({ ...assistant, tool_calls: privateCalls });
		consumed.push(result);
		for (const call of privateCalls) {
			const executed = await executeVisionToolCall(router, prepared.binding, prepared.images, call.function.arguments, complete, {
				audit: options.audit,
				toolCallId: call.id,
				imageStore: prepared.imageStore,
			});
			const args = parseVisionArguments(call.function.arguments);
			const internalCall = {
				type: "builtin_capability",
				capability: "vision",
				tool_name: PRIVATE_VISION_TOOL_NAME,
				tool_call_id: call.id,
				request: {
					image_refs: args.imageRefs,
					question: args.question,
					detail: args.detail,
				},
				attempts: executed.attempts,
				result: {
					model: executed.model,
					content: executed.text,
				},
			};
			internalCalls.push(internalCall);
			pendingInternalCalls.push(internalCall);
			pendingToolCallIds.push(call.id);
			transcript.push({
				role: "tool",
				tool_call_id: call.id,
				content: executed.text,
			});
		}
	}
	throw ApiError.unavailable(`图片处理超过 ${prepared.binding.maxIterations} 轮仍未完成`);
}

/**
 * Build an Anthropic tool_result continuation for one private tool_use block.
 * @param router
 * @param prepared
 * @param response
 * @param audit
 * @param internalCalls
 */
export async function executeAnthropicVisionCalls(
	router: Router,
	prepared: PreparedVisionRequest<Record<string, unknown>>,
	response: Record<string, unknown>,
	audit?: VisionCapabilityAuditHook,
	internalCalls: Record<string, unknown>[] = [],
): Promise<Record<string, unknown>[]> {
	const content = Array.isArray(response["content"]) ? (response["content"] as Array<Record<string, unknown>>) : [];
	const toolUses = content.filter((block) => block?.["type"] === "tool_use" && block["name"] === PRIVATE_VISION_TOOL_NAME);
	if (toolUses.length === 0) {
		return [];
	}
	const toolResults = [];
	for (const toolUse of toolUses) {
		const rawInput = anthropicVisionInputArguments(toolUse["input"]);
		const executed = await executeVisionToolCall(router, prepared.binding, prepared.images, rawInput, undefined, {
			audit: audit,
			toolCallId: String(toolUse["id"] ?? "vision_call"),
			imageStore: prepared.imageStore,
		});
		const args = parseVisionArguments(rawInput);
		internalCalls.push({
			type: "builtin_capability",
			capability: "vision",
			tool_name: PRIVATE_VISION_TOOL_NAME,
			tool_call_id: toolUse["id"],
			request: {
				image_refs: args.imageRefs,
				question: args.question,
				detail: args.detail,
			},
			attempts: executed.attempts,
			result: {
				model: executed.model,
				content: executed.text,
			},
		});
		toolResults.push({
			type: "tool_result",
			tool_use_id: toolUse["id"],
			content: executed.text,
		});
	}
	const privateContinuationContent = content.filter(
		(block) => block?.["type"] !== "tool_use" || block["name"] === PRIVATE_VISION_TOOL_NAME,
	);
	return [
		// Public tool_use blocks cannot be continued without client results.
		// Keep only private calls in the hidden transcript and let the model
		// emit any still-needed public calls again after visual inspection.
		{ role: "assistant", content: privateContinuationContent },
		{ role: "user", content: toolResults },
	];
}

/**
 * Full private Anthropic Messages agent loop.
 * @param router
 * @param prepared
 * @param complete
 * @param audit
 */
export async function runAnthropicVisionAgentLoop(
	router: Router,
	prepared: PreparedVisionRequest<Record<string, unknown>> & { body: Record<string, unknown> },
	complete: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
	audit?: VisionCapabilityAuditHook,
): Promise<{ response: Record<string, unknown>; body: Record<string, unknown> }> {
	let body = prepared.body;
	const consumedResponses: Record<string, unknown>[] = [];
	const internalCalls: Record<string, unknown>[] = [];
	let pendingInternalCalls: Record<string, unknown>[] = [];
	let pendingToolCallIds: string[] = [];
	for (let iteration = 0; iteration < prepared.binding.maxIterations; iteration++) {
		const triggerInternalCalls = pendingInternalCalls;
		const triggerToolCallIds = pendingToolCallIds;
		pendingInternalCalls = [];
		pendingToolCallIds = [];
		const continuationAttempts: VisionExecutionAttempt[] = [];
		const completeMainRequest = async (requestBody: Record<string, unknown>): Promise<Record<string, unknown>> => {
			const requestMessages = Array.isArray(requestBody["messages"]) ? (requestBody["messages"] as unknown as Message[]) : [];
			const requestModel = typeof requestBody["model"] === "string" ? requestBody["model"] : String(prepared.body["model"] ?? "");
			const startTime = new Date();
			let response: Record<string, unknown>;
			try {
				response = await complete(requestBody);
			} catch (error) {
				if (triggerInternalCalls.length > 0 && audit) {
					const reference = await audit({
						capability: "vision",
						stage: "continuation",
						callType: "amessages",
						model: requestModel,
						toolCallId: triggerToolCallIds.join(","),
						messages: requestMessages,
						requestBody: requestBody,
						startTime: startTime,
						endTime: new Date(),
						error: error,
					});
					continuationAttempts.push({
						request_id: reference.requestId,
						model: requestModel,
						status: "failure",
						start_time: startTime.toISOString(),
						end_time: new Date().toISOString(),
						error: error instanceof Error ? error.message : String(error),
					});
				}
				throw error;
			}
			if (triggerInternalCalls.length > 0) {
				const endTime = new Date();
				const reference = audit
					? await audit({
							capability: "vision",
							stage: "continuation",
							callType: "amessages",
							model: requestModel,
							toolCallId: triggerToolCallIds.join(","),
							messages: requestMessages,
							requestBody: requestBody,
							startTime: startTime,
							endTime: endTime,
							response: response,
						})
					: { requestId: `${triggerToolCallIds.join(",")}:continuation:${continuationAttempts.length + 1}` };
				continuationAttempts.push({
					request_id: reference.requestId,
					model: requestModel,
					status: "success",
					start_time: startTime.toISOString(),
					end_time: endTime.toISOString(),
				});
			}
			return response;
		};
		let response = await completeMainRequest(body);
		if (hasTruncatedAnthropicVisionArguments(response)) {
			consumedResponses.push(response);
			const configuredMaxTokens =
				typeof body["max_tokens"] === "number" && Number.isFinite(body["max_tokens"]) ? body["max_tokens"] : 0;
			response = await completeMainRequest({
				...body,
				max_tokens: Math.max(configuredMaxTokens, Math.min(prepared.binding.maxOutputTokens, 512)),
			});
		}
		if (continuationAttempts.length > 0) {
			for (const internalCall of triggerInternalCalls) {
				internalCall["continuation"] = continuationAttempts.at(-1);
				if (continuationAttempts.length > 1) {
					internalCall["continuation_attempts"] = continuationAttempts;
				}
			}
		}
		const internalCallStart = internalCalls.length;
		const continuation = await executeAnthropicVisionCalls(router, prepared, response, audit, internalCalls);
		if (continuation.length === 0) {
			for (const consumed of consumedResponses) {
				addUsage(response, consumed);
			}
			return { response: response, body: body };
		}
		consumedResponses.push(response);
		pendingInternalCalls = internalCalls.slice(internalCallStart);
		pendingToolCallIds = pendingInternalCalls
			.map((internalCall) => internalCall["tool_call_id"])
			.filter((toolCallId): toolCallId is string => typeof toolCallId === "string");
		const messages = Array.isArray(body["messages"]) ? body["messages"] : [];
		body = { ...body, messages: [...messages, ...continuation] };
	}
	throw ApiError.unavailable(`图片处理超过 ${prepared.binding.maxIterations} 轮仍未完成`);
}
