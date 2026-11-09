import type { Message, ModelResponse } from "../types/openai";
import type { ProviderRequest } from "../types/provider";
import { LlmProviders } from "../types/provider";
import { subscriptionTarget, type HostedProvider, type SubscriptionConnection } from "../subscriptions/SubscriptionProviders";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/** Builds public protocol requests for one subscription account source. */
export class SubscriptionProvider extends OpenAICompatProvider {
	constructor(
		private readonly _source: HostedProvider,
		private readonly _connection: SubscriptionConnection = {
			internalApiKey: process.env["CLIPROXY_INTERNAL_API_KEY"] ?? "",
			baseUrl: process.env["CLIPROXY_INTERNAL_BASE_URL"] ?? "http://127.0.0.1:8317",
			sourceBuiltSubscriptions: _source !== LlmProviders.CLIProxy,
		},
		private readonly _transport?: unknown,
	) {
		super(_connection.internalApiKey, _connection.baseUrl);
	}

	private _target(model: string, path: string): { url: string; model: string } {
		return subscriptionTarget(
			this._connection,
			{ model: model, custom_llm_provider: this._source, subscription_transport: this._transport },
			path,
		);
	}

	/**
	 * Build the internal CLIProxy request while keeping connection settings out of its body.
	 * @param model - Configured model name, including any provider prefix.
	 * @param messages - Conversation history to forward to CLIProxy.
	 * @param optionalParams - Protocol options and internal connection settings.
	 */
	override transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		const anthropicNative = typeof optionalParams["anthropic_version"] === "string";
		const target = this._target(model, anthropicNative ? "/v1/messages" : "/v1/chat/completions");
		const apiKey = this._connection.internalApiKey;
		if (anthropicNative) {
			return {
				url: target.url,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": apiKey,
					"anthropic-version": optionalParams["anthropic_version"] as string,
				},
				body: { model: target.model, messages: messages },
				model: model,
				stream: optionalParams["stream"] === true,
			};
		}

		const body: Record<string, unknown> = {
			...optionalParams,
			model: target.model,
			messages: messages,
		};
		for (const connectionKey of [
			"api_base",
			"api_key",
			"custom_llm_provider",
			"subscription_transport",
			"litellm_credential_name",
			"rpm",
			"tpm",
			"timeout",
			"stream_timeout",
			"num_retries",
			"custom_cost_per_token",
		]) {
			delete body[connectionKey];
		}
		return {
			url: target.url,
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: body,
			model: model,
			stream: optionalParams["stream"] === true,
		};
	}

	/**
	 * Build a native Responses request for CLIProxy.
	 *
	 * CLIProxy 的 \`/v1/responses\` 对其模型始终可用，不受 deployment 的
	 * \`supported_endpoints\` 元数据约束；web capability worker 依赖该出口取得
	 * 上游托管的 \`web_search\` 工具，因此这里不复用 OpenAI-compat 的门禁判断。
	 * @param model - Configured model name, including any provider prefix.
	 * @param body - Responses request body.
	 * @param _optionalParams - 内部连接参数（CLIProxy 内网出口不接受按 deployment 覆盖）。
	 */
	override transformResponsesRequest(
		model: string,
		body: Record<string, unknown>,
		_optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const target = this._target(model, "/v1/responses");
		const apiKey = this._connection.internalApiKey;
		const payload: Record<string, unknown> = {
			...body,
			model: target.model,
			store: body["store"] ?? false,
		};
		// drop_params 是 LiteLLM 自身的转发策略，任何上游都不应收到；漏删会让 CLIProxy
		// 在 fallback 场景下返回 400 Unsupported parameter: drop_params。
		for (const connectionKey of [
			"api_base",
			"api_key",
			"custom_llm_provider",
			"subscription_transport",
			"supported_endpoints",
			"litellm_credential_name",
			"drop_params",
		]) {
			delete payload[connectionKey];
		}
		return {
			url: target.url,
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: payload,
			model: model,
			stream: body["stream"] === true,
			responseProtocol: "responses",
		};
	}

	/**
	 * Build a native image generation request with internal CLIProxy credentials.
	 * @param model - Configured image model name.
	 * @param prompt - Image generation prompt.
	 * @param optionalParams - Image output options and internal connection settings.
	 */
	transformImageRequest(model: string, prompt: string, optionalParams: Record<string, unknown>): ProviderRequest {
		const target = this._target(model, "/v1/images/generations");
		const apiKey = this._connection.internalApiKey;
		const body: Record<string, unknown> = {
			...optionalParams,
			model: target.model,
			prompt: prompt,
		};
		for (const connectionKey of [
			"__litellm_call_type",
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
		]) {
			delete body[connectionKey];
		}
		return {
			url: target.url,
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: body,
			model: model,
			stream: false,
		};
	}

	/**
	 * Build the multipart request used by the native OpenAI-compatible image edit endpoint.
	 * @param model - Image model name
	 * @param prompt - Editing prompt
	 * @param images - Source image bytes
	 * @param optionalParams - Image output and mask options
	 */
	transformImageEditRequest(
		model: string,
		prompt: string,
		images: Array<{ data: Uint8Array; mediaType: string }>,
		optionalParams: Record<string, unknown>,
	): ProviderRequest {
		const target = this._target(model, "/v1/images/edits");
		const apiKey = this._connection.internalApiKey;
		const form = new FormData();
		form.append("model", target.model);
		form.append("prompt", prompt);
		images.forEach((image, index) => {
			const extension = image.mediaType === "image/jpeg" ? "jpg" : image.mediaType === "image/webp" ? "webp" : "png";
			form.append("image", new Blob([image.data as never], { type: image.mediaType }), `image-${index + 1}.${extension}`);
		});
		const logBody: Record<string, unknown> = {
			model: target.model,
			prompt: prompt,
			image: images.map((image) => ({ media_type: image.mediaType, byte_length: image.data.byteLength })),
		};
		for (const [key, value] of Object.entries(optionalParams)) {
			if (
				value === undefined ||
				value === null ||
				[
					"__litellm_call_type",
					"__litellm_image_edit_inputs",
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
				].includes(key)
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
			url: target.url,
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form,
			bodyEncoding: "raw",
			logBody: logBody,
			model: model,
			stream: false,
		};
	}

	/**
	 * Preserve CLIProxy's response body, including provider-specific extensions.
	 * @param model - Configured model name required by the provider interface.
	 * @param rawResponse - OpenAI-compatible response returned by CLIProxy.
	 */
	override transformResponse(model: string, rawResponse: unknown): ModelResponse {
		// CLIProxy already emits OpenAI-compatible responses. Preserve provider-
		// specific fields rather than normalizing and potentially dropping them.
		return rawResponse as ModelResponse;
	}
}
