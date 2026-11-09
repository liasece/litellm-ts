import { addResponseUsage } from "../core/utils/usage";
/* eslint-disable jsdoc/check-alignment, jsdoc/multiline-blocks */
import { randomUUID } from "node:crypto";
import { ApiError } from "../core/api/ApiError";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { Router } from "../router/Router";
import { captureUpstreamExchange } from "../router/UpstreamExchange";
import { getAttachedUpstreamLogContext, getUpstreamLogContext, type UpstreamLogContext } from "../router/UpstreamLogContext";
import { calculateAndSetCost } from "../spend/SpendTracker";
import type { Message, ModelResponse, ToolCall } from "../types/openai";
import type { BuiltinCapabilityAuditHook } from "./BuiltinCapabilityAudit";
import {
	BUILTIN_CAPABILITIES_CONFIG_PARAM,
	MAX_BUILTIN_CAPABILITY_ITERATIONS,
	modelsFromExecutors,
	normalizeBuiltinCapabilitiesConfig,
} from "./BuiltinCapabilitiesConfig";
import { capturePrivateToolCallOutcome } from "./PrivateToolCallOutcome";
import { createVisionImageStore, storeVisionImageUrl, type StoredVisionImage, type VisionImageStore } from "./VisionImageStore";

export const PRIVATE_IMAGE_CREATE_TOOL_NAME = "litellm__image_create";
export const PRIVATE_IMAGE_EDIT_TOOL_NAME = "litellm__image_edit";
const IMAGE_REF_PATTERN = /^sha256:[a-f0-9]{64}$/;
const IMAGE_REF_GLOBAL_PATTERN = /sha256:[a-f0-9]{64}/g;

/**
 *
 */
export interface ImageGenerationCapabilityBinding {
	/**
	 *
	 */
	readonly alwaysInject: boolean;
	/**
	 *
	 */
	readonly handlerModel: string;
	/**
	 *
	 */
	readonly fallbackModels: string[];
	/**
	 *
	 */
	readonly maxIterations: number;
}

/** Main-model request with edit sources registered separately from its image content.
 * @template TMessage
 */
export interface PreparedImageGenerationRequest<TMessage> {
	/**
	 *
	 */
	readonly messages: TMessage[];
	/**
	 *
	 */
	readonly images: Map<string, StoredVisionImage>;
	/**
	 *
	 */
	readonly imageStore: VisionImageStore;
	/**
	 *
	 */
	readonly binding: ImageGenerationCapabilityBinding;
	/**
	 * 追加到消息末尾、内容随请求中图片变化的条数。
	 *
	 * 引用清单必须留在末尾：它每读到一张新图片就会变化，放在最前面会改写
	 * prompt 的第一个 token，使上游前缀缓存整段失效（一次 14 万 token 全价重读）。
	 */
	readonly tailMessageCount: number;
}

/**
 *
 */
export interface BuiltinGeneratedImage {
	/**
	 *
	 */
	readonly id: string;
	/**
	 *
	 */
	readonly action: "create" | "edit";
	/**
	 *
	 */
	readonly ref: string;
	/**
	 *
	 */
	readonly b64Json: string;
	/**
	 *
	 */
	readonly mediaType: string;
	/**
	 *
	 */
	readonly outputFormat: "png" | "jpeg" | "webp";
	/**
	 *
	 */
	readonly prompt: string;
	/**
	 *
	 */
	readonly model: string;
	/**
	 *
	 */
	readonly size?: string;
	/**
	 *
	 */
	readonly quality?: string;
	/**
	 *
	 */
	readonly background?: string;
}

type Completion = (model: string, messages: Message[], optionalParams: Record<string, unknown>) => Promise<Record<string, unknown>>;

interface ParsedImageArguments {
	readonly action: "create" | "edit";
	readonly prompt: string;
	readonly imageRefs: string[];
	readonly maskRef?: string;
	readonly params: Record<string, unknown>;
}

function getResolvedModel(router: Router, model: string): string {
	return typeof router.resolveModelGroupWithTrace === "function" ? router.resolveModelGroupWithTrace(model).resolvedModel : model;
}

/**
 * @param router
 * @param model
 */
