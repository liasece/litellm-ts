import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import { proxyConfigApi } from "../../proxy-config/api/ProxyConfigApi";
const record = z.record(z.string(), z.unknown());
export const routerSettingsApi = {
	costs: () => requestJson("/public/litellm_model_cost_map", {}, (value) => record.parse(value)),
	load: () => requestJson("/get/config/callbacks", {}, (value) => record.parse(value)),
	metadata: () => requestJson("/router/settings", {}, (value) => record.parse(value)),
	general: () => proxyConfigApi.list(),
	update: proxyConfigApi.update,
	updateField: (name: string, value: unknown) => proxyConfigApi.updateField("general_settings", name, value),
	resetField: (name: string) => proxyConfigApi.deleteField("general_settings", name),
	candidates: () =>
		requestJson("/config/routable_model/options", {}, (value) => {
			const parsed = Array.isArray(value) ? value : record.parse(value).data;
			return z.array(z.object({ model_name: z.string(), type: z.string().optional() }).passthrough()).parse(parsed || []);
		}),
	hub: () => requestJson("/model_group/info", {}, (value) => z.object({ data: z.array(record) }).parse(value).data),
	testFallback: (name: string) =>
		requestJson(
			"/chat/completions",
			{
				method: "POST",
				body: JSON.stringify({
					model: name,
					messages: [{ role: "user", content: "Hi, this is a test message" }],
					mock_testing_fallbacks: true,
				}),
			},
			(value) => record.parse(value),
		),
};
