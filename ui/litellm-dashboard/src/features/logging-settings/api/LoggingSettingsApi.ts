import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import { proxyConfigApi } from "../../proxy-config/api/ProxyConfigApi";
const record = z.record(z.string(), z.unknown());
const callback = z.object({ name: z.string(), variables: record.default({}), mode: z.string().optional() }).passthrough();
const state = z
	.object({
		callbacks: z
			.array(callback)
			.nullish()
			.transform((value) => value || []),
		alerts: z
			.array(callback)
			.nullish()
			.transform((value) => value || []),
		available_callbacks: z.union([record, z.array(z.unknown())]).optional(),
	})
	.passthrough();
export type LoggingCallback = z.infer<typeof callback>;
export type CallbackState = z.infer<typeof state>;
export type AvailableCallbacks = Record<string, unknown>;
export const loggingSettingsApi = {
	load: () => requestJson("/get/config/callbacks", {}, (value) => state.parse(value)),
	update: proxyConfigApi.update,
	test: (name: string) => requestJson("/health/services?" + new URLSearchParams({ service: name })),
};
