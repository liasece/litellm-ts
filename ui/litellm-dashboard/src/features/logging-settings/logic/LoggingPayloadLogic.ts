import type { LoggingCallback, CallbackConfiguration } from "../api/LoggingSettingsApi";
export function callbackParameters(
	name: string,
	configurations: CallbackConfiguration[],
	fallback: Record<string, unknown> = {},
): string[] {
	const config = configurations.find((config) => config.id === name);
	return config?.dynamic_params ? Object.keys(config.dynamic_params) : Object.keys(fallback);
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
export function emailEventDescription(event: string): string {
	if (event.includes("Virtual Key Created"))
		return "An email will be sent to the user when a new virtual key is created with their user ID";
	if (event.includes("New User Invitation")) return "An email will be sent to the email address of the user when a new user is created";
	return (
		"Receive an email notification when " +
		event
			.split(/(?=[A-Z])/)
			.join(" ")
			.toLowerCase()
	);
}
export const alertNames: Record<string, string> = {
	llm_exceptions: "LLM Exceptions",
	llm_too_slow: "LLM Responses Too Slow",
	llm_requests_hanging: "LLM Requests Hanging",
	budget_alerts: "Budget Alerts (API Keys, Users)",
	db_exceptions: "Database Exceptions (Read/Write)",
	daily_reports: "Weekly/Monthly Spend Reports",
	outage_alerts: "Outage Alerts",
	region_outage_alerts: "Region Outage Alerts",
};
