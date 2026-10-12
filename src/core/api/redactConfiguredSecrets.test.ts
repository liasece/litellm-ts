import { redactConfiguredSecrets, redactErrorPayload } from "./redactConfiguredSecrets";
import { createUpstreamLogContext } from "../../router/UpstreamLogContext";
it("masks configured secrets embedded in errors while preserving identifiers and the source payload", () => {
	const config = { Authorization: "Bearer sample-provider-secret", "x-api-key": "second-secret" };
	const body = { error: { message: "failed sample-provider-secret second-secret", code: "invalid_model" } };
	expect(redactConfiguredSecrets(body.error.message, config)).toBe("failed ******** ********");
	expect(redactErrorPayload(body, config)).toEqual({ error: { message: "failed ******** ********", code: "invalid_model" } });
	expect(body.error.message).toContain("sample-provider-secret");
	expect(
		createUpstreamLogContext(
			{ url: "https://example.invalid", model: "synthetic", method: "POST", headers: config, body: {} },
			new Response("", { status: 400 }),
			body,
		).response?.body,
	).toEqual(redactErrorPayload(body, config));
});
