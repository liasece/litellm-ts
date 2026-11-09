import type { LoggingCallback, AvailableCallbacks } from "../api/LoggingSettingsApi";
export function callbackParameters(name: string, available: AvailableCallbacks, fallback: Record<string, unknown> = {}): string[] {
	const info = available[name];
	const raw =
		info && typeof info === "object" && !Array.isArray(info) ? (info as Record<string, unknown>).litellm_callback_params : undefined;
	const params: unknown[] = Array.isArray(raw) ? raw : [];
	const names = params.filter((value): value is string => typeof value === "string");
	return names.length ? names : Object.keys(fallback);
}
export function callbackPayload(values: Record<string, unknown>, name: string) {
	return { environment_variables: { ...values }, litellm_settings: { success_callback: [name] } };
}
export function emailServerPayload(alerts: LoggingCallback[], values: Record<string, string>) {
	const environment: Record<string, string> = {};
	for (const alert of alerts.filter((alert) => alert.name === "email"))
		for (const name of Object.keys(alert.variables)) {
			if (values[name]) environment[name] = values[name];
		}
	return { general_settings: { alerting: ["email"] }, environment_variables: environment };
}
