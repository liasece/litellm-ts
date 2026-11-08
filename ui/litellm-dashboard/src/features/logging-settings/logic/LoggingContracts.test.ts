import { describe, it, expect } from "vitest";
import { callbackPayload, callbackParameters, emailServerPayload, emailEventDescription } from "./LoggingPayloadLogic";
import { cloudZeroPayload } from "./CloudZeroPayloadLogic";
describe("logging settings payload contracts", () => {
	it("keeps the registered callback field, explicit empty replacements and unknown dynamic parameters", () => {
		const values = { callback: "langfuse", LANGFUSE_SECRET_KEY: "", UNKNOWN_PARAM: "preserved" };
		expect(callbackPayload(values, "langfuse")).toEqual({
			environment_variables: values,
			litellm_settings: { success_callback: ["langfuse"] },
		});
		expect(callbackParameters("custom", [], { first: null, second: "" })).toEqual(["first", "second"]);
	});
	it("only sends registered nonempty email-server values and retains the original trigger descriptions", () => {
		expect(
			emailServerPayload(
				[
					{ name: "email", variables: { SMTP_HOST: "", SMTP_PASSWORD: "" } },
					{ name: "slack", variables: { OTHER: "" } },
				],
				{ SMTP_HOST: "mail.test", SMTP_PASSWORD: "", OTHER: "ignored" },
			),
		).toEqual({ general_settings: { alerting: ["email"] }, environment_variables: { SMTP_HOST: "mail.test" } });
		expect(emailEventDescription("Virtual Key Created")).toContain("their user ID");
	});
	it("keeps existing CloudZero keys when editing an empty secret and applies the UTC default", () => {
		expect(cloudZeroPayload({ connection_id: "fixture", api_key: "", timezone: "" }, true)).toEqual({
			connection_id: "fixture",
			timezone: "UTC",
		});
		expect(cloudZeroPayload({ connection_id: "fixture", api_key: "synthetic", timezone: "Asia/Shanghai" }, false)).toEqual({
			connection_id: "fixture",
			timezone: "Asia/Shanghai",
			api_key: "synthetic",
		});
	});
});
