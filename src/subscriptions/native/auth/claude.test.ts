import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionAuthHandler, SubscriptionLoginSession } from "../types";
import { createClaudeAuth } from "./claude";

type LoginAuth = SubscriptionAuthHandler & {
	startLogin: () => Promise<SubscriptionLoginSession>;
	pollLogin: (id: string) => Promise<SubscriptionLoginSession>;
	submitLoginInput: (id: string, input: string) => Promise<SubscriptionLoginSession>;
	cancelLogin: (id: string) => Promise<void>;
};

const TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const PROFILE_URL = "https://api.anthropic.com/api/oauth/profile";
const AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
const CLIENT_ID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";
const REDIRECT_URI = "http://localhost:54545/callback";
const SCOPE = "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload";

interface FetchCall {
	readonly url: string;
	readonly init: RequestInit | undefined;
}

interface FetchMock {
	readonly fetchImpl: typeof fetch;
	readonly calls: FetchCall[];
}

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status: status,
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response;
}

function createFetchMock(handler: (call: FetchCall) => Response | Promise<Response>): FetchMock {
	const calls: FetchCall[] = [];
	const fetchImpl = (async (input: string | URL, init?: RequestInit): Promise<Response> => {
		const call: FetchCall = { url: String(input), init: init };
		calls.push(call);
		return await handler(call);
	}) as unknown as typeof fetch;
	return { fetchImpl: fetchImpl, calls: calls };
}

function requestJson(call: FetchCall | undefined): Record<string, unknown> {
	if (!call) {
		throw new Error("expected a request");
	}
	return JSON.parse(String(call.init?.body)) as Record<string, unknown>;
}