export async function resolveImageGenerationCapability(
	router: Router,
	model: string,
): Promise<ImageGenerationCapabilityBinding | undefined> {
	if (typeof router.getDeployments !== "function") {
		return undefined;
	}
	const resolvedModel = getResolvedModel(router, model);
	const selected = router
		.getDeployments()
		.some(
			(deployment) =>
				(deployment.model_name === resolvedModel ||
					deployment.model_info?.model_name === resolvedModel ||
					deployment.model_name === model) &&
				deployment.model_info?.enabled_builtin_capabilities?.includes("image_generation") === true &&
				deployment.model_info?.supports_function_calling !== false,
		);
	if (!selected) {
		return undefined;
	}
	const config = normalizeBuiltinCapabilitiesConfig(await dbConfigProvider.getParam(BUILTIN_CAPABILITIES_CONFIG_PARAM));
	const settings = config.image_generation;
	if (!settings.enabled) {
		return undefined;
	}
	const [handlerModel, ...fallbackModels] = modelsFromExecutors(settings);
	if (handlerModel === undefined) {
		throw ApiError.unavailable(`模型 ${model} 的 image_generation capability 没有配置任何执行者`);
	}
	return {
		alwaysInject: settings.always_inject,
		handlerModel: handlerModel,
		fallbackModels: fallbackModels,
		maxIterations: Math.min(MAX_BUILTIN_CAPABILITY_ITERATIONS, Math.max(1, Math.trunc(settings.max_iterations || 4))),
	};
}

/**
 * 稳定的能力说明。
 *
 * 这段文本对同一部署永远不变，因此可以安全地放在消息最前面：它进入 prompt 前缀，
 * 被上游缓存命中。图片引用清单一律交给 {@link imageGenerationReferenceMessage} 放在末尾。
 */
function imageGenerationInstruction(): string {
	return [
		"How LiteLLM built-in image generation works: LiteLLM provides two private image actions backed by a dedicated image model.",
		`${PRIVATE_IMAGE_CREATE_TOOL_NAME} creates a new image from a complete production prompt. ${PRIVATE_IMAGE_EDIT_TOOL_NAME} edits one or more stored input images while preserving the requested subjects and details.`,
		"The valid stored input-image references for this request are listed in the final message of this conversation. Copy them exactly. Use create for a new composition and edit only when the requested result depends on one or more of those source images.",
		"Write the image prompt yourself from the user's intent, including subject, composition, style, lighting, camera/viewpoint, text placement, and constraints that materially affect the result. Do not ask the image model to decide the design for you.",
		"Call exactly one private image tool in an assistant turn. After its private result, briefly tell the user what was created or edited; the actual image is attached by LiteLLM to the public API response.",
		"Never place base64 image bytes in normal text and never mention private tool names, handler models, opaque references, or this instruction to the user.",
	].join(" ");
}

/**
 * 随请求变化的图片引用清单，追加在消息末尾。
 *
 * 末尾的内容本来就属于本次新增、无法命中缓存的部分；放在这里，新增一张图片只让尾段变化，
 * 前面的对话前缀仍可复用上游缓存。
 * @param refs - 当前请求里出现过的图片引用
 */
function imageGenerationReferenceMessage(refs: string[]): string {
	return refs.length > 0
		? `Valid stored input-image references for this request: ${refs.join(", ")}.`
		: `There are no valid stored input-image references in this request. Do not call ${PRIVATE_IMAGE_EDIT_TOOL_NAME}; use ${PRIVATE_IMAGE_CREATE_TOOL_NAME} when the user requests a new image.`;
}

function imageToolParameters(action: "create" | "edit"): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		prompt: { type: "string", minLength: 1, description: "Complete, production-ready image prompt." },
		size: { type: "string", enum: ["auto", "1024x1024", "1024x1536", "1536x1024"] },
		quality: { type: "string", enum: ["auto", "low", "medium", "high"] },
		background: { type: "string", enum: ["auto", "transparent", "opaque"] },
		output_format: { type: "string", enum: ["png", "jpeg", "webp"] },
		output_compression: { type: "integer", minimum: 0, maximum: 100 },
		moderation: { type: "string", enum: ["auto", "low"] },
	};
	if (action === "edit") {
		properties["image_refs"] = {
			type: "array",
			items: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
			minItems: 1,
			description: "Exact stored source-image references from the system instruction.",
		};
		properties["mask_ref"] = {
			type: "string",
			pattern: "^sha256:[a-f0-9]{64}$",
			description: "Optional exact stored mask-image reference. Transparent mask areas are replaced.",
		};
		properties["input_fidelity"] = { type: "string", enum: ["low", "high"] };
	}
	return {
		type: "object",
		additionalProperties: false,
		properties: properties,
		required: action === "edit" ? ["prompt", "image_refs"] : ["prompt"],
	};
}

