import { describe, it, expect } from "vitest";
import { callbackPayload, callbackParameters, emailServerPayload } from "./LoggingPayloadLogic";
describe("logging settings payload contracts", () => {
	it("keeps the registered callback field, explicit empty replacements and unknown dynamic parameters", () => {
		const values = { callback: "langfuse", LANGFUSE_SECRET_KEY: "", UNKNOWN_PARAM: "preserved" };
		expect(callbackPayload(values, "langfuse")).toEqual({
			environment_variables: values,
			litellm_settings: { success_callback: ["langfuse"] },
		});
		expect(callbackParameters("custom", {}, { first: null, second: "" })).toEqual(["first", "second"]);
		expect(
			callbackParameters("langfuse", { langfuse: { litellm_callback_params: ["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"] } }, {}),
		).toEqual(["LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"]);
	});
	it("only sends registered nonempty email-server values", () => {
		expect(
			emailServerPayload(
				[
					{ name: "email", variables: { SMTP_HOST: "", SMTP_PASSWORD: "" } },
					{ name: "slack", variables: { OTHER: "" } },
				],
				{ SMTP_HOST: "mail.test", SMTP_PASSWORD: "", OTHER: "ignored" },
			),
		).toEqual({ general_settings: { alerting: ["email"] }, environment_variables: { SMTP_HOST: "mail.test" } });
	});
});
