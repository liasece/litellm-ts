import type { Message, ModelResponse } from "../types/openai";
import type { ProviderRequest } from "../types/provider";
import {
	SUBSCRIPTION_PROVIDERS,
	hostedProvider,
	withoutProvider,
	type SubscriptionConnection,
	type SubscriptionProvider as SubscriptionProviderId,
} from "../subscriptions/SubscriptionProviders";
import { subscriptionBridgeUrl } from "../subscriptions/native/bridge";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/** 不应进入订阅请求体的 LiteLLM/Router 内部字段。 */
const CONNECTION_KEYS = [
	"api_base",
	"api_key",
	"custom_llm_provider",
	"subscription_transport",
	"litellm_credential_name",
	"credential_name",
	"rpm",
	"tpm",
	"timeout",
	"stream_timeout",
	"num_retries",
	"custom_cost_per_token",
	"supported_endpoints",
	"drop_params",
	"__litellm_call_type",
	"__litellm_responses_body",
	"__litellm_image_edit_inputs",
] as const;

/**
 * 构造订阅 Provider 请求。
 *
 * 这里只负责把客户端请求整理成入口协议请求体，并把地址标记为进程内 bridge；
 * 账号选择、OAuth 刷新、协议转换与上游 HTTP 都在 SubscriptionBridge 内完成。
 */
export class SubscriptionProvider extends OpenAICompatProvider {
	private readonly _provider: SubscriptionProviderId;
	private readonly _source: (typeof SUBSCRIPTION_PROVIDERS)[SubscriptionProviderId]["source"];

	constructor(providerId: SubscriptionProviderId, _connection?: SubscriptionConnection) {
		super("", "litellm-subscription://");
		this._provider = providerId;
		this._source = SUBSCRIPTION_PROVIDERS[providerId].source;
	}

	/**
	 * 去掉公开 provider 前缀，得到上游模型 ID。
	 * @param model - 配置中的模型
	 */
	private _model(model: string): string {
		const explicit = hostedProvider({ model: model, custom_llm_provider: this._provider });
		return withoutProvider(model, explicit ?? this._provider);
	}

	/**
	 * 清理 Router/LiteLLM 内部字段。
	 * @param body - 原始请求体
	 */
	private _cleanBody(body: Record<string, unknown>): Record<string, unknown> {
		const result = { ...body };
		for (const key of CONNECTION_KEYS) {
			delete result[key];
		}
		return result;
	}

	/**
	 * 构造 Chat/Messages 入口请求。
	 * @param model - 配置模型
	 * @param messages - 会话
	 * @param optionalParams - 协议参数
	 */
	override transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		const upstreamModel = this._model(model);
		const anthropicNative = typeof optionalParams["anthropic_version"] === "string";
		const operation = anthropicNative ? "messages" : "chat";
		const body = anthropicNative
			? { model: upstreamModel, messages: messages }
			: {
					...this._cleanBody(optionalParams),
					model: upstreamModel,
					messages: messages,
				};
		return {
			url: subscriptionBridgeUrl(this._source, operation),
			method: "POST",
			headers: anthropicNative
				? { "Content-Type": "application/json", "anthropic-version": String(optionalParams["anthropic_version"]) }
				: { "Content-Type": "application/json" },
			body: body,
			model: model,
			stream: optionalParams["stream"] === true,
		};
	}

	/**
	 * 构造 Anthropic Messages 入口请求；请求体由端点替换为完整的 Messages body。
	 * @param model - 配置模型
	 * @param optionalParams - 协议参数
	 */
	override transformAnthropicRequest(model: string, optionalParams: Record<string, unknown>): ProviderRequest {
		return {
			url: subscriptionBridgeUrl(this._source, "messages"),
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"anthropic-version":
					typeof optionalParams["anthropic_version"] === "string" ? optionalParams["anthropic_version"] : "2023-06-01",
			},
			body: { model: this._model(model) },
			model: model,
			stream: true,
		};
	}

	/**
	 * 构造 Responses 入口请求。
	 * @param model - 配置模型
	 * @param body - Responses 请求体
	 * @param _optionalParams - 协议参数（订阅上游不接受按 deployment 覆盖连接）
	 */
	override transformResponsesRequest(
		model: string,
		body: Record<string, unknown>,
		_optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const payload: Record<string, unknown> = {
			...this._cleanBody(body),
			model: this._model(model),
			store: body["store"] ?? false,
		};
		return {
			url: subscriptionBridgeUrl(this._source, "responses"),
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: payload,
			model: model,
			stream: body["stream"] === true,
			responseProtocol: "responses",
		};
	}

	/**
	 * 构造图片生成入口请求。
	 * @param model - 配置模型
	 * @param prompt - 提示词
	 * @param optionalParams - 输出参数
	 */
	transformImageRequest(model: string, prompt: string, optionalParams: Record<string, unknown>): ProviderRequest {
		const body: Record<string, unknown> = {
			...this._cleanBody(optionalParams),
			model: this._model(model),
			prompt: prompt,
		};
		return {
			url: subscriptionBridgeUrl(this._source, "images/generations"),
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: body,
			model: model,
			stream: false,
		};
	}

	/**
	 * 构造图片编辑入口请求；multipart body 由桥接层原样转发。
	 * @param model - 配置模型
	 * @param prompt - 编辑提示
	 * @param images - 源图
	 * @param optionalParams - 输出/掩码参数
	 */
	transformImageEditRequest(
		model: string,
		prompt: string,
		images: Array<{ data: Uint8Array; mediaType: string }>,
		optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const form = new FormData();
		form.append("model", this._model(model));
		form.append("prompt", prompt);
		images.forEach((image, index) => {
			const extension = image.mediaType === "image/jpeg" ? "jpg" : image.mediaType === "image/webp" ? "webp" : "png";
			form.append("image", new Blob([image.data as never], { type: image.mediaType }), `image-${index + 1}.${extension}`);
		});
		const logBody: Record<string, unknown> = {
			model: this._model(model),
			prompt: prompt,
			image: images.map((image) => ({ media_type: image.mediaType, byte_length: image.data.byteLength })),
		};
		for (const [key, value] of Object.entries(optionalParams)) {
			if (
				value === undefined ||
				value === null ||
				(CONNECTION_KEYS as readonly string[]).includes(key)
			) {
				continue;
			}
			if (key === "mask" && typeof value === "object" && value !== null && "data" in value) {
				const mask = value as { data: Uint8Array; mediaType: string };
				form.append("mask", new Blob([mask.data as never], { type: mask.mediaType }), "mask.png");
				logBody["mask"] = { media_type: mask.mediaType, byte_length: mask.data.byteLength };
				continue;
			}
			if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
				form.append(key, String(value));
				logBody[key] = value;
			}
		}
		return {
			url: subscriptionBridgeUrl(this._source, "images/edits"),
			method: "POST",
			headers: {},
			body: form,
			bodyEncoding: "raw",
			logBody: logBody,
			model: model,
			stream: false,
		};
	}

	/**
	 * 桥接层已经把响应翻译回入口协议，这里保持原样。
	 * @param _model - 配置模型
	 * @param rawResponse - 入口协议响应
	 */
	override transformResponse(_model: string, rawResponse: unknown): ModelResponse {
		return rawResponse as ModelResponse;
	}
}
