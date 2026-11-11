import { ImageGenerationTargets } from "./ImageGenerationTargets";
import type { ImageCompletionHistory } from "./ImageCompletionHistory";
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

/**
 * 主模型发起的一次私有图片工具调用。
 *
 * 这些调用只存在于能力内部循环：既不在返回给客户端的响应里，历史上也不进 SpendLog，
 * 于是日志里只能看到“图片被生成了”，却看不到是主模型在哪一步、用什么参数发起的。
 * 这里把它作为 `_` 前缀内部字段挂在响应对象上：随 SpendLog 落库，响应出口统一剥离。
 */
export interface BuiltinPrivateImageToolCall {
	/**
	 *
	 */
	readonly id: string;
	/**
	 *
	 */
	readonly name: string;
	/**
	 * 解析后的调用参数。
	 */
	readonly arguments: Record<string, unknown>;
	/**
	 * 参数不是 JSON 对象时保留的原始串。
	 */
	readonly rawArguments?: string;
	/** The model proposed an output outside its remaining paid work. */
	readonly skipped?: "output_already_resolved";
}

type Completion = (model: string, messages: Message[], optionalParams: Record<string, unknown>) => Promise<Record<string, unknown>>;

function recordValue(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function privateImageToolCallFromInput(id: string, name: string, input: unknown): BuiltinPrivateImageToolCall {
	const parsed = recordValue(input);
	if (parsed) {
		return { id: id, name: name, arguments: parsed };
	}
	return {
		id: id,
		name: name,
		arguments: {},
		rawArguments: typeof input === "string" ? input : JSON.stringify(input ?? null),
	};
}

function privateImageToolCallFromToolCall(call: ToolCall): BuiltinPrivateImageToolCall {
	const raw = call.function?.arguments ?? "";
	const id = call.id ?? "";
	const name = call.function?.name ?? "";
	try {
		const parsed = recordValue(JSON.parse(raw) as unknown);
		if (parsed) {
			return { id: id, name: name, arguments: parsed };
		}
	} catch {
		// 参数不是合法 JSON 时保留原文，等执行阶段按参数错误回给模型。
	}
	return { id: id, name: name, arguments: {}, rawArguments: raw };
}

/**
 * 把本次请求里主模型发起的私有图片工具调用记到响应对象上。
 *
 * 字段以 `_` 开头，属于响应出口会剥离的内部字段，因此只进 SpendLog，不下发客户端。
 * @param result - 即将返回（并写入 SpendLog）的响应对象
 * @param calls - 本次请求中主模型发起的私有工具调用
 */
function appendPrivateImageToolCalls(result: Record<string, unknown>, calls: BuiltinPrivateImageToolCall[]): void {
	if (calls.length === 0) {
		return;
	}
	const existing = Array.isArray(result["_builtinPrivateImageToolCalls"])
		? (result["_builtinPrivateImageToolCalls"] as BuiltinPrivateImageToolCall[])
		: [];
	result["_builtinPrivateImageToolCalls"] = [...existing, ...calls];
}

interface ParsedImageArguments {
	readonly target: Record<string, unknown>;
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

function imageToolParameters(action: "create" | "edit"): Record<string, unknown> {
	const properties: Record<string, unknown> = {
		prompt: { type: "string", minLength: 1, description: "Describe the requested image or edit, including the user's constraints." },
		output_count: {
			type: "integer",
			minimum: 1,
			maximum: MAX_BUILTIN_CAPABILITY_ITERATIONS,
			description:
				"Total distinct images the user requested, including this one. Use 1 for a single image and the same total on every call.",
		},
		output_index: {
			type: "integer",
			minimum: 1,
			maximum: MAX_BUILTIN_CAPABILITY_ITERATIONS,
			description:
				"One-based position of this image. For two requested images, use index 1 for the first and index 2 for the second.",
		},
		final_response: {
			type: "string",
			enum: ["images_only", "image_and_caption", "continue"],
			description:
				"For attachments only, use images_only and call directly without introductory text. For one image and a requested short description only, use image_and_caption with final_caption. For JSON, inspection, external delivery, files or other remaining work, use continue.",
		},
		final_caption: {
			type: "string",
			maxLength: 512,
			description:
				"For image_and_caption, the user's requested short description of this image. The router includes it only after generation succeeds.",
		},
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
			description: "Copy the exact references shown beside the source images or in their completed image operation records.",
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
		required: ["prompt", "output_count", "output_index", "final_response", ...(action === "edit" ? ["image_refs"] : [])],
	};
}

function privateOpenAIImageTools(): Record<string, unknown>[] {
	return (["create", "edit"] as const).map((action) => ({
		type: "function",
		function: {
			name: action === "create" ? PRIVATE_IMAGE_CREATE_TOOL_NAME : PRIVATE_IMAGE_EDIT_TOOL_NAME,
			description:
				action === "create"
					? "Create one new image. The router delivers it as an API attachment without writing a local file. Reuse completed images for delivery or verification."
					: "Apply a change the user explicitly requested to specified existing source images. A newly generated reference alone requires no edit.",
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

/**
 * Preserve every original image and annotate its reference at that same position. Later inputs
 * can only extend the transcript; a moving list of all previous hashes would break its prefix.
 * @param content - Input content, including Anthropic tool result content.
 * @param store - Content-addressed image store.
 * @param images - Valid edit references for this specific request.
 */
async function projectImageSources(content: unknown, store: VisionImageStore, images: Map<string, StoredVisionImage>): Promise<unknown> {
	if (typeof content === "string") {
		await registerRefsFromText(content, store, images);
		return content;
	}
	if (!Array.isArray(content)) {
		return content;
	}
	const projected: unknown[] = [];
	let changed = false;
	for (const [index, rawPart] of content.entries()) {
		const part = recordValue(rawPart);
		if (!part) {
			projected.push(rawPart);
			continue;
		}
		const url = imageUrlFromPart(part);
		if (url) {
			const stored = await storeVisionImageUrl(store, url);
			images.set(stored.ref, stored);
			projected.push(rawPart);
			const refText = `Stored source image reference: ${stored.ref}`;
			if (recordValue(content[index + 1])?.text !== refText) {
				projected.push({ type: "text", text: refText });
				changed = true;
			}
		} else if (part.type === "tool_result") {
			const nested = await projectImageSources(part.content, store, images);
			if (nested !== part.content) {
				projected.push({ ...part, content: nested });
				changed = true;
			} else {
				projected.push(rawPart);
			}
		} else {
			if (typeof part.text === "string") {
				await registerRefsFromText(part.text, store, images);
			}
			projected.push(rawPart);
		}
	}
	return changed ? projected : content;
}

/**
 * @param source - Public or already restored history.
 * @param store - Image store for this endpoint.
 */
async function projectImageMessages(source: Array<Record<string, unknown>>, store: VisionImageStore) {
	const images = new Map<string, StoredVisionImage>();
	const messages: Array<Record<string, unknown>> = [];
	for (const message of source) {
		const content = await projectImageSources(message.content, store, images);
		messages.push(content === message.content ? message : { ...message, content: content });
	}
	return { images: images, messages: messages };
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
	const { images, messages: projected } = await projectImageMessages(messages, imageStore);
	if (images.size === 0 && !binding.alwaysInject) {
		return undefined;
	}
	return {
		messages: projected,
		images: images,
		imageStore: imageStore,
		binding: binding,
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
	const sourceMessages = Array.isArray(body["messages"]) ? (body["messages"] as Array<Record<string, unknown>>) : [];
	const { images, messages } = await projectImageMessages(sourceMessages, imageStore);
	if (images.size === 0 && !binding.alwaysInject) {
		return undefined;
	}
	const tools = Array.isArray(body["tools"]) ? body["tools"] : [];
	assertToolNamesAvailable(tools, "anthropic");
	return {
		body: { ...body, messages: messages, tools: [...tools, ...privateAnthropicImageTools()] },
		messages: messages,
		images: images,
		imageStore: imageStore,
		binding: binding,
	};
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
	return {
		action: action,
		prompt: prompt,
		imageRefs: imageRefs,
		maskRef: maskRef,
		params: params,
		target: {
			output_index: record.output_index,
			output_count: record.output_count,
			final_response: record.final_response,
			final_caption: record.final_caption,
		},
	};
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

function finalizeImageReply(
	result: Record<string, unknown>,
	previous: readonly Record<string, unknown>[],
	images: BuiltinGeneratedImage[],
	calls: BuiltinPrivateImageToolCall[],
	attachImages: (result: Record<string, unknown>, images: BuiltinGeneratedImage[]) => void,
): Record<string, unknown> {
	for (const turn of previous) {
		if (turn !== result) {
			addResponseUsage(result, turn);
		}
	}
	attachImages(result, images);
	appendPrivateImageToolCalls(result, calls);
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
		/** Per-request router-owned completion history. */
		imageHistory?: ImageCompletionHistory;
		/** Shared output positions for fresh and idempotently replayed results. */
		targets?: ImageGenerationTargets;
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
	const targets = options.targets ?? new ImageGenerationTargets(options.imageHistory?.continuingAssets);
	const target = targets.validate(args.target);
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
	const generate = async () => {
		let lastError: unknown;
		let workerUpstream: UpstreamLogContext | undefined;
		for (const capabilityModel of [...new Set([binding.handlerModel, ...binding.fallbackModels])]) {
			const startTime = new Date();
			let captured: Awaited<ReturnType<typeof captureUpstreamExchange<Record<string, unknown>>>>;
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
				captured = await captureUpstreamExchange(runExecutor);
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
				continue;
			}
			const raw = captured.result;
			workerUpstream = captured.context;
			const spendInfo = raw["_spendInfo"] as { customCostPerToken?: Parameters<typeof calculateAndSetCost>[2] } | undefined;
			calculateAndSetCost(raw as unknown as ModelResponse, capabilityModel, spendInfo?.customCostPerToken);
			let generated: BuiltinGeneratedImage[];
			try {
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
				generated = await normalizeGeneratedImages(raw, args.action, args.prompt, capabilityModel, store);
			} catch (error) {
				if (error instanceof ApiError && error.statusCode === 400) {
					throw ApiError.unavailable("Image executor completed, but its result could not be recorded");
				}
				throw error;
			}
			return {
				raw: raw,
				model: capabilityModel,
				images: generated,
			};
		}
		throw lastError ?? ApiError.unavailable("图片生成能力没有可用的执行模型");
	};
	const execution = options.imageHistory
		? await options.imageHistory.execute(
				options.toolCallId ?? "image_generation_call",
				args.action,
				args.prompt,
				store,
				generate,
				target.index,
				target.count,
			)
		: await generate();
	targets.complete(args.target, execution.images);
	return { ...execution, text: targets.receipt(args.target, "completed") };
}

function extractAssistant(result: Record<string, unknown>): Record<string, unknown> {
	const choice = Array.isArray(result["choices"]) ? (result["choices"][0] as Record<string, unknown> | undefined) : undefined;
	const message = choice?.["message"];
	if (typeof message !== "object" || message === null) {
		throw ApiError.unavailable("主模型没有返回可解析的 assistant message");
	}
	return message as Record<string, unknown>;
}

/**
 * Honor structured output and required public tool choices even if the private call proposes a caption.
 * @param body
 */
function needsModelReply(body: Record<string, unknown>): boolean {
	const format =
		recordValue(body.response_format) ??
		recordValue(body.output_format) ??
		recordValue(recordValue(body.output_config)?.format) ??
		recordValue(recordValue(body.text)?.format);
	const choice = recordValue(body.tool_choice)?.type ?? body.tool_choice;
	return (
		format?.type === "json_schema" ||
		format?.type === "json_object" ||
		choice === "required" ||
		choice === "any" ||
		choice === "tool" ||
		choice === "function"
	);
}

function hasPublicReplyContent(content: unknown): boolean {
	if (!Array.isArray(content)) {
		return typeof content === "string" ? content.trim().length > 0 : content != null;
	}
	return content.some((block) => {
		const part = recordValue(block);
		if (!part) {
			return typeof block === "string" && block.trim().length > 0;
		}
		if (part.type === "thinking" || part.type === "redacted_thinking") {
			return false;
		}
		return typeof part.text === "string" ? part.text.trim().length > 0 : part.type !== "text";
	});
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
		/** Per-request router-owned completion history. */
		imageHistory?: ImageCompletionHistory;
		/** Shared by all hidden main-model continuations in this incoming request. */
		targets?: ImageGenerationTargets;
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
	const targets = options.targets ?? new ImageGenerationTargets(options.imageHistory?.continuingAssets);
	const privateToolCalls: BuiltinPrivateImageToolCall[] = [];
	const consumed: Record<string, unknown>[] = [];
	let pendingToolCallIds: string[] = [];
	let retriedFinalReply = false;
	let maxTurns = prepared.binding.maxIterations;
	for (let iteration = 0; iteration < maxTurns || (iteration === maxTurns && targets.finished); iteration++) {
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
		const allCalls = privateCallsFromAssistant(assistant);
		const calls = allCalls
			.map((call) => ({ call: call, descriptor: privateImageToolCallFromToolCall(call) }))
			.filter(({ descriptor }) => {
				if (targets.accepts(descriptor.arguments)) {
					return true;
				}
				privateToolCalls.push({ ...descriptor, skipped: "output_already_resolved" });
				return false;
			});
		if (allCalls.length && !calls.length) {
			const publicCalls = (assistant["tool_calls"] as ToolCall[]).filter((call) => !allCalls.includes(call));
			// A repeated private call can otherwise swallow the caption or JSON that the user requested.
			if (
				targets.finished &&
				!retriedFinalReply &&
				!publicCalls.length &&
				!hasPublicReplyContent(assistant.content) &&
				!assistant.refusal &&
				!assistant.audio
			) {
				retriedFinalReply = true;
				maxTurns++;
				consumed.push(result);
				transcript.push({ ...assistant, tool_calls: allCalls });
				for (const call of allCalls) {
					const input = privateImageToolCallFromToolCall(call).arguments;
					transcript.push({ role: "tool", tool_call_id: call.id, content: targets.receipt(input, "skipped") });
					pendingToolCallIds.push(call.id);
				}
				continue;
			}
			const choice = (result["choices"] as Record<string, unknown>[])[0]!;
			if (publicCalls.length) {
				assistant["tool_calls"] = publicCalls;
				choice["finish_reason"] = "tool_calls";
			} else {
				delete assistant["tool_calls"];
				choice["finish_reason"] = "stop";
			}
		}
		if (calls.length === 0) {
			return finalizeImageReply(result, consumed, targets.images, privateToolCalls, appendGeneratedImages);
		}
		const batchError = targets.batchError(calls.map(({ descriptor }) => descriptor.arguments));
		const handled: ToolCall[] = [];
		transcript.push({ ...assistant, tool_calls: handled });
		consumed.push(result);
		for (const { call, descriptor } of calls) {
			if (!targets.accepts(descriptor.arguments)) {
				privateToolCalls.push({ ...descriptor, skipped: "output_already_resolved" });
				continue;
			}
			handled.push(call);
			privateToolCalls.push(descriptor);
			const outcome = await capturePrivateToolCallOutcome(() => {
				if (batchError) {
					throw ApiError.badRequest(batchError);
				}
				return executeImageGenerationToolCall(
					router,
					prepared.binding,
					prepared.images,
					call.function.name,
					call.function.arguments,
					{
						audit: options.audit,
						toolCallId: call.id,
						imageStore: prepared.imageStore,
						imageHistory: options.imageHistory,
						targets: targets,
					},
				);
			});
			pendingToolCallIds.push(call.id);
			if (outcome.status === "argument_error") {
				transcript.push({ role: "tool", tool_call_id: call.id, content: outcome.text });
				continue;
			}
			const executed = outcome.result;
			consumed.push(executed.raw);
			for (const image of executed.images) {
				prepared.images.set(image.ref, (await prepared.imageStore.get(image.ref))!);
			}
			transcript.push({ role: "tool", tool_call_id: call.id, content: executed.text });
		}
		const directReply = targets.directReply;
		if (
			directReply !== undefined &&
			!needsModelReply(optionalParams) &&
			(assistant.tool_calls as ToolCall[]).length === allCalls.length
		) {
			delete assistant.tool_calls;
			assistant.content = directReply;
			if (directReply !== null) {
				result["_builtinImageCaption"] = directReply;
			}
			(result.choices as Record<string, unknown>[])[0]!.finish_reason = "stop";
			return finalizeImageReply(result, consumed, targets.images, privateToolCalls, appendGeneratedImages);
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
		/** Per-request router-owned completion history. */
		imageHistory?: ImageCompletionHistory;
		/** Shared by all hidden main-model continuations in this incoming request. */
		targets?: ImageGenerationTargets;
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
	const targets = options.targets ?? new ImageGenerationTargets(options.imageHistory?.continuingAssets);
	const privateToolCalls: BuiltinPrivateImageToolCall[] = [];
	const consumed: Record<string, unknown>[] = [];
	let retriedFinalReply = false;
	let maxTurns = prepared.binding.maxIterations;
	for (let iteration = 0; iteration < maxTurns || (iteration === maxTurns && targets.finished); iteration++) {
		const response = await complete(requestBody);
		const content = Array.isArray(response["content"]) ? (response["content"] as Array<Record<string, unknown>>) : [];
		const allUses = content.filter(
			(block) =>
				block["type"] === "tool_use" &&
				(block["name"] === PRIVATE_IMAGE_CREATE_TOOL_NAME || block["name"] === PRIVATE_IMAGE_EDIT_TOOL_NAME),
		);
		const toolUses = allUses
			.map((use) => ({ use: use, descriptor: privateImageToolCallFromInput(String(use.id ?? ""), String(use.name), use.input) }))
			.filter(({ descriptor }) => {
				if (targets.accepts(descriptor.arguments)) {
					return true;
				}
				privateToolCalls.push({ ...descriptor, skipped: "output_already_resolved" });
				return false;
			});
		if (allUses.length && !toolUses.length) {
			const visible = content.filter((block) => !allUses.includes(block));
			if (targets.finished && !retriedFinalReply && !hasPublicReplyContent(visible)) {
				retriedFinalReply = true;
				maxTurns++;
				consumed.push(response);
				const messages = Array.isArray(requestBody.messages) ? requestBody.messages : [];
				const results = allUses.map((use) => {
					const input = recordValue(use.input);
					return { type: "tool_result", tool_use_id: use.id, content: targets.receipt(input ?? {}, "skipped") };
				});
				requestBody = {
					...requestBody,
					messages: [...messages, { role: "assistant", content: content }, { role: "user", content: results }],
				};
				continue;
			}
			response["content"] = visible;
			response["stop_reason"] = visible.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn";
		}
		if (toolUses.length === 0) {
			return {
				response: finalizeImageReply(response, consumed, targets.images, privateToolCalls, appendAnthropicGeneratedImages),
				body: requestBody,
			};
		}
		const batchError = targets.batchError(toolUses.map(({ descriptor }) => descriptor.arguments));
		consumed.push(response);
		const toolResults = [];
		const handled = new Set<unknown>();
		for (const { use, descriptor } of toolUses) {
			if (!targets.accepts(descriptor.arguments)) {
				privateToolCalls.push({ ...descriptor, skipped: "output_already_resolved" });
				continue;
			}
			handled.add(use.id);
			privateToolCalls.push(descriptor);
			const outcome = await capturePrivateToolCallOutcome(() => {
				if (batchError) {
					throw ApiError.badRequest(batchError);
				}
				return executeImageGenerationToolCall(
					router,
					prepared.binding,
					prepared.images,
					String(use["name"]),
					anthropicInputArguments(use["input"]),
					{
						audit: options.audit,
						toolCallId: String(use["id"] ?? "image_generation_call"),
						imageStore: prepared.imageStore,
						imageHistory: options.imageHistory,
						targets: targets,
					},
				);
			});
			if (outcome.status === "argument_error") {
				toolResults.push({ type: "tool_result", tool_use_id: use["id"], content: outcome.text, is_error: true });
				continue;
			}
			const executed = outcome.result;
			consumed.push(executed.raw);
			for (const image of executed.images) {
				prepared.images.set(image.ref, (await prepared.imageStore.get(image.ref))!);
			}
			toolResults.push({ type: "tool_result", tool_use_id: use["id"], content: executed.text });
		}
		const directReply = targets.directReply;
		if (
			directReply !== undefined &&
			!needsModelReply(body) &&
			!content.some((block) => block.type === "tool_use" && !allUses.includes(block))
		) {
			response["content"] = directReply === null ? [] : [{ type: "text", text: directReply }];
			response["stop_reason"] = "end_turn";
			return {
				response: finalizeImageReply(response, consumed, targets.images, privateToolCalls, appendAnthropicGeneratedImages),
				body: requestBody,
			};
		}
		const privateContent = content.filter((block) => block["type"] !== "tool_use" || handled.has(block.id));
		const messages = Array.isArray(requestBody["messages"]) ? requestBody["messages"] : [];
		requestBody = {
			...requestBody,
			messages: [...messages, { role: "assistant", content: privateContent }, { role: "user", content: toolResults }],
		};
	}
	throw ApiError.unavailable(`图片生成处理超过 ${prepared.binding.maxIterations} 轮仍未完成`);
}
