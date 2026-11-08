import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import { proxyConfigApi } from "../../proxy-config/api/ProxyConfigApi";
const record = z.record(z.string(), z.unknown());
const callback = z.object({ name: z.string(), variables: record.default({}), mode: z.string().optional() }).passthrough();
const configuration = z
	.object({
		id: z.string(),
		displayName: z.string(),
		logo: z.string().nullish(),
		dynamic_params: z.record(z.string(), record).optional(),
	})
	.passthrough();
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
const event = z.object({ event: z.string(), enabled: z.boolean() }).passthrough();
export type LoggingCallback = z.infer<typeof callback>;
export type CallbackConfiguration = z.infer<typeof configuration>;
export type CallbackState = z.infer<typeof state>;
export type EmailEventSetting = z.infer<typeof event>;
export const loggingSettingsApi = {
	load: () => requestJson("/get/config/callbacks", {}, (value) => state.parse(value)),
	configurations: () => requestJson("/callbacks/configs", {}, (value) => z.array(configuration).parse(value)),
	update: proxyConfigApi.update,
	remove: (name: string) => requestJson("/config/callback/delete", { method: "POST", body: JSON.stringify({ callback_name: name }) }),
	test: (name: string) => requestJson("/health/services?" + new URLSearchParams({ service: name })),
	alertParameters: () => requestJson("/alerting/settings", {}, (value) => z.array(record).parse(value)),
	updateField: (name: string, value: unknown) => proxyConfigApi.updateField("general_settings", name, value),
	emailEvents: () => requestJson("/email/event_settings", {}, (value) => z.object({ settings: z.array(event) }).parse(value).settings),
	saveEmailEvents: (settings: EmailEventSetting[]) =>
		requestJson("/email/event_settings", { method: "PATCH", body: JSON.stringify({ settings }) }),
	resetEmailEvents: () => requestJson("/email/event_settings/reset", { method: "POST" }),
};