function privateOpenAIImageTools(): Record<string, unknown>[] {
	return (["create", "edit"] as const).map((action) => ({
		type: "function",
		function: {
			name: action === "create" ? PRIVATE_IMAGE_CREATE_TOOL_NAME : PRIVATE_IMAGE_EDIT_TOOL_NAME,
			description:
				action === "create"
					? "Create and attach a new image from a production-ready prompt using LiteLLM's private image model."
					: "Edit stored source images and attach the result using LiteLLM's private image model.",
			parameters: imageToolParameters(action),
		},
	}));
}

/**
 *
 */
export function privateAnthropicImageTools(): Record<string, unknown>[] {
	return privateOpenAIImageTools().map((tool) => {
		const fn = tool["function"] as Record<string, unknown>;
		return { name: fn["name"], description: fn["description"], input_schema: fn["parameters"] };
	});
}

function assertToolNamesAvailable(tools: unknown[], protocol: "openai" | "anthropic"): void {
	for (const tool of tools) {
		if (typeof tool !== "object" || tool === null) {
			continue;
		}
		const record = tool as Record<string, unknown>;
		const fn = protocol === "anthropic" ? record : (record["function"] as Record<string, unknown> | undefined);
		const name = fn?.["name"];
		if (name === PRIVATE_IMAGE_CREATE_TOOL_NAME || name === PRIVATE_IMAGE_EDIT_TOOL_NAME) {
			throw ApiError.badRequest(`工具名 ${String(name)} 为 LiteLLM 内部保留名称`);
		}
	}
}

function imageUrlFromPart(part: Record<string, unknown>): string | undefined {
	if (part["type"] === "image_url") {
		const value = part["image_url"];
		if (typeof value === "string") {
			return value;
		}
		if (typeof value === "object" && value !== null && typeof (value as Record<string, unknown>)["url"] === "string") {
			return (value as Record<string, unknown>)["url"] as string;
		}
	}
	if (part["type"] === "image") {
		const source = part["source"] as Record<string, unknown> | undefined;
		if (source?.["type"] === "base64" && typeof source["data"] === "string") {
			return `data:${String(source["media_type"] ?? "image/png")};base64,${source["data"]}`;
		}
		if (source?.["type"] === "url" && typeof source["url"] === "string") {
			return source["url"];
		}
	}
	return undefined;
}

async function registerRefsFromText(text: string, store: VisionImageStore, images: Map<string, StoredVisionImage>): Promise<void> {
	for (const ref of new Set(text.match(IMAGE_REF_GLOBAL_PATTERN) ?? [])) {
		const image = await store.get(ref);
		if (image) {
			images.set(ref, image);
		}
	}
}

// Image-generation tools may index source images, but only their own execution
// resolves those references. The main-model transcript must keep its image input.
async function registerImageSources(content: unknown, store: VisionImageStore, images: Map<string, StoredVisionImage>): Promise<void> {
	if (typeof content === "string") {
		await registerRefsFromText(content, store, images);
		return;
	}
	if (!Array.isArray(content)) {
		return;
	}
	for (const rawPart of content) {
		if (typeof rawPart !== "object" || rawPart === null) {
			continue;
		}
		const part = rawPart as Record<string, unknown>;
		const url = imageUrlFromPart(part);
		if (url) {
			const stored = await storeVisionImageUrl(store, url);
			images.set(stored.ref, stored);
			continue;
		}
		if (part["type"] === "tool_result") {
			await registerImageSources(part["content"], store, images);
			continue;
		}
		if (typeof part["text"] === "string") {
			await registerRefsFromText(part["text"], store, images);
		}
	}
}

/**
 * @param router
 * @param model
 * @param messages
 * @param imageStore
 */
