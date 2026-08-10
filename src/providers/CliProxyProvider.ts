import type { Message, ModelResponse } from "../types/openai";
import type { ProviderRequest } from "../types/provider";
import { OpenAICompatProvider } from "./OpenAICompatProvider";

/**
 * Internal CLIProxy provider.
 *
 * Chat Completions stays OpenAI-native: the complete request body is forwarded
 * instead of being filtered through a provider parameter allow-list.
 * AnthropicMessagesEndpoint signals an Anthropic-native request by passing
 * anthropic_version and forwards its original body itself.
 */
export class CliProxyProvider extends OpenAICompatProvider {
	constructor(
		apiKey = process.env["CLIPROXY_INTERNAL_API_KEY"] ?? "",
		apiBase = process.env["CLIPROXY_INTERNAL_BASE_URL"] ?? "http://127.0.0.1:8317",
	) {
		super(apiKey, apiBase);
	}

	override transformRequest(model: string, messages: Message[], optionalParams: Record<string, unknown>): ProviderRequest {
		const providerModel = this.stripProviderPrefix(model);
		const apiBase = this._cliproxyNormalizeBase(process.env["CLIPROXY_INTERNAL_BASE_URL"] ?? this.apiBase);
		// Never accept a deployment or caller key for the internal hop. The
		// runtime key is process-local and is not part of model configuration.
		const apiKey = process.env["CLIPROXY_INTERNAL_API_KEY"] ?? this.apiKey;
		const anthropicNative = typeof optionalParams["anthropic_version"] === "string";
		if (anthropicNative) {
			return {
				url: `${apiBase}/v1/messages`,
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": apiKey,
					"anthropic-version": optionalParams["anthropic_version"] as string,
				},
				body: { model: providerModel, messages },
				model,
				stream: optionalParams["stream"] === true,
			};
		}

		const body: Record<string, unknown> = {
			...optionalParams,
			model: providerModel,
			messages,
		};
		for (const connectionKey of [
			"api_base",
			"api_key",
			"custom_llm_provider",
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
			url: `${apiBase}/v1/chat/completions`,
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body,
			model,
			stream: optionalParams["stream"] === true,
		};
	}

	transformImageRequest(model: string, prompt: string, optionalParams: Record<string, unknown>): ProviderRequest {
		const providerModel = this.stripProviderPrefix(model);
		const apiBase = this._cliproxyNormalizeBase(process.env["CLIPROXY_INTERNAL_BASE_URL"] ?? this.apiBase);
		const apiKey = process.env["CLIPROXY_INTERNAL_API_KEY"] ?? this.apiKey;
		const body: Record<string, unknown> = {
			...optionalParams,
			model: providerModel,
			prompt: prompt,
		};
		for (const connectionKey of [
			"__litellm_call_type",
			"api_base",
			"api_key",
			"custom_llm_provider",
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
			url: `${apiBase}/v1/images/generations`,
			method: "POST",
			headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
			body: body,
			model: model,
			stream: false,
		};
	}

	/** Build the multipart request used by the native OpenAI-compatible image edit endpoint.
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
		const providerModel = this.stripProviderPrefix(model);
		const apiBase = this._cliproxyNormalizeBase(process.env["CLIPROXY_INTERNAL_BASE_URL"] ?? this.apiBase);
		const apiKey = process.env["CLIPROXY_INTERNAL_API_KEY"] ?? this.apiKey;
		const form = new FormData();
		form.append("model", providerModel);
		form.append("prompt", prompt);
		images.forEach((image, index) => {
			const extension = image.mediaType === "image/jpeg" ? "jpg" : image.mediaType === "image/webp" ? "webp" : "png";
			form.append("image", new Blob([image.data as never], { type: image.mediaType }), `image-${index + 1}.${extension}`);
		});
		const logBody: Record<string, unknown> = {
			model: providerModel,
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
			url: `${apiBase}/v1/images/edits`,
			method: "POST",
			headers: { Authorization: `Bearer ${apiKey}` },
			body: form,
			bodyEncoding: "raw",
			logBody: logBody,
			model: model,
			stream: false,
		};
	}

	override transformResponse(model: string, rawResponse: unknown): ModelResponse {
		// CLIProxy already emits OpenAI-compatible responses. Preserve provider-
		// specific fields rather than normalizing and potentially dropping them.
		return rawResponse as ModelResponse;
	}

	private _cliproxyNormalizeBase(value: string | undefined): string {
		return (value && value.length > 0 ? value : "http://127.0.0.1:8317").replace(/\/+$/, "");
	}
}
