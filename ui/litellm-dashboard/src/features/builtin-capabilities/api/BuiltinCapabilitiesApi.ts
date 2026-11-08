import { z } from "zod";
import { dashboardFetch, getApiBaseUrl } from "../../platform/api/HttpApiClient";
import type { Capabilities } from "../support/BuiltinCapabilitiesModels";
const executor = z.discriminatedUnion("type", [
	z.object({ type: z.literal("model"), model: z.string(), max_output_tokens: z.number().optional() }).passthrough(),
	z
		.object({
			type: z.literal("deepseek_tools"),
			api_base: z.string(),
			credential_name: z.string(),
			timeout_ms: z.number(),
			search_count: z.number(),
			search_need_content: z.boolean(),
			localization: z.string(),
		})
		.passthrough(),
]);
const settings = z
	.object({
		enabled: z.boolean(),
		always_inject: z.boolean(),
		handler_model: z.string(),
		executors: z.array(executor),
		max_iterations: z.number(),
		max_output_tokens: z.number(),
	})
	.passthrough();
const candidate = z.object({ model_name: z.string(), type: z.enum(["model", "alias"]), mode: z.string() }).passthrough();
const response = z
	.object({
		capabilities: z.object({ vision: settings, image_generation: settings, web: settings }),
		available_models: z.array(candidate),
		image_generation_available_models: z.array(candidate),
		web_available_models: z.array(candidate),
	})
	.passthrough();
async function request(method: "GET" | "PUT", capabilities?: Capabilities) {
	const result = await dashboardFetch(getApiBaseUrl() + "/builtin-capabilities", {
		method,
		headers: { "Content-Type": "application/json" },
		...(capabilities ? { body: JSON.stringify(capabilities) } : {}),
	});
	if (!result.ok)
		throw new Error(
			(await result.text()) ||
				"Built-in capabilities " + (method === "PUT" ? "update" : "query") + " failed with HTTP " + result.status,
		);
	return response.parse(await result.json());
}
export const builtinCapabilitiesApi = {
	load: () => request("GET"),
	save: (capabilities: Capabilities) => request("PUT", capabilities),
	credentials: async () => {
		const result = await dashboardFetch(getApiBaseUrl() + "/credentials", { headers: { "Content-Type": "application/json" } });
		if (!result.ok) throw new Error("Failed to get credentials");
		return z
			.object({ credentials: z.array(z.object({ credential_name: z.string() }).passthrough()) })
			.passthrough()
			.parse(await result.json())
			.credentials.map(({ credential_name }) => ({ value: credential_name, label: credential_name }));
	},
};
export type BuiltinCapabilitiesApi = typeof builtinCapabilitiesApi;