export async function prepareOpenAIImageGenerationRequest(
	router: Router,
	model: string,
	messages: Array<Record<string, unknown>>,
	imageStore: VisionImageStore = createVisionImageStore(),
): Promise<PreparedImageGenerationRequest<Record<string, unknown>> | undefined> {
	const binding = await resolveImageGenerationCapability(router, model);
	if (!binding) {
		return undefined;
	}
	const images = new Map<string, StoredVisionImage>();
	for (const message of messages) {
		await registerImageSources(message["content"], imageStore, images);
	}
	if (images.size === 0 && !binding.alwaysInject) {
		return undefined;
	}
	return {
		messages: [
			{ role: "system", content: imageGenerationInstruction() },
			...messages,
			{ role: "system", content: imageGenerationReferenceMessage([...images.keys()]) },
		],
		images: images,
		imageStore: imageStore,
		binding: binding,
		tailMessageCount: 1,
	};
}

/**
 * @param router
 * @param model
 * @param body
 * @param imageStore
 */
export async function prepareAnthropicImageGenerationRequest(
	router: Router,
	model: string,
	body: Record<string, unknown>,
	imageStore: VisionImageStore = createVisionImageStore(),
): Promise<
	| (PreparedImageGenerationRequest<Record<string, unknown>> & {
			/**
			 *
			 */
			body: Record<string, unknown>;
	  })
	| undefined
> {
	const binding = await resolveImageGenerationCapability(router, model);
	if (!binding) {
		return undefined;
	}
	const images = new Map<string, StoredVisionImage>();
	const sourceMessages = Array.isArray(body["messages"]) ? (body["messages"] as Array<Record<string, unknown>>) : [];
	for (const message of sourceMessages) {
		await registerImageSources(message["content"], imageStore, images);
	}
	if (images.size === 0 && !binding.alwaysInject) {
		return undefined;
	}
	const instruction = imageGenerationInstruction();
	const currentSystem = body["system"];
	const system =
		typeof currentSystem === "string"
			? `${currentSystem}\n\n${instruction}`
			: Array.isArray(currentSystem)
				? [...currentSystem, { type: "text", text: instruction }]
				: instruction;
	const messages = appendAnthropicReferenceMessage(sourceMessages, imageGenerationReferenceMessage([...images.keys()]));
	const tools = Array.isArray(body["tools"]) ? body["tools"] : [];
	assertToolNamesAvailable(tools, "anthropic");
	return {
		body: { ...body, system: system, messages: messages, tools: [...tools, ...privateAnthropicImageTools()] },
		messages: messages,
		images: images,
		imageStore: imageStore,
		binding: binding,
		tailMessageCount: 1,
	};
}

/**
 * 把随图片变化的引用清单挂到 Messages 请求末尾。
 *
 * Anthropic 的 system 位于 prompt 最前面，引用清单一放进去就破坏前缀缓存；
 * 因此清单追加到最后一条 user 消息的 content 里，必要时新增一条 user 消息。
 * @param messages - 客户端原始消息
 * @param text - 引用清单文本
 */
function appendAnthropicReferenceMessage(
	messages: Array<Record<string, unknown>>,
	text: string,
): Array<Record<string, unknown>> {
	const reference = { type: "text", text: text };
	const last = messages.length > 0 ? messages[messages.length - 1] : undefined;
	if (last === undefined || last["role"] !== "user") {
		return [...messages, { role: "user", content: [reference] }];
	}
	const content = last["content"];
	const merged =
		typeof content === "string" ? [{ type: "text", text: content }, reference] : Array.isArray(content) ? [...content, reference] : [reference];
	return [...messages.slice(0, -1), { ...last, content: merged }];
}

