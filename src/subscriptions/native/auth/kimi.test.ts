import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionAuthHandler, SubscriptionLoginSession } from "../types";
import { createKimiAuth } from "./kimi";

type LoginAuth = SubscriptionAuthHandler & {
	startLogin: () => Promise<SubscriptionLoginSession>;
	pollLogin: (id: string) => Promise<SubscriptionLoginSession>;
	cancelLogin: (id: string) => Promise<void>;
};

const DEVICE_URL = "https://auth.kimi.com/api/oauth/device_authorization";
const TOKEN_URL = "https://auth.kimi.com/api/oauth/token";
const AI_TOKEN_URL = "https://auth.kimi.ai/api/oauth/token";
const CLIENT_ID = "17e5f671-d194-4dfb-9706-5516cb48c098";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

function formBody(call: FetchCall | undefined): URLSearchParams {
	if (!call) {
		throw new Error("expected a request");
	}
	return new URLSearchParams(String(call.init?.body));
}

function headerValue(call: FetchCall | undefined, name: string): string | undefined {
	const headers = call?.init?.headers as unknown as Record<string, string> | undefined;
	return headers?.[name];
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

const DEVICE_RESPONSE: Record<string, unknown> = {
	device_code: "device-code-1",
	user_code: "ABCD-EFGH",
	verification_uri: "https://auth.kimi.com/device",
	verification_uri_complete: "https://auth.kimi.com/device?user_code=ABCD-EFGH",
	expires_in: 900,
	interval: 5,
};

describe("kimi subscription auth", () => {
	let authDir: string;
	let nowMs: number;
	let store: SubscriptionAccountStore;

	beforeEach(async () => {
		authDir = await mkdtemp(path.join(tmpdir(), "kimi-auth-"));
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

	function createAuth(fetchImpl: typeof fetch): LoginAuth {
		return createKimiAuth({ accounts: store, fetch: fetchImpl, now: () => nowMs }) as LoginAuth;
	}

	it("runs the device code login, respects polling intervals, and saves the account", async () => {
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === DEVICE_URL) {
				return jsonResponse(DEVICE_RESPONSE);
			}
			if (call.url === TOKEN_URL) {
				const attempt = calls.filter((entry) => entry.url === TOKEN_URL).length;
				if (attempt === 1) {
					return jsonResponse({ error: "authorization_pending" }, 400);
				}
				return jsonResponse({
					access_token: "kimi-access",
					refresh_token: "kimi-refresh",
					token_type: "Bearer",
					scope: "all",
					expires_in: 3600,
				});
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		const session = await auth.startLogin();
		expect(session.state).toBe("pending");
		expect(JSON.stringify(session.output)).toContain("ABCD-EFGH");
		expect(session.url).toBe("https://auth.kimi.com/device?user_code=ABCD-EFGH");

		const deviceCall = calls.find((call) => call.url === DEVICE_URL);
		expect(deviceCall?.init?.method).toBe("POST");
		expect(formBody(deviceCall).get("client_id")).toBe(CLIENT_ID);
		expect(headerValue(deviceCall, "X-Msh-Platform")).toBe("CLIProxyAPI");
		expect(headerValue(deviceCall, "X-Msh-Version")).toBeTruthy();
		expect(headerValue(deviceCall, "X-Msh-Device-Name")).toBeTruthy();
		expect(headerValue(deviceCall, "X-Msh-Device-Model")).toMatch(/ (arm64|amd64|386)$/);
		const deviceId = headerValue(deviceCall, "X-Msh-Device-Id");
		expect(deviceId).toMatch(UUID_PATTERN);

		// 未到轮询间隔时不出网。
		expect((await auth.pollLogin(session.id)).state).toBe("pending");
		expect(calls).toHaveLength(1);

		nowMs += 5000;
		expect((await auth.pollLogin(session.id)).state).toBe("pending");
		expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1);
		const firstTokenCall = calls.find((call) => call.url === TOKEN_URL);
		expect(formBody(firstTokenCall).get("client_id")).toBe(CLIENT_ID);
		expect(formBody(firstTokenCall).get("device_code")).toBe("device-code-1");
		expect(formBody(firstTokenCall).get("grant_type")).toBe(
			"urn:ietf:params:oauth:grant-type:device_code",
		);

		nowMs += 5000;
		const completed = await auth.pollLogin(session.id);
		expect(completed.state).toBe("success");
		expect(JSON.stringify(completed)).not.toContain("kimi-access");

		const callsAfterSuccess = calls.length;
		expect((await auth.pollLogin(session.id)).state).toBe("success");
		expect(calls).toHaveLength(callsAfterSuccess);

		const accounts = await store.list("kimi");
		expect(accounts).toHaveLength(1);
		const account = accounts[0];
		if (!account) {
			throw new Error("expected a saved account");
		}
		expect(account.fileName).toBe(`kimi-${nowMs}.json`);
		const raw = await store.readRaw(account.fileName);
		expect(raw["access_token"]).toBe("kimi-access");
		expect(raw["refresh_token"]).toBe("kimi-refresh");
		expect(raw["token_type"]).toBe("Bearer");
		expect(raw["scope"]).toBe("all");
		expect(raw["device_id"]).toBe(deviceId);
		expect(raw["type"]).toBe("kimi");
		expect(raw["domain"]).toBe("kimi.com");
		expect(raw["base_url"]).toBe("https://api.kimi.com/coding");
		expect(raw["timestamp"]).toBe(nowMs);
		expect(raw["expired"]).toBe("2026-01-02T04:04:15Z");
	});

	it("applies slow_down by increasing the polling interval", async () => {
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === DEVICE_URL) {
				return jsonResponse(DEVICE_RESPONSE);
			}
			if (call.url === TOKEN_URL) {
				return jsonResponse({ error: "slow_down" }, 400);
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);
		const session = await auth.startLogin();

		nowMs += 5000;
		expect((await auth.pollLogin(session.id)).state).toBe("pending");
		expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1);

		nowMs += 5000;
		expect((await auth.pollLogin(session.id)).state).toBe("pending");
		expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(1);

		nowMs += 5000;
		expect((await auth.pollLogin(session.id)).state).toBe("pending");
		expect(calls.filter((call) => call.url === TOKEN_URL)).toHaveLength(2);
	});

	it("fails the session when the device code expires", async () => {
		const { fetchImpl } = createFetchMock((call) => {
			if (call.url === DEVICE_URL) {
				return jsonResponse({ ...DEVICE_RESPONSE, expires_in: 60 });
			}
			if (call.url === TOKEN_URL) {
				return jsonResponse({ error: "expired_token" }, 400);
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);
		const session = await auth.startLogin();

		nowMs += 5000;
		const expired = await auth.pollLogin(session.id);
		expect(expired.state).toBe("error");
		expect(expired.error).toContain("过期");

		const localDeadline = await auth.startLogin();
		nowMs += 61_000;
		const timedOut = await auth.pollLogin(localDeadline.id);
		expect(timedOut.state).toBe("error");
		expect(timedOut.error).toContain("过期");
	});

	it("rejects access_denied and device endpoint failures clearly", async () => {
		const { fetchImpl } = createFetchMock((call) => {
			if (call.url === DEVICE_URL) {
				return jsonResponse(DEVICE_RESPONSE);
			}
			if (call.url === TOKEN_URL) {
				return jsonResponse({ error: "access_denied", error_description: "user declined" });
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);
		const session = await auth.startLogin();
		nowMs += 5000;
		const denied = await auth.pollLogin(session.id);
		expect(denied.state).toBe("error");
		expect(denied.error).toContain("拒绝");

		const failing = createAuth(
			createFetchMock(() => jsonResponse({ error: "invalid_client" }, 400)).fetchImpl,
		);
		await expect(failing.startLogin()).rejects.toThrow(/invalid_client/);
	});

	it("refreshes an expiring credential and preserves unknown fields", async () => {
		const account = await seed(
			{
				type: "kimi",
				access_token: "old-access",
				refresh_token: "old-refresh",
				token_type: "Bearer",
				device_id: "device-xyz",
				expired: new Date(nowMs + 60_000).toISOString(),
				domain: "kimi.com",
				base_url: "https://api.kimi.com/coding",
				timestamp: nowMs,
				scope: "all",
				custom_flag: "keep-me",
				weight: 4,
			},
			"kimi-1.json",
		);
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === TOKEN_URL) {
				return jsonResponse({
					access_token: "new-access",
					refresh_token: "new-refresh",
					token_type: "Bearer",
					expires_in: 7200,
				});
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		await expect(auth.ensureCredential(account)).resolves.toBe("new-access");

		const raw = await store.readRaw("kimi-1.json");
		expect(raw["access_token"]).toBe("new-access");
		expect(raw["refresh_token"]).toBe("new-refresh");
		expect(raw["device_id"]).toBe("device-xyz");
		expect(raw["type"]).toBe("kimi");
		expect(raw["domain"]).toBe("kimi.com");
		expect(raw["base_url"]).toBe("https://api.kimi.com/coding");
		expect(raw["custom_flag"]).toBe("keep-me");
		expect(raw["weight"]).toBe(4);
		expect(raw["timestamp"]).toBe(nowMs);
		expect(raw["last_refresh"]).toBe("2026-01-02T03:04:05Z");
		expect(raw["expired"]).toBe("2026-01-02T05:04:05Z");

		const tokenCall = calls.find((call) => call.url === TOKEN_URL);
		expect(formBody(tokenCall).get("grant_type")).toBe("refresh_token");
		expect(formBody(tokenCall).get("refresh_token")).toBe("old-refresh");
		expect(formBody(tokenCall).get("client_id")).toBe(CLIENT_ID);
		expect(headerValue(tokenCall, "X-Msh-Device-Id")).toBe("device-xyz");
	});

	it("uses the kimi.ai OAuth host for imported kimi.ai accounts", async () => {
		const account = await seed(
			{
				type: "kimi",
				access_token: "ai-access",
				refresh_token: "ai-refresh",
				expired: new Date(nowMs + 60_000).toISOString(),
				domain: "kimi.ai",
				base_url: "https://api.kimi.ai/coding",
			},
			"kimi-ai-1.json",
		);
		const { fetchImpl, calls } = createFetchMock((call) => {
			if (call.url === AI_TOKEN_URL) {
				return jsonResponse({ access_token: "ai-new-access", expires_in: 3600 });
			}
			throw new Error(`unexpected request ${call.url}`);
		});
		const auth = createAuth(fetchImpl);

		await expect(auth.ensureCredential(account)).resolves.toBe("ai-new-access");
		expect(calls.map((call) => call.url)).toEqual([AI_TOKEN_URL]);
		const raw = await store.readRaw("kimi-ai-1.json");
		expect(raw["access_token"]).toBe("ai-new-access");
		expect(raw["refresh_token"]).toBe("ai-refresh");
		expect(raw["type"]).toBe("kimi");
		expect(raw["domain"]).toBe("kimi.ai");
		expect(raw["base_url"]).toBe("https://api.kimi.ai/coding");
		expect(headerValue(calls[0], "X-Msh-Device-Id")).toMatch(UUID_PATTERN);
	});

	it("keeps the old credential when refresh fails and requires a refresh token", async () => {
		const failing = await seed(
			{
				type: "kimi",
				access_token: "old-access",
				refresh_token: "stale-refresh",
				expired: new Date(nowMs + 60_000).toISOString(),
			},
			"kimi-failing.json",
		);
		const before = await readFile(path.join(authDir, failing.fileName), "utf8");
		const failingAuth = createAuth(
			createFetchMock((call) => {
				if (call.url === TOKEN_URL) {
					return jsonResponse({ error: "invalid_grant" }, 400);
				}
				throw new Error(`unexpected request ${call.url}`);
			}).fetchImpl,
		);
		await expect(failingAuth.refresh(failing)).rejects.toThrow(/invalid_grant/);
		expect(await readFile(path.join(authDir, failing.fileName), "utf8")).toBe(before);

		const noRefresh = await seed(
			{
				type: "kimi",
				access_token: "only-access",
				expired: new Date(nowMs - 1000).toISOString(),
			},
			"kimi-no-refresh.json",
		);
		const noRefreshAuth = createAuth(
			createFetchMock(() => {
				throw new Error("network must not be used");
			}).fetchImpl,
		);
		await expect(noRefreshAuth.ensureCredential(noRefresh)).rejects.toThrow(/refresh_token/);
	});

	it("deduplicates concurrent refreshes through the file lock", async () => {
		const account = await seed(
			{
				type: "kimi",
				access_token: "old-access",
				refresh_token: "old-refresh",
				expired: new Date(nowMs + 60_000).toISOString(),
				domain: "kimi.com",
			},
			"kimi-race.json",
		);
		let release: ((response: Response) => void) | undefined;
		const gate = new Promise<Response>((resolve) => {
			release = resolve;
		});
		const { fetchImpl, calls } = createFetchMock(async (call) => {
			if (call.url === TOKEN_URL) {
				return await gate;
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
});