function requireUrl(url: string | undefined): URL {
	if (!url) {
		throw new Error("expected a session URL");
	}
	return new URL(url);
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (predicate()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("timed out waiting for condition");
}

describe("claude subscription auth", () => {
	let authDir: string;
	let nowMs: number;
	let store: SubscriptionAccountStore;

	beforeEach(async () => {
		authDir = await mkdtemp(path.join(tmpdir(), "claude-auth-"));
		nowMs = Date.parse("2026-01-02T03:04:05Z");
		store = new SubscriptionAccountStore({ authDir: authDir });
	});

	afterEach(async () => {
		await rm(authDir, { recursive: true, force: true });
	});

	async function seed(raw: Record<string, unknown>, fileName: string): Promise<SubscriptionAccount> {
		await store.writeRaw(fileName, raw);
		const account = await store.findByFileName(fileName);
		if (!account) {
			throw new Error(`failed to seed ${fileName}`);
		}
		return account;
	}

	function createAuth(
		fetchImpl: typeof fetch,
		overrides: { readonly loginSessionTtlMs?: number; readonly maxLoginSessions?: number } = {},
	): LoginAuth {
		return createClaudeAuth({
			accounts: store,
			fetch: fetchImpl,
			now: () => nowMs,
			...overrides,
		}) as LoginAuth;
	}

	it("refreshes an expiring credential and writes back Claude auth fields", async () => {
		const account = await seed(
			{
				type: "claude",
				access_token: "old-access",
				refresh_token: "old-refresh",
				expired: new Date(nowMs + 60_000).toISOString(),
				email: "user@example.com",
				account_uuid: "acct-1",
				organization_uuid: "org-1",
				organization_name: "Old Org",
				claude_device_ids: ["device-a"],
				custom_flag: "keep-me",
				weight: 3,
			},
			"claude-user@example.com.json",
		);
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({
					access_token: "new-access",
					refresh_token: "new-refresh",
					expires_in: 28800,
					token_type: "Bearer",
				});
			}
			if (call.url === PROFILE_URL) {
				return jsonResponse({
					account: { uuid: "acct-1", email: "user@example.com" },
					organization: { uuid: "org-1", name: "New Org" },
				});
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		await expect(auth.ensureCredential(account)).resolves.toBe("new-access");

		const raw = await store.readRaw(account.fileName);
		expect(raw["access_token"]).toBe("new-access");
		expect(raw["refresh_token"]).toBe("new-refresh");
		expect(raw["expired"]).toBe("2026-01-02T11:04:05Z");
		expect(raw["last_refresh"]).toBe("2026-01-02T03:04:05Z");
		expect(raw["type"]).toBe("claude");
		expect(raw["organization_name"]).toBe("New Org");
		expect(raw["claude_device_ids"]).toEqual(["device-a"]);
		expect(raw["custom_flag"]).toBe("keep-me");
		expect(raw["weight"]).toBe(3);

		const tokenCall = calls.find((call) => call.url === TOKEN_URL);
		expect(Object.keys(requestJson(tokenCall))).toEqual([
			"client_id",
			"grant_type",
			"refresh_token",
			"scope",
		]);
		expect(requestJson(tokenCall)).toEqual({
			client_id: CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: "old-refresh",
			scope: SCOPE,
		});
		expect(tokenCall?.init?.method).toBe("POST");
		expect(tokenCall?.init?.headers).toMatchObject({ "User-Agent": "axios/1.15.2" });
	});

	it("keeps the current credential while outside the five minute refresh window", async () => {
		const account = await seed(
			{
				type: "claude",
				access_token: "steady-access",
				refresh_token: "steady-refresh",
				expired: new Date(nowMs + 6 * 60 * 1000).toISOString(),
			},
			"claude-steady@example.com.json",
		);
		const { fetchImpl, calls } = createFetchMock(() => {
			throw new Error("network must not be used");
		});
		const auth = createAuth(fetchImpl);

		await expect(auth.ensureCredential(account)).resolves.toBe("steady-access");
		expect(calls).toHaveLength(0);
	});

	it("deduplicates concurrent refreshes through the file lock", async () => {
		const account = await seed(
			{
				type: "claude",
				access_token: "old-access",
				refresh_token: "old-refresh",
				expired: new Date(nowMs + 60_000).toISOString(),
			},
			"claude-race@example.com.json",
		);
		let release: ((response: Response) => void) | undefined;
		const gate = new Promise<Response>((resolve) => {
			release = resolve;
		});
		const { fetchImpl, calls } = createFetchMock(async (call) => {
			if (call.url === TOKEN_URL) {
				return await gate;
			}
			if (call.url === PROFILE_URL) {
				return jsonResponse({}, 404);
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		const first = auth.ensureCredential(account);
		const second = auth.ensureCredential(account);
		await waitFor(() => calls.some((call) => call.url === TOKEN_URL));
		release?.(jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));

		await expect(Promise.all([first, second])).resolves.toEqual(["new-access", "new-access"]);
		expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1);
	});

	it("rejects refresh without a refresh token and leaves the file untouched", async () => {
		const account = await seed(
			{
				type: "claude",
				access_token: "only-access",
				expired: new Date(nowMs - 1000).toISOString(),
			},
			"claude-no-refresh@example.com.json",
		);
		const before = await readFile(path.join(authDir, account.fileName), "utf8");
		const { fetchImpl, calls } = createFetchMock(() => {
			throw new Error("network must not be used");
		});
		const auth = createAuth(fetchImpl);

		await expect(auth.ensureCredential(account)).rejects.toThrow(/refresh_token/);
		await expect(auth.refresh(account)).rejects.toThrow(/refresh_token/);
		expect(calls).toHaveLength(0);
		expect(await readFile(path.join(authDir, account.fileName), "utf8")).toBe(before);
	});

	it("keeps the previous credential when the token endpoint rejects the refresh", async () => {
		const account = await seed(
			{
				type: "claude",
				access_token: "old-access",
				refresh_token: "stale-refresh",
				expired: new Date(nowMs + 60_000).toISOString(),
			},
			"claude-broken@example.com.json",
		);
		const before = await readFile(path.join(authDir, account.fileName), "utf8");
		const { fetchImpl } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({ error: "invalid_grant", error_description: "refresh token revoked" }, 400);
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		await expect(auth.refresh(account)).rejects.toThrow(/invalid_grant/);
		expect(await readFile(path.join(authDir, account.fileName), "utf8")).toBe(before);
	});

	it("starts a PKCE login and exchanges the pasted callback URL", async () => {
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({
					access_token: "access-1",
					refresh_token: "refresh-1",
					token_type: "Bearer",
					expires_in: 28800,
					account: { uuid: "acct-1", email_address: "user@example.com" },
					organization: { uuid: "org-1", name: "Example Org" },
				});
			}
			if (call.url === PROFILE_URL) {
				return jsonResponse({
					account: { uuid: "acct-1", email: "user@example.com" },
					organization: { uuid: "org-1", name: "Example Org" },
				});
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		const session = await auth.startLogin();
		expect(session.state).toBe("pending");
		expect(session.prompt).toContain("callback");
		const authorizeUrl = requireUrl(session.url);
		expect(`${authorizeUrl.origin}${authorizeUrl.pathname}`).toBe(AUTHORIZE_URL);
		expect(authorizeUrl.searchParams.get("client_id")).toBe(CLIENT_ID);
		expect(authorizeUrl.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
		expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
		expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");
		expect(authorizeUrl.searchParams.get("scope")).toBe(SCOPE);
		const state = authorizeUrl.searchParams.get("state");
		expect(state).toBeTruthy();

		const completed = await auth.submitLoginInput(
			session.id,
			`${REDIRECT_URI}?code=auth-code&state=${state ?? ""}`,
		);
		expect(completed.state).toBe("success");
		expect(JSON.stringify(completed)).not.toContain("access-1");

		const tokenCall = calls.find((call) => call.url === TOKEN_URL);
		const exchangeBody = requestJson(tokenCall);
		expect(exchangeBody["grant_type"]).toBe("authorization_code");
		expect(exchangeBody["code"]).toBe("auth-code");
		expect(exchangeBody["redirect_uri"]).toBe(REDIRECT_URI);
		expect(exchangeBody["client_id"]).toBe(CLIENT_ID);
		expect(exchangeBody["state"]).toBe(state);
		expect(Object.keys(exchangeBody)).toEqual([
			"grant_type",
			"code",
			"redirect_uri",
			"client_id",
			"code_verifier",
			"state",
		]);
		const verifier = String(exchangeBody["code_verifier"]);
		expect(verifier).toHaveLength(64);
		expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
			authorizeUrl.searchParams.get("code_challenge"),
		);

		const accounts = await store.list("claude");
		expect(accounts).toHaveLength(1);
		const account = accounts[0];
		if (!account) {
			throw new Error("expected a saved account");
		}
		expect(account.fileName).toMatch(/^claude-[0-9a-f]{8}-user@example\.com\.json$/);
		const raw = await store.readRaw(account.fileName);
		expect(raw["type"]).toBe("claude");
		expect(raw["access_token"]).toBe("access-1");
		expect(raw["refresh_token"]).toBe("refresh-1");
		expect(raw["email"]).toBe("user@example.com");
		expect(raw["account_uuid"]).toBe("acct-1");
		expect(raw["organization_uuid"]).toBe("org-1");
		expect(raw["organization_name"]).toBe("Example Org");
		expect(raw["expired"]).toBe("2026-01-02T11:04:05Z");
		expect(Array.isArray(raw["claude_device_ids"])).toBe(true);
		const deviceIds = raw["claude_device_ids"] as string[];
		expect(deviceIds[0]).toMatch(/^[0-9a-f]{64}$/);
	});

	it("accepts a bare authorization code and rejects a mismatched state", async () => {
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 });
			}
			if (call.url === PROFILE_URL) {
				return jsonResponse({ account: { uuid: "acct-2", email: "bare@example.com" } });
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		const session = await auth.startLogin();
		const state = requireUrl(session.url).searchParams.get("state");

		const rejected = await auth.submitLoginInput(
			session.id,
			`${REDIRECT_URI}?code=wrong&state=not-${state ?? ""}`,
		);
		expect(rejected.state).toBe("error");
		expect(rejected.error).toContain("state");
		expect(calls).toHaveLength(0);

		const retried = await auth.startLogin();
		const completed = await auth.submitLoginInput(retried.id, "plain-code");
		expect(completed.state).toBe("success");
		const tokenCall = calls.find((call) => call.url === TOKEN_URL);
		expect(requestJson(tokenCall)["code"]).toBe("plain-code");
		expect(requestJson(tokenCall)["state"]).toBe(requireUrl(retried.url).searchParams.get("state"));

		const accounts = await store.list("claude");
		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.fileName).toMatch(/^claude-[0-9a-f]{8}-bare@example\.com\.json$/);
	});

	it("splits a state fragment embedded in the callback code", async () => {
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({ access_token: "access-4", refresh_token: "refresh-4", expires_in: 3600 });
			}
			if (call.url === PROFILE_URL) {
				return jsonResponse({ account: { uuid: "acct-4", email: "fragment@example.com" } });
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);
		const session = await auth.startLogin();
		const state = requireUrl(session.url).searchParams.get("state");
		const completed = await auth.submitLoginInput(
			session.id,
			`${REDIRECT_URI}?code=code-part%23${state ?? ""}&state=${state ?? ""}`,
		);
		expect(completed.state).toBe("success");
		const exchangeBody = requestJson(calls.find((call) => call.url === TOKEN_URL));
		expect(exchangeBody["code"]).toBe("code-part");
		expect(exchangeBody["state"]).toBe(state);
	});

	it("saves the login when the profile lookup fails", async () => {
		const { fetchImpl } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({
					access_token: "token-only-access",
					refresh_token: "token-only-refresh",
					expires_in: 3600,
					account: { uuid: "acct-token", email_address: "token@example.com" },
				});
			}
			if (call.url === PROFILE_URL) {
				return jsonResponse({ error: "overloaded" }, 500);
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);
		const session = await auth.startLogin();
		const state = requireUrl(session.url).searchParams.get("state") ?? "";
		const completed = await auth.submitLoginInput(
			session.id,
			`${REDIRECT_URI}?code=profile-failure&state=${state}`,
		);
		expect(completed.state).toBe("success");
		const accounts = await store.list("claude");
		expect(accounts).toHaveLength(1);
		const account = accounts[0];
		if (!account) {
			throw new Error("expected a saved account");
		}
		const raw = await store.readRaw(account.fileName);
		expect(raw["email"]).toBe("token@example.com");
		expect(raw["account_uuid"]).toBe("acct-token");
		expect(raw["access_token"]).toBe("token-only-access");
	});

	it("reuses the legacy email file and keeps operator fields", async () => {
		await store.writeRaw("claude-user@example.com.json", {
			type: "claude",
			access_token: "legacy-access",
			refresh_token: "legacy-refresh",
			email: "user@example.com",
			label: "Ops",
			disabled: true,
			weight: 2,
		});
		const { fetchImpl } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({ access_token: "access-3", refresh_token: "refresh-3", expires_in: 3600 });
			}
			if (call.url === PROFILE_URL) {
				return jsonResponse({
					account: { uuid: "acct-3", email: "user@example.com" },
					organization: { uuid: "org-3", name: "Org Three" },
				});
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);
		const session = await auth.startLogin();

		const completed = await auth.submitLoginInput(
			session.id,
			`${REDIRECT_URI}?code=legacy-code&state=${requireUrl(session.url).searchParams.get("state") ?? ""}`,
		);
		expect(completed.state).toBe("success");

		const accounts = await store.list("claude");
		expect(accounts.map((account) => account.fileName)).toEqual(["claude-user@example.com.json"]);
		const raw = await store.readRaw("claude-user@example.com.json");
		expect(raw["label"]).toBe("Ops");
		expect(raw["disabled"]).toBe(true);
		expect(raw["weight"]).toBe(2);
		expect(raw["access_token"]).toBe("access-3");
		expect(raw["organization_uuid"]).toBe("org-3");
	});

	it("expires, caps, and cancels in-memory login sessions", async () => {
		const { fetchImpl } = createFetchMock(() => {
			throw new Error("network must not be used");
		});
		const auth = createAuth(fetchImpl, { loginSessionTtlMs: 60_000, maxLoginSessions: 2 });

		const first = await auth.startLogin();
		const second = await auth.startLogin();
		expect((await auth.pollLogin(first.id)).state).toBe("pending");
		const third = await auth.startLogin();
		await expect(auth.pollLogin(first.id)).rejects.toThrow(/登录会话/);
		expect((await auth.pollLogin(second.id)).state).toBe("pending");
		expect((await auth.pollLogin(third.id)).state).toBe("pending");

		await auth.cancelLogin(second.id);
		await expect(auth.pollLogin(second.id)).rejects.toThrow(/登录会话/);

		nowMs += 61_000;
		await expect(auth.pollLogin(third.id)).rejects.toThrow(/登录会话/);
	});
});