function parseArguments(toolName: string, raw: string): ParsedImageArguments {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		throw ApiError.badRequest("图片生成参数不是有效 JSON");
	}
	const record = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	const action = toolName === PRIVATE_IMAGE_EDIT_TOOL_NAME ? "edit" : "create";
	const prompt = typeof record["prompt"] === "string" ? record["prompt"].trim() : "";
	if (!prompt) {
		throw ApiError.badRequest("图片生成参数缺少 prompt");
	}
	const imageRefs = Array.isArray(record["image_refs"])
		? record["image_refs"].filter((ref): ref is string => typeof ref === "string" && IMAGE_REF_PATTERN.test(ref))
		: [];
	if (action === "edit" && imageRefs.length === 0) {
		throw ApiError.badRequest("图片编辑参数缺少有效 image_refs");
	}
	const maskRef = typeof record["mask_ref"] === "string" && IMAGE_REF_PATTERN.test(record["mask_ref"]) ? record["mask_ref"] : undefined;
	const params: Record<string, unknown> = {};
	for (const key of ["size", "quality", "background", "output_format", "output_compression", "moderation", "input_fidelity"]) {
		if (record[key] !== undefined) {
			params[key] = record[key];
		}
	}
	return { action: action, prompt: prompt, imageRefs: imageRefs, maskRef: maskRef, params: params };
}

function mediaTypeForFormat(format: string): string {
	return format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
}

function formatForMediaType(mediaType: string): "png" | "jpeg" | "webp" {
	return mediaType === "image/jpeg" ? "jpeg" : mediaType === "image/webp" ? "webp" : "png";
}

async function normalizeGeneratedImages(
	response: Record<string, unknown>,
	action: "create" | "edit",
	prompt: string,
	model: string,
	store: VisionImageStore,
): Promise<BuiltinGeneratedImage[]> {
	const data = Array.isArray(response["data"]) ? (response["data"] as Array<Record<string, unknown>>) : [];
	const outputFormat = typeof response["output_format"] === "string" ? response["output_format"] : "png";
	const result: BuiltinGeneratedImage[] = [];
	for (const item of data) {
		let stored: StoredVisionImage | undefined;
		if (typeof item["b64_json"] === "string") {
			stored = await storeVisionImageUrl(store, `data:${mediaTypeForFormat(outputFormat)};base64,${item["b64_json"]}`);
		} else if (typeof item["url"] === "string") {
			stored = await storeVisionImageUrl(store, item["url"]);
		}
		if (!stored) {
			continue;
		}
		result.push({
			id: `imggen_${randomUUID().replaceAll("-", "")}`,
			action: action,
			ref: stored.ref,
			b64Json: stored.base64Data,
			mediaType: stored.mediaType,
			outputFormat: formatForMediaType(stored.mediaType),
			prompt: prompt,
			model: model,
			...(typeof response["size"] === "string" ? { size: response["size"] } : {}),
			...(typeof response["quality"] === "string" ? { quality: response["quality"] } : {}),
			...(typeof response["background"] === "string" ? { background: response["background"] } : {}),
		});
	}
	if (result.length === 0) {
		throw ApiError.unavailable("图片模型没有返回可解析的图片");
	}
	return result;
}


function appendGeneratedImages(result: Record<string, unknown>, images: BuiltinGeneratedImage[]): void {
	const existing = Array.isArray(result["_builtinGeneratedImages"]) ? (result["_builtinGeneratedImages"] as BuiltinGeneratedImage[]) : [];
	result["_builtinGeneratedImages"] = [...existing, ...images];
	const choices = Array.isArray(result["choices"]) ? result["choices"] : [];
	const choice = choices[0] as Record<string, unknown> | undefined;
	const message = choice?.["message"] as Record<string, unknown> | undefined;
	if (!message) {
		return;
	}
	const publicImages = images.map((image) => ({
		type: "image_url",
		image_url: { url: `data:${image.mediaType};base64,${image.b64Json}`, detail: "auto" },
	}));
	message["images"] = [...(Array.isArray(message["images"]) ? message["images"] : []), ...publicImages];
	const first = images[0];
	if (first && message["image"] === undefined) {
		message["image"] = { url: `data:${first.mediaType};base64,${first.b64Json}`, detail: "auto" };
	}
}

/**
 * @param router
 * @param binding
 * @param images
 * @param toolName
 * @param rawArguments
 * @param options
 */
