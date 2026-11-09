import { afterEach, describe, expect, it, vi } from "vitest";
import { loginCall } from "./IdentityApi";

afterEach(() => vi.unstubAllGlobals());

describe("WebUI login", () => {
	it("posts credentials to /v2/login and returns the backend redirect", async () => {
		const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ redirect_url: "/ui/?login=success" }));
		vi.stubGlobal("fetch", fetch);
		const result = await loginCall("fixture-user", "fixture-password");
		expect(result.redirect_url).toBe("/ui/?login=success");
		expect(fetch.mock.calls[0][0]).toBe("/v2/login");
		expect(fetch.mock.calls[0][1]?.body).toBe(JSON.stringify({ username: "fixture-user", password: "fixture-password" }));
	});
});
