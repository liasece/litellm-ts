import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildWebSocketCredentialProtocols, deriveErrorMessage, createPlaygroundFetch, dashboardFetch } from "./HttpApiClient";

describe("Dashboard authentication transport", () => {
	const fetch = vi.fn<typeof globalThis.fetch>();
	beforeEach(() => {
		fetch.mockReset().mockResolvedValue(new Response("{}"));
		vi.stubGlobal("fetch", fetch);
		vi.stubGlobal("document", { cookie: "litellm_csrf_token=fixture-csrf" });
	});
	afterEach(() => vi.unstubAllGlobals());

	it("uses the HttpOnly session transport without adding CSRF to reads", async () => {
		await dashboardFetch("/auth/session");
		const options = fetch.mock.calls[0][1]!;
		expect(options.credentials).toBe("include");
		expect(new Headers(options.headers).has("x-litellm-csrf-token")).toBe(false);
		expect(new Headers(options.headers).has("Authorization")).toBe(false);
	});

	it("adds CSRF to writes while preserving headers and cancellation", async () => {
		const controller = new AbortController();
		await dashboardFetch("/key/update", { method: "PATCH", headers: { "x-request-id": "fixture-request" }, signal: controller.signal });
		const options = fetch.mock.calls[0][1]!;
		expect(new Headers(options.headers).get("x-litellm-csrf-token")).toBe("fixture-csrf");
		expect(new Headers(options.headers).get("x-request-id")).toBe("fixture-request");
		expect(options.signal).toBe(controller.signal);
	});

	it("does not add cookies or CSRF to explicit Bearer transport", async () => {
		const options = { method: "POST", headers: { Authorization: "Bearer fixture-virtual-key" } };
		await dashboardFetch("/v1/chat/completions", options);
		expect(fetch.mock.calls[0][1]).toBe(options);
	});

	it("keeps Request method and headers when adding session CSRF", async () => {
		const request = new Request("https://fixture.example/key/update", {
			method: "POST",
			headers: { "x-request-id": "fixture-request" },
		});
		await dashboardFetch(request);
		const options = fetch.mock.calls[0][1]!;
		expect(new Headers(options.headers).get("x-litellm-csrf-token")).toBe("fixture-csrf");
		expect(new Headers(options.headers).get("x-request-id")).toBe("fixture-request");
	});

	it("removes explicit inference credentials when the Playground uses session auth", async () => {
		await createPlaygroundFetch({ kind: "session" }, "openai")("/v1/chat/completions", {
			method: "POST",
			headers: { Authorization: "Bearer fixture-value", "x-api-key": "fixture-value" },
		});
		const options = fetch.mock.calls[0][1]!;
		expect(new Headers(options.headers).has("Authorization")).toBe(false);
		expect(new Headers(options.headers).has("x-api-key")).toBe(false);
		expect(options.credentials).toBe("include");
	});

	it("sends an Anthropic virtual key only through its protocol header", async () => {
		await createPlaygroundFetch({ kind: "virtual-key", apiKey: "fixture-value" }, "anthropic")("/v1/messages", { method: "POST" });
		const options = fetch.mock.calls[0][1]!;
		expect(new Headers(options.headers).get("x-api-key")).toBe("fixture-value");
		expect(new Headers(options.headers).has("Authorization")).toBe(false);
		expect(new Headers(options.headers).has("x-litellm-csrf-token")).toBe(false);
		expect(options.credentials).toBe("omit");
	});

	it("never passes the cookie-session marker as a WebSocket key", () => {
		expect(buildWebSocketCredentialProtocols("cookie-session")).toEqual([]);
		expect(buildWebSocketCredentialProtocols(null)).toEqual([]);
		expect(buildWebSocketCredentialProtocols("fixture-value")).toEqual(["litellm_fixture-value"]);
	});
	it("shows the provider error before a generic response detail", () => {
		expect(deriveErrorMessage({ error: { message: "Provider unavailable" }, detail: "Generic response" })).toBe("Provider unavailable");
	});

	it("preserves actionable field messages from a validation detail array", () => {
		expect(deriveErrorMessage({ detail: [{ loc: ["body", "model"], msg: "Model is required" }, { msg: "Invalid budget" }] })).toBe(
			"Model is required; Invalid budget",
		);
	});
});