export async function executeImageGenerationToolCall(
	router: Router,
	binding: ImageGenerationCapabilityBinding,
	images: Map<string, StoredVisionImage>,
	toolName: string,
	rawArguments: string,
	options: {
		/**
		 *
		 */
		audit?: BuiltinCapabilityAuditHook; /**
		 *
		 */
		toolCallId?: string; /**
		 *
		 */
		imageStore?: VisionImageStore;
	} = {},
): Promise<{
	/**
	 *
	 */
	text: string; /**
	 *
	 */
	raw: Record<string, unknown>; /**
	 *
	 */
	model: string; /**
	 *
	 */
	images: BuiltinGeneratedImage[];
}> {
	const args = parseArguments(toolName, rawArguments);
	const store = options.imageStore ?? createVisionImageStore();
	const sourceImages: StoredVisionImage[] = [];
	for (const ref of args.imageRefs) {
		const image = images.get(ref) ?? (await store.get(ref));
		if (!image) {
			throw ApiError.badRequest(`图片编辑引用不可用: ${ref}`);
		}
		sourceImages.push(image);
	}
	const mask = args.maskRef ? (images.get(args.maskRef) ?? (await store.get(args.maskRef))) : undefined;
	if (args.maskRef && !mask) {
		throw ApiError.badRequest(`图片编辑 mask 引用不可用: ${args.maskRef}`);
	}
	let lastError: unknown;
	let workerUpstream: UpstreamLogContext | undefined;
	for (const capabilityModel of [...new Set([binding.handlerModel, ...binding.fallbackModels])]) {
		const startTime = new Date();
		try {
			const optionalParams = {
				...args.params,
				...(mask ? { mask: { data: Buffer.from(mask.base64Data, "base64"), mediaType: mask.mediaType } } : {}),
			};
			// 图片执行者调用走独立的旁路子作用域，捕获它自己的上游交换。
			const runExecutor = async (): Promise<Record<string, unknown>> => {
				if (args.action === "create") {
					return await router.imageGeneration(capabilityModel, args.prompt, optionalParams);
				}
				return await router.imageEdit(
					capabilityModel,
					args.prompt,
					sourceImages.map((image) => ({ data: Buffer.from(image.base64Data, "base64"), mediaType: image.mediaType })),
					optionalParams,
				);
			};
			const captured = await captureUpstreamExchange(runExecutor);
			const raw = captured.result;
			workerUpstream = captured.context;
			const spendInfo = raw["_spendInfo"] as
				| { customCostPerToken?: Parameters<typeof calculateAndSetCost>[2] }
				| undefined;
			calculateAndSetCost(raw as unknown as ModelResponse, capabilityModel, spendInfo?.customCostPerToken);
			const generated = await normalizeGeneratedImages(raw, args.action, args.prompt, capabilityModel, store);
			await options.audit?.({
				capability: "image_generation",
				stage: "handler",
				callType: "aimage_generation",
				model: capabilityModel,
				toolCallId: options.toolCallId ?? "image_generation_call",
				imageRefs: args.imageRefs,
				action: args.action,
				prompt: args.prompt,
				messages: [{ role: "user", content: args.prompt }],
				requestBody: { model: capabilityModel, prompt: args.prompt, image_refs: args.imageRefs, ...args.params },
				startTime: startTime,
				endTime: new Date(),
				response: raw,
				upstreamLogContext: workerUpstream,
			});
			return {
				text: JSON.stringify({
					status: "completed",
					action: args.action,
					images: generated.map((image) => ({ ref: image.ref, media_type: image.mediaType })),
				}),
				raw: raw,
				model: capabilityModel,
				images: generated,
			};
		} catch (error) {
			lastError = error;
			await options.audit?.({
				capability: "image_generation",
				stage: "handler",
				callType: "aimage_generation",
				model: capabilityModel,
				toolCallId: options.toolCallId ?? "image_generation_call",
				imageRefs: args.imageRefs,
				action: args.action,
				prompt: args.prompt,
				messages: [{ role: "user", content: args.prompt }],
				requestBody: { model: capabilityModel, prompt: args.prompt, image_refs: args.imageRefs, ...args.params },
				startTime: startTime,
				endTime: new Date(),
				error: error,
				upstreamLogContext: getAttachedUpstreamLogContext(error),
			});
		}
	}
	throw lastError ?? ApiError.unavailable("图片生成能力没有可用的执行模型");
}

function extractAssistant(result: Record<string, unknown>): Record<string, unknown> {
	const choice = Array.isArray(result["choices"]) ? (result["choices"][0] as Record<string, unknown> | undefined) : undefined;
	const message = choice?.["message"];
	if (typeof message !== "object" || message === null) {
		throw ApiError.unavailable("主模型没有返回可解析的 assistant message");
	}
	return message as Record<string, unknown>;
}

