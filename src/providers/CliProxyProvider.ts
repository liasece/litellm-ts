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

	override transformResponse(model: string, rawResponse: unknown): ModelResponse {
		// CLIProxy already emits OpenAI-compatible responses. Preserve provider-
		// specific fields rather than normalizing and potentially dropping them.
		return rawResponse as ModelResponse;
	}

	private _cliproxyNormalizeBase(value: string | undefined): string {
		return (value && value.length > 0 ? value : "http://127.0.0.1:8317").replace(/\/+$/, "");
	}
}
