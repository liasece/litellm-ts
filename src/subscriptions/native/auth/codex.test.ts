import { createHash } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "../../../core/api/ApiError";
import { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionLoginSession } from "../types";
import { createCodexAuth, type CodexAuthHandler } from "./codex";
import { CODEX_OAUTH, codexCredentialFileName } from "./codexOAuth";

/** 测试服务器捕获的请求。 */
interface RecordedRequest {
	readonly method: string;
	readonly path: string;
	readonly headers: IncomingMessage["headers"];
	readonly body: string;
	readonly form: URLSearchParams;
}

/** 测试服务器。 */
interface TestServer {
	readonly url: string;
	readonly requests: RecordedRequest[];
	close(): Promise<void>;
}

/** 请求处理器。 */
type RequestHandler = (request: RecordedRequest, response: ServerResponse) => void | Promise<void>;

/**
 * 启动本地 HTTP 服务器。
 * @param handler - 请求处理器
 */
async function startServer(handler: RequestHandler): Promise<TestServer> {
	const requests: RecordedRequest[] = [];
	const server = createServer((incoming, response) => {
		const chunks: Buffer[] = [];
		incoming.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
		});
		incoming.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf8");
			const recorded: RecordedRequest = {
				method: incoming.method ?? "",
				path: incoming.url ?? "",
				headers: incoming.headers,
				body: body,
				form: new URLSearchParams(body),
			};
			requests.push(recorded);
			Promise.resolve(handler(recorded, response)).catch((error: unknown) => {
				response.statusCode = 500;
				response.end(String(error));
			});
		});
	});
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("测试服务器未取得端口");
	}
	return {
		url: `http://127.0.0.1:${(address as AddressInfo).port}`,
		requests: requests,
		close: () =>
			new Promise<void>((resolve, reject) => {
				server.close((error) => {
					if (error) {
						reject(error);
					} else {
						resolve();
					}
				});
			}),
	};
}

/**
 * 返回 JSON 响应。
 * @param response - HTTP 响应
 * @param status - 状态码
 * @param body - JSON 体
 */
function sendJson(response: ServerResponse, status: number, body: Record<string, unknown>): void {
	response.statusCode = status;
	response.setHeader("Content-Type", "application/json");
	response.end(JSON.stringify(body));
}

/**
 * 生成不可校验签名的测试 JWT。
 * @param claims - payload
 */