function privateCallsFromAssistant(message: Record<string, unknown>): ToolCall[] {
	const calls = Array.isArray(message["tool_calls"]) ? (message["tool_calls"] as ToolCall[]) : [];
	return calls.filter(
		(call) => call.function?.name === PRIVATE_IMAGE_CREATE_TOOL_NAME || call.function?.name === PRIVATE_IMAGE_EDIT_TOOL_NAME,
	);
}

/**
 * @param router
 * @param model
 * @param messages
 * @param optionalParams
 * @param complete
 * @param options
 */
export async function runOpenAIImageGenerationAgentLoop(
	router: Router,
	model: string,
	messages: Array<Record<string, unknown>>,
	optionalParams: Record<string, unknown>,
	complete: Completion = (completionModel, completionMessages, params) => router.completion(completionModel, completionMessages, params),
	options: {
		/**
		 *
		 */
		audit?: BuiltinCapabilityAuditHook;
		/**
		 *
		 */
		imageStore?: VisionImageStore;
		/**
		 *
		 */
		preparedRequest?: PreparedImageGenerationRequest<Record<string, unknown>>;
	} = {},
): Promise<Record<string, unknown>> {
	const store = options.imageStore ?? createVisionImageStore();
	const prepared = options.preparedRequest ?? (await prepareOpenAIImageGenerationRequest(router, model, messages, store));
	if (!prepared) {
		return complete(model, messages as unknown as Message[], optionalParams);
	}
	const tools = Array.isArray(optionalParams["tools"]) ? optionalParams["tools"] : [];
	assertToolNamesAvailable(tools, "openai");
	const params = { ...optionalParams, stream: false, tools: [...tools, ...privateOpenAIImageTools()], parallel_tool_calls: false };
	const transcript = [...prepared.messages];
	const generated: BuiltinGeneratedImage[] = [];
	const consumed: Record<string, unknown>[] = [];
	let pendingToolCallIds: string[] = [];
	for (let iteration = 0; iteration < prepared.binding.maxIterations; iteration++) {
		const requestMessages = [...transcript] as unknown as Message[];
		const startTime = new Date();
		let result: Record<string, unknown>;
		try {
			result = await complete(model, requestMessages, params);
		} catch (error) {
			if (pendingToolCallIds.length > 0) {
				await options.audit?.({
					capability: "image_generation",
					stage: "continuation",
					callType: "acompletion",
					model: model,
					toolCallId: pendingToolCallIds.join(","),
					messages: requestMessages,
					requestBody: { ...params, model: model, messages: requestMessages },
					startTime: startTime,
					endTime: new Date(),
					error: error,
					upstreamLogContext: getUpstreamLogContext(error),
				});
			}
			throw error;
		}
		if (pendingToolCallIds.length > 0) {
			await options.audit?.({
				capability: "image_generation",
				stage: "continuation",
				callType: "acompletion",
				model: model,
				toolCallId: pendingToolCallIds.join(","),
				messages: requestMessages,
				requestBody: { ...params, model: model, messages: requestMessages },
				startTime: startTime,
				endTime: new Date(),
				response: result,
				upstreamLogContext: getUpstreamLogContext(result),
			});
			pendingToolCallIds = [];
		}
		const assistant = extractAssistant(result);
		const calls = privateCallsFromAssistant(assistant);
		if (calls.length === 0) {
			for (const prior of consumed) {
				addResponseUsage(result, prior);
			}
			appendGeneratedImages(result, generated);
			return result;
		}
		transcript.push({ ...assistant, tool_calls: calls });
		consumed.push(result);
		for (const call of calls) {
			const outcome = await capturePrivateToolCallOutcome(() =>
				executeImageGenerationToolCall(
					router,
					prepared.binding,
					prepared.images,
					call.function.name,
					call.function.arguments,
					{ audit: options.audit, toolCallId: call.id, imageStore: prepared.imageStore },
				),
			);
			pendingToolCallIds.push(call.id);
			if (outcome.status === "argument_error") {
				transcript.push({ role: "tool", tool_call_id: call.id, content: outcome.text });
				continue;
			}
			const executed = outcome.result;
			generated.push(...executed.images);
			consumed.push(executed.raw);
			for (const image of executed.images) {
				prepared.images.set(image.ref, (await prepared.imageStore.get(image.ref))!);
			}
			transcript.push({ role: "tool", tool_call_id: call.id, content: executed.text });
		}
	}
	throw ApiError.unavailable(`图片生成处理超过 ${prepared.binding.maxIterations} 轮仍未完成`);
}

