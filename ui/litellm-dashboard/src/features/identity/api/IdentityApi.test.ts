import { afterEach, describe, expect, it, vi } from "vitest";
import { loginCall } from "./IdentityApi";

afterEach(() => vi.unstubAllGlobals());

describe("Worker login exchange", () => {
	it("exchanges a v3 opaque code even when the first response has no redirect URL", async () => {
		const fetch = vi
			.fn<typeof globalThis.fetch>()
			.mockResolvedValueOnce(Response.json({ code: "fixture-code", expires_in: 60 }))
			.mockResolvedValueOnce(Response.json({ redirect_url: "/ui/?login=success" }));
		vi.stubGlobal("fetch", fetch);
		vi.stubGlobal("document", { cookie: "" });
		const result = await loginCall("fixture-user", "fixture-password", true);
		expect(result.redirect_url).toBe("/ui/?login=success");
		expect(fetch.mock.calls[0][0]).toBe("/v3/login");
		expect(fetch.mock.calls[1][0]).toBe("/v3/login/exchange");
		expect(fetch.mock.calls[1][1]?.body).toBe(JSON.stringify({ code: "fixture-code" }));
		expect(fetch.mock.calls[1][1]?.credentials).toBe("include");
	});
});