function jwt(claims: Record<string, unknown>): string {
	const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString("base64url");
	return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.signature`;
}

/**
 * 构造 Codex id_token claims。
 * @param email - 邮箱
 * @param accountId - ChatGPT 账号 ID
 * @param plan - 套餐
 */
function codexClaims(email: string, accountId: string, plan: string): string {
	return jwt({
		email: email,
		"https://api.openai.com/auth": {
			chatgpt_account_id: accountId,
			chatgpt_plan_type: plan,
		},
	});
}

/**
 * 等待毫秒。
 * @param ms - 毫秒
 */
async function delay(ms: number): Promise<void> {
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * 读取磁盘上的账号。
 * @param store - 账号仓库
 * @param fileName - 文件名
 */
async function loadAccount(store: SubscriptionAccountStore, fileName: string): Promise<SubscriptionAccount> {
	const account = await store.findByFileName(fileName);
	if (!account) {
		throw new Error(`账号文件不存在：${fileName}`);
	}
	return account;
}

/**
 * 等待登录会话离开 pending。
 * @param auth - 鉴权处理器
 * @param id - 会话 ID
 */
async function waitForSession(auth: CodexAuthHandler, id: string): Promise<SubscriptionLoginSession> {
	const deadline = Date.now() + 4_000;
	for (;;) {
		const session = await auth.pollLogin(id);
		if (session.state !== "pending") {
			return session;
		}
		if (Date.now() > deadline) {
			throw new Error("登录会话未在期限内完成");
		}
		await delay(10);
	}
}

/**
 * 创建临时 auth 目录与仓库。
 */
async function createStore(): Promise<{ directory: string; store: SubscriptionAccountStore }> {
	const directory = await mkdtemp(path.join(tmpdir(), "codex-auth-"));
	return { directory: directory, store: new SubscriptionAccountStore({ authDir: directory }) };
}

describe("createCodexAuth", () => {
	it("refreshes an account that expires within five minutes and keeps unknown fields", async () => {
		const { directory, store } = await createStore();
		let refreshCalls = 0;
		const server = await startServer((request, response) => {
			expect(request.path).toBe("/oauth/token");
			expect(request.form.get("grant_type")).toBe("refresh_token");
			expect(request.form.get("refresh_token")).toBe("old-refresh");
			expect(request.form.get("client_id")).toBe(CODEX_OAUTH.clientId);
			expect(request.form.get("scope")).toBe(CODEX_OAUTH.refreshScope);
			refreshCalls += 1;
			sendJson(response, 200, {
				access_token: "new-access",
				refresh_token: "new-refresh",
				id_token: codexClaims("new@example.com", "acct-new", "pro"),
				token_type: "Bearer",
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("codex-old.json", {
				type: "codex",
				access_token: "old-access",
				refresh_token: "old-refresh",
				id_token: codexClaims("old@example.com", "acct-old", "plus"),
				account_id: "acct-old",
				email: "old@example.com",
				plan_type: "plus",
				expired: new Date(Date.now() - 60_000).toISOString(),
				expires_at: new Date(Date.now() - 60_000).toISOString(),
				last_refresh: "2026-01-01T00:00:00Z",
				note: "keep-me",
				use_siwc: false,
				extra: { nested: true },
			});
			const account = await loadAccount(store, "codex-old.json");
			const auth = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			const credential = await auth.ensureCredential(account);
			expect(credential).toBe("new-access");
			expect(refreshCalls).toBe(1);
			const raw = await store.readRaw("codex-old.json");
			expect(raw["type"]).toBe("codex");
			expect(raw["access_token"]).toBe("new-access");
			expect(raw["refresh_token"]).toBe("new-refresh");
			expect(raw["account_id"]).toBe("acct-new");
			expect(raw["email"]).toBe("new@example.com");
			expect(raw["plan_type"]).toBe("pro");
			expect(raw["note"]).toBe("keep-me");
			expect(raw["use_siwc"]).toBe(false);
			expect(raw["extra"]).toEqual({ nested: true });
			expect(Date.parse(raw["expired"] as string)).toBeGreaterThan(Date.now());
			expect(raw["expires_at"]).toBe(raw["expired"]);
			expect(raw["last_refresh"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
			expect(raw["id_token"]).toBeTruthy();
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("returns a still-valid token without hitting the network", async () => {
		const { directory, store } = await createStore();
		let calls = 0;
		const server = await startServer((_request, response) => {
			calls += 1;
			sendJson(response, 200, {});
		});
		try {
			await store.writeRaw("codex-valid.json", {
				type: "codex",
				access_token: "valid-access",
				refresh_token: "valid-refresh",
				expired: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			});
			const account = await loadAccount(store, "codex-valid.json");
			const auth = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			await expect(auth.ensureCredential(account)).resolves.toBe("valid-access");
			expect(calls).toBe(0);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("serializes concurrent refreshes through the file lock", async () => {
		const { directory, store } = await createStore();
		let refreshCalls = 0;
		const server = await startServer(async (_request, response) => {
			refreshCalls += 1;
			await delay(120);
			sendJson(response, 200, {
				access_token: "concurrent-access",
				refresh_token: "concurrent-refresh",
				id_token: codexClaims("lock@example.com", "acct-lock", "plus"),
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("codex-lock.json", {
				type: "codex",
				access_token: "stale-access",
				refresh_token: "stale-refresh",
				id_token: codexClaims("lock@example.com", "acct-lock", "plus"),
				account_id: "acct-lock",
				email: "lock@example.com",
				plan_type: "plus",
				expired: new Date(Date.now() - 60_000).toISOString(),
			});
			const account = await loadAccount(store, "codex-lock.json");
			const first = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			const second = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			const tokens = await Promise.all([first.ensureCredential(account), second.ensureCredential(account)]);
			expect(tokens).toEqual(["concurrent-access", "concurrent-access"]);
			expect(refreshCalls).toBe(1);
			const raw = await store.readRaw("codex-lock.json");
			expect(raw["access_token"]).toBe("concurrent-access");
			expect(raw["refresh_token"]).toBe("concurrent-refresh");
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("forces a refresh even when the disk token is still valid", async () => {
		const { directory, store } = await createStore();
		let refreshCalls = 0;
		const server = await startServer((_request, response) => {
			refreshCalls += 1;
			sendJson(response, 200, {
				access_token: `forced-access-${refreshCalls}`,
				refresh_token: `forced-refresh-${refreshCalls}`,
				id_token: codexClaims("force@example.com", "acct-force", "pro"),
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("codex-force.json", {
				type: "codex",
				access_token: "{{SECRET_au2xgkoz}}",
				refresh_token: "{{SECRET_akymq6vs}}",
				id_token: codexClaims("force@example.com", "acct-force", "pro"),
				account_id: "acct-force",
				email: "force@example.com",
				plan_type: "pro",
				expired: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			});
			const account = await loadAccount(store, "codex-force.json");
			const auth = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			await auth.refresh(account);
			await auth.refresh(account);
			expect(refreshCalls).toBe(2);
			const raw = await store.readRaw("codex-force.json");
			expect(raw["access_token"]).toBe("forced-access-2");
			expect(raw["refresh_token"]).toBe("forced-refresh-2");
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("keeps the previous auth file when refresh fails", async () => {
		const { directory, store } = await createStore();
		const server = await startServer((_request, response) => {
			sendJson(response, 500, { error: "invalid_grant", echo: "old-refresh" });
		});
		try {
			await store.writeRaw("codex-fail.json", {
				type: "codex",
				access_token: "old-access",
				refresh_token: "old-refresh",
				email: "fail@example.com",
				expired: new Date(Date.now() - 60_000).toISOString(),
				note: "preserved",
			});
			const before = await readFile(path.join(directory, "codex-fail.json"), "utf8");
			const account = await loadAccount(store, "codex-fail.json");
			const auth = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			let failure: unknown;
			try {
				await auth.refresh(account);
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(ApiError);
			expect(String(failure)).toMatch(/Codex 凭据刷新失败/);
			expect(String(failure)).not.toContain("old-refresh");
			const after = await readFile(path.join(directory, "codex-fail.json"), "utf8");
			expect(after).toBe(before);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("fails clearly when an expired account has no refresh token", async () => {
		const { directory, store } = await createStore();
		let calls = 0;
		const server = await startServer((_request, response) => {
			calls += 1;
			sendJson(response, 200, {});
		});
		try {
			await store.writeRaw("codex-no-refresh.json", {
				type: "codex",
				access_token: "expired-access",
				email: "no-refresh@example.com",
				expired: new Date(Date.now() - 60_000).toISOString(),
			});
			const account = await loadAccount(store, "codex-no-refresh.json");
			const auth = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			await expect(auth.ensureCredential(account)).rejects.toThrow(/refresh_token/);
			expect(calls).toBe(0);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("completes device login after polling and writes compatible fields", async () => {
		const { directory, store } = await createStore();
		let pollCalls = 0;
		const server = await startServer((request, response) => {
			if (request.path === "/device/usercode") {
				expect(request.headers["content-type"]).toBe("application/json");
				expect(JSON.parse(request.body)).toEqual({ client_id: CODEX_OAUTH.clientId });
				sendJson(response, 200, { device_auth_id: "device-auth-1", user_code: "ABCD-EFGH", interval: 1 });
				return;
			}
			if (request.path === "/device/token") {
				pollCalls += 1;
				if (pollCalls < 3) {
					response.statusCode = 403;
					response.end("");
					return;
				}
				sendJson(response, 200, {
					authorization_code: "device-code",
					code_verifier: "device-verifier",
					code_challenge: "device-challenge",
				});
				return;
			}
			if (request.path === "/oauth/token") {
				expect(request.form.get("grant_type")).toBe("authorization_code");
				expect(request.form.get("code")).toBe("device-code");
				expect(request.form.get("code_verifier")).toBe("device-verifier");
				expect(request.form.get("redirect_uri")).toBe(CODEX_OAUTH.deviceRedirectUri);
				sendJson(response, 200, {
					access_token: "device-access",
					refresh_token: "device-refresh",
					id_token: codexClaims("device@example.com", "acct-device", "plus"),
					expires_in: 3600,
				});
				return;
			}
			sendJson(response, 404, {});
		});
		try {
			const auth = createCodexAuth({
				accounts: store,
				tokenUrl: `${server.url}/oauth/token`,
				deviceUserCodeUrl: `${server.url}/device/usercode`,
				deviceTokenUrl: `${server.url}/device/token`,
				deviceVerificationUrl: "https://example.test/device",
				devicePollIntervalMs: 5,
			});
			const started = await auth.startDeviceLogin();
			expect(started.state).toBe("pending");
			expect(started.url).toBe("https://example.test/device");
			expect(started.output.join("\n")).toContain("ABCD-EFGH");
			const finished = await waitForSession(auth, started.id);
			expect(finished.state).toBe("success");
			expect(finished.error).toBeUndefined();
			expect(pollCalls).toBe(3);
			const accounts = await store.list("codex");
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.fileName).toBe(codexCredentialFileName("device@example.com", "plus", "acct-device"));
			const raw = accounts[0]?.raw ?? {};
			expect(raw["type"]).toBe("codex");
			expect(raw["access_token"]).toBe("device-access");
			expect(raw["refresh_token"]).toBe("device-refresh");
			expect(raw["account_id"]).toBe("acct-device");
			expect(raw["email"]).toBe("device@example.com");
			expect(raw["plan_type"]).toBe("plus");
			expect(typeof raw["id_token"]).toBe("string");
			expect(Date.parse(raw["expired"] as string)).toBeGreaterThan(Date.now());
			expect(raw["last_refresh"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("exchanges a pasted callback URL with PKCE and reuses the existing account file", async () => {
		const { directory, store } = await createStore();
		let expectedChallenge = "";
		const server = await startServer((request, response) => {
			if (request.path !== "/oauth/token") {
				sendJson(response, 404, {});
				return;
			}
			expect(request.form.get("grant_type")).toBe("authorization_code");
			expect(request.form.get("code")).toBe("login-code");
			expect(request.form.get("redirect_uri")).toBe(CODEX_OAUTH.redirectUri);
			const verifier = request.form.get("code_verifier") ?? "";
			const challenge = createHash("sha256").update(verifier).digest("base64url");
			expect(challenge).toBe(expectedChallenge);
			sendJson(response, 200, {
				access_token: "login-access",
				refresh_token: "login-refresh",
				id_token: codexClaims("login@example.com", "acct-login", "pro"),
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("legacy-codex.json", {
				type: "codex",
				access_token: "legacy-access",
				refresh_token: "legacy-refresh",
				id_token: codexClaims("login@example.com", "acct-login", "pro"),
				account_id: "acct-login",
				email: "login@example.com",
				plan_type: "pro",
				expired: new Date(Date.now() - 60_000).toISOString(),
				note: "legacy-note",
			});
			const auth = createCodexAuth({ accounts: store, tokenUrl: `${server.url}/oauth/token` });
			const started = await auth.startLogin();
			expect(started.state).toBe("pending");
			expect(started.prompt).toBeTruthy();
			const authUrl = new URL(started.url as string);
			expect(authUrl.searchParams.get("client_id")).toBe(CODEX_OAUTH.clientId);
			expect(authUrl.searchParams.get("redirect_uri")).toBe(CODEX_OAUTH.redirectUri);
			expect(authUrl.searchParams.get("scope")).toBe(CODEX_OAUTH.scope);
			expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
			const state = authUrl.searchParams.get("state") ?? "";
			expectedChallenge = authUrl.searchParams.get("code_challenge") ?? "";
			expect(state).toBeTruthy();
			expect(expectedChallenge).toBeTruthy();
			const callback = `http://localhost:1455/auth/callback?code=login-code&state=${encodeURIComponent(state)}`;
			const finished = await auth.submitLoginInput(started.id, callback);
			expect(finished.state).toBe("success");
			expect(finished.error).toBeUndefined();
			const accounts = await store.list("codex");
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.fileName).toBe("legacy-codex.json");
			const raw = accounts[0]?.raw ?? {};
			expect(raw["access_token"]).toBe("login-access");
			expect(raw["refresh_token"]).toBe("login-refresh");
			expect(raw["account_id"]).toBe("acct-login");
			expect(raw["email"]).toBe("login@example.com");
			expect(raw["plan_type"]).toBe("pro");
			expect(raw["note"]).toBe("legacy-note");
			expect(raw["type"]).toBe("codex");
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("rejects a callback URL whose state does not match", async () => {
		const { directory, store } = await createStore();
		try {
			const auth = createCodexAuth({ accounts: store });
			const started = await auth.startLogin();
			await expect(auth.submitLoginInput(started.id, "http://localhost:1455/auth/callback?code=abc&state=wrong")).rejects.toThrow(
				/state/,
			);
			const polled = await auth.pollLogin(started.id);
			expect(polled.state).toBe("error");
			expect(polled.error).toContain("state");
			await auth.cancelLogin(started.id);
			await expect(auth.pollLogin(started.id)).rejects.toThrow(/登录会话不存在/);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
	it("refreshes the nested SIWC partition for non-Codex clients", async () => {
		const { directory, store } = await createStore();
		let refreshCalls = 0;
		const server = await startServer((request, response) => {
			expect(request.path).toBe("/siwc/token");
			expect(request.form.get("grant_type")).toBe("refresh_token");
			expect(request.form.get("refresh_token")).toBe("siwc-refresh");
			expect(request.form.get("client_id")).toBe("dynamic_agent_client");
			expect(request.form.get("resource")).toBe(CODEX_OAUTH.siwcResource);
			refreshCalls += 1;
			sendJson(response, 200, {
				access_token: "siwc-new-access",
				refresh_token: "siwc-new-refresh",
				id_token: codexClaims("siwc@example.com", "acct-siwc", "pro"),
				scope: `openid ${CODEX_OAUTH.siwcDirectScope}`,
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("codex-siwc.json", {
				type: "codex",
				access_token: "outer-access",
				refresh_token: "outer-refresh",
				expired: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				use_siwc: true,
				siwc: {
					access_token: "siwc-old-access",
					refresh_token: "siwc-refresh",
					client_id: "dynamic_agent_client",
					expired: new Date(Date.now() - 60_000).toISOString(),
					email: "siwc@example.com",
				},
			});
			const account = await loadAccount(store, "codex-siwc.json");
			const auth = createCodexAuth({
				accounts: store,
				tokenUrl: `${server.url}/oauth/token`,
				siwcTokenUrl: `${server.url}/siwc/token`,
			});
			await expect(auth.ensureCredentialForRequest(account, {})).resolves.toBe("siwc-new-access");
			await expect(auth.ensureCredentialForRequest(account, { "user-agent": "codex_cli_rs/1.0" })).resolves.toBe("outer-access");
			expect(refreshCalls).toBe(1);
			const raw = await store.readRaw("codex-siwc.json");
			expect(raw["access_token"]).toBe("outer-access");
			expect(raw["refresh_token"]).toBe("outer-refresh");
			const siwc = raw["siwc"] as Record<string, unknown>;
			expect(siwc["access_token"]).toBe("siwc-new-access");
			expect(siwc["refresh_token"]).toBe("siwc-new-refresh");
			expect(siwc["client_id"]).toBe("dynamic_agent_client");
			expect(siwc["email"]).toBe("siwc@example.com");
			expect(Date.parse(siwc["expired"] as string)).toBeGreaterThan(Date.now());
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