function anthropicInputArguments(input: unknown): string {
	return typeof input === "string" ? input : JSON.stringify(input ?? {});
}

function appendAnthropicGeneratedImages(response: Record<string, unknown>, images: BuiltinGeneratedImage[]): void {
	response["generated_images"] = images.map((image) => ({
		id: image.id,
		type: "image",
		source: { type: "base64", media_type: image.mediaType, data: image.b64Json },
		action: image.action,
	}));
	response["_builtinGeneratedImages"] = images;
}

/**
 * @param router
 * @param model
 * @param body
 * @param complete
 * @param options
 */
export async function runAnthropicImageGenerationAgentLoop(
	router: Router,
	model: string,
	body: Record<string, unknown>,
	complete: (body: Record<string, unknown>) => Promise<Record<string, unknown>>,
	options: {
		/**
		 *
		 */
		audit?: BuiltinCapabilityAuditHook; /**
		 *
		 */
		imageStore?: VisionImageStore;
	} = {},
): Promise<{
	/**
	 *
	 */
	response: Record<string, unknown>; /**
	 *
	 */
	body: Record<string, unknown>;
}> {
	const prepared = await prepareAnthropicImageGenerationRequest(router, model, body, options.imageStore);
	if (!prepared) {
		return { response: await complete(body), body: body };
	}
	let requestBody = prepared.body;
	const generated: BuiltinGeneratedImage[] = [];
	const consumed: Record<string, unknown>[] = [];
	for (let iteration = 0; iteration < prepared.binding.maxIterations; iteration++) {
		const response = await complete(requestBody);
		const content = Array.isArray(response["content"]) ? (response["content"] as Array<Record<string, unknown>>) : [];
		const toolUses = content.filter(
			(block) =>
				block["type"] === "tool_use" &&
				(block["name"] === PRIVATE_IMAGE_CREATE_TOOL_NAME || block["name"] === PRIVATE_IMAGE_EDIT_TOOL_NAME),
		);
		if (toolUses.length === 0) {
			for (const prior of consumed) {
				addResponseUsage(response, prior);
			}
			appendAnthropicGeneratedImages(response, generated);
			return { response: response, body: requestBody };
		}
		consumed.push(response);
		const toolResults = [];
		for (const use of toolUses) {
			const outcome = await capturePrivateToolCallOutcome(() =>
				executeImageGenerationToolCall(
					router,
					prepared.binding,
					prepared.images,
					String(use["name"]),
					anthropicInputArguments(use["input"]),
					{ audit: options.audit, toolCallId: String(use["id"] ?? "image_generation_call"), imageStore: prepared.imageStore },
				),
			);
			if (outcome.status === "argument_error") {
				toolResults.push({ type: "tool_result", tool_use_id: use["id"], content: outcome.text, is_error: true });
				continue;
			}
			const executed = outcome.result;
			generated.push(...executed.images);
			consumed.push(executed.raw);
			for (const image of executed.images) {
				prepared.images.set(image.ref, (await prepared.imageStore.get(image.ref))!);
			}
			toolResults.push({ type: "tool_result", tool_use_id: use["id"], content: executed.text });
		}
		const privateContent = content.filter(
			(block) =>
				block["type"] !== "tool_use" ||
				block["name"] === PRIVATE_IMAGE_CREATE_TOOL_NAME ||
				block["name"] === PRIVATE_IMAGE_EDIT_TOOL_NAME,
		);
		const messages = Array.isArray(requestBody["messages"]) ? requestBody["messages"] : [];
		requestBody = {
			...requestBody,
			messages: [...messages, { role: "assistant", content: privateContent }, { role: "user", content: toolResults }],
		};
	}
	throw ApiError.unavailable(`图片生成处理超过 ${prepared.binding.maxIterations} 轮仍未完成`);
}
