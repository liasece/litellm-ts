import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { ApiError } from "../../../core/api/ApiError";
import { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount, SubscriptionLoginSession } from "../types";
import { createXaiAuth, type XaiAuthHandler } from "./xai";
import { XAI_OAUTH, xaiCredentialFileName } from "./xaiOAuth";

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
 * 构造 xAI id_token。
 * @param email - 邮箱
 * @param subject - subject
 */
function xaiIdToken(email: string, subject: string): string {
	return jwt({ email: email, sub: subject });
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
async function waitForSession(auth: XaiAuthHandler, id: string): Promise<SubscriptionLoginSession> {
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
	const directory = await mkdtemp(path.join(tmpdir(), "xai-auth-"));
	return { directory: directory, store: new SubscriptionAccountStore({ authDir: directory }) };
}

describe("createXaiAuth", () => {
	it("refreshes an expiring account through the stored token endpoint and keeps unknown fields", async () => {
		const { directory, store } = await createStore();
		let refreshCalls = 0;
		const server = await startServer((request, response) => {
			expect(request.path).toBe("/token");
			expect(request.form.get("grant_type")).toBe("refresh_token");
			expect(request.form.get("client_id")).toBe(XAI_OAUTH.clientId);
			expect(request.form.get("refresh_token")).toBe("old-refresh");
			refreshCalls += 1;
			sendJson(response, 200, {
				access_token: "new-access",
				refresh_token: "new-refresh",
				id_token: xaiIdToken("new@example.com", "sub-new"),
				token_type: "Bearer",
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("xai-old.json", {
				type: "xai",
				access_token: "old-access",
				refresh_token: "old-refresh",
				id_token: xaiIdToken("old@example.com", "sub-old"),
				email: "old@example.com",
				sub: "sub-old",
				base_url: XAI_OAUTH.defaultApiBaseUrl,
				token_endpoint: `${server.url}/token`,
				auth_kind: "oauth",
				expired: new Date(Date.now() - 60_000).toISOString(),
				expires_at: new Date(Date.now() - 60_000).toISOString(),
				last_refresh: "2026-01-01T00:00:00Z",
				note: "keep-me",
			});
			const account = await loadAccount(store, "xai-old.json");
			const auth = createXaiAuth({ accounts: store });
			const credential = await auth.ensureCredential(account);
			expect(credential).toBe("new-access");
			expect(refreshCalls).toBe(1);
			const raw = await store.readRaw("xai-old.json");
			expect(raw["type"]).toBe("xai");
			expect(raw["auth_kind"]).toBe("oauth");
			expect(raw["access_token"]).toBe("new-access");
			expect(raw["refresh_token"]).toBe("new-refresh");
			expect(raw["email"]).toBe("new@example.com");
			expect(raw["sub"]).toBe("sub-new");
			expect(raw["token_type"]).toBe("Bearer");
			expect(raw["expires_in"]).toBe(3600);
			expect(raw["note"]).toBe("keep-me");
			expect(raw["base_url"]).toBe(XAI_OAUTH.defaultApiBaseUrl);
			expect(Date.parse(raw["expired"] as string)).toBeGreaterThan(Date.now());
			expect(raw["expires_at"]).toBe(raw["expired"]);
			expect(raw["last_refresh"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("discovers the token endpoint when the auth file does not store one", async () => {
		const { directory, store } = await createStore();
		let discoveryCalls = 0;
		let baseUrl = "";
		const server = await startServer((request, response) => {
			if (request.path === "/discovery") {
				discoveryCalls += 1;
				sendJson(response, 200, {
					device_authorization_endpoint: `${baseUrl}/device`,
					token_endpoint: `${baseUrl}/token`,
				});
				return;
			}
			if (request.path === "/token") {
				sendJson(response, 200, {
					access_token: "discovered-access",
					refresh_token: "discovered-refresh",
					id_token: xaiIdToken("discover@example.com", "sub-discover"),
					expires_in: 1800,
				});
				return;
			}
			sendJson(response, 404, {});
		});
		baseUrl = server.url;
		try {
			await store.writeRaw("xai-discover.json", {
				type: "xai",
				access_token: "old-access",
				refresh_token: "old-refresh",
				email: "discover@example.com",
				expired: new Date(Date.now() - 60_000).toISOString(),
			});
			const account = await loadAccount(store, "xai-discover.json");
			const auth = createXaiAuth({
				accounts: store,
				discoveryUrl: `${server.url}/discovery`,
				allowInsecureEndpoints: true,
			});
			await auth.refresh(account);
			expect(discoveryCalls).toBe(1);
			const raw = await store.readRaw("xai-discover.json");
			expect(raw["access_token"]).toBe("discovered-access");
			expect(raw["token_endpoint"]).toBe(`${server.url}/token`);
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
				id_token: xaiIdToken("lock@example.com", "sub-lock"),
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("xai-lock.json", {
				type: "xai",
				access_token: "stale-access",
				refresh_token: "stale-refresh",
				email: "lock@example.com",
				token_endpoint: `${server.url}/token`,
				expired: new Date(Date.now() - 60_000).toISOString(),
			});
			const account = await loadAccount(store, "xai-lock.json");
			const first = createXaiAuth({ accounts: store });
			const second = createXaiAuth({ accounts: store });
			const tokens = await Promise.all([first.ensureCredential(account), second.ensureCredential(account)]);
			expect(tokens).toEqual(["concurrent-access", "concurrent-access"]);
			expect(refreshCalls).toBe(1);
			const raw = await store.readRaw("xai-lock.json");
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
				id_token: xaiIdToken("force@example.com", "sub-force"),
				expires_in: 3600,
			});
		});
		try {
			await store.writeRaw("xai-force.json", {
				type: "xai",
				access_token: "{{SECRET_bi3ktuqe}}",
				refresh_token: "{{SECRET_prfp3uxh}}",
				email: "force@example.com",
				sub: "sub-force",
				token_endpoint: `${server.url}/token`,
				expired: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
			});
			const account = await loadAccount(store, "xai-force.json");
			const auth = createXaiAuth({ accounts: store });
			await auth.refresh(account);
			await auth.refresh(account);
			expect(refreshCalls).toBe(2);
			const raw = await store.readRaw("xai-force.json");
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
			await store.writeRaw("xai-fail.json", {
				type: "xai",
				access_token: "old-access",
				refresh_token: "old-refresh",
				email: "fail@example.com",
				token_endpoint: `${server.url}/token`,
				expired: new Date(Date.now() - 60_000).toISOString(),
				note: "preserved",
			});
			const before = await readFile(path.join(directory, "xai-fail.json"), "utf8");
			const account = await loadAccount(store, "xai-fail.json");
			const auth = createXaiAuth({ accounts: store });
			let failure: unknown;
			try {
				await auth.refresh(account);
			} catch (error) {
				failure = error;
			}
			expect(failure).toBeInstanceOf(ApiError);
			expect(String(failure)).toMatch(/xAI 凭据刷新失败/);
			expect(String(failure)).not.toContain("old-refresh");
			const after = await readFile(path.join(directory, "xai-fail.json"), "utf8");
			expect(after).toBe(before);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("completes device login after polling and writes compatible fields", async () => {
		const { directory, store } = await createStore();
		let pollCalls = 0;
		let baseUrl = "";
		const server = await startServer((request, response) => {
			if (request.path === "/discovery") {
				sendJson(response, 200, {
					device_authorization_endpoint: `${baseUrl}/device`,
					token_endpoint: `${baseUrl}/token`,
				});
				return;
			}
			if (request.path === "/device") {
				expect(request.form.get("client_id")).toBe(XAI_OAUTH.clientId);
				expect(request.form.get("scope")).toBe(XAI_OAUTH.scope);
				sendJson(response, 200, {
					device_code: "device-code-1",
					user_code: "USER-CODE-1",
					verification_uri: "https://x.ai/device",
					verification_uri_complete: "https://x.ai/device?user_code=USER-CODE-1",
					expires_in: 60,
					interval: 0,
				});
				return;
			}
			if (request.path === "/token") {
				pollCalls += 1;
				expect(request.form.get("grant_type")).toBe(XAI_OAUTH.deviceGrantType);
				expect(request.form.get("device_code")).toBe("device-code-1");
				expect(request.form.get("client_id")).toBe(XAI_OAUTH.clientId);
				if (pollCalls === 1) {
					sendJson(response, 200, { error: "authorization_pending" });
					return;
				}
				sendJson(response, 200, {
					access_token: "device-access",
					refresh_token: "device-refresh",
					id_token: xaiIdToken("device@example.com", "sub-device"),
					token_type: "Bearer",
					expires_in: 3600,
				});
				return;
			}
			sendJson(response, 404, {});
		});
		baseUrl = server.url;
		try {
			const auth = createXaiAuth({
				accounts: store,
				discoveryUrl: `${server.url}/discovery`,
				allowInsecureEndpoints: true,
				devicePollIntervalMs: 5,
			});
			const started = await auth.startLogin();
			expect(started.state).toBe("pending");
			expect(started.url).toBe("https://x.ai/device?user_code=USER-CODE-1");
			expect(started.output.join("\n")).toContain("USER-CODE-1");
			const finished = await waitForSession(auth, started.id);
			expect(finished.state).toBe("success");
			expect(finished.error).toBeUndefined();
			expect(pollCalls).toBe(2);
			const accounts = await store.list("xai");
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.fileName).toBe(xaiCredentialFileName("device@example.com", "sub-device"));
			const raw = accounts[0]?.raw ?? {};
			expect(raw["type"]).toBe("xai");
			expect(raw["auth_kind"]).toBe("oauth");
			expect(raw["access_token"]).toBe("device-access");
			expect(raw["refresh_token"]).toBe("device-refresh");
			expect(raw["email"]).toBe("device@example.com");
			expect(raw["sub"]).toBe("sub-device");
			expect(raw["token_type"]).toBe("Bearer");
			expect(raw["expires_in"]).toBe(3600);
			expect(raw["base_url"]).toBe(XAI_OAUTH.defaultApiBaseUrl);
			expect(raw["token_endpoint"]).toBe(`${server.url}/token`);
			expect(Date.parse(raw["expired"] as string)).toBeGreaterThan(Date.now());
			expect(raw["last_refresh"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it("reuses the existing account file when the same xAI identity logs in again", async () => {
		const { directory, store } = await createStore();
		let baseUrl = "";
		let pollCalls = 0;
		const server = await startServer((request, response) => {
			if (request.path === "/discovery") {
				sendJson(response, 200, {
					device_authorization_endpoint: `${baseUrl}/device`,
					token_endpoint: `${baseUrl}/token`,
				});
				return;
			}
			if (request.path === "/device") {
				sendJson(response, 200, {
					device_code: "device-code-2",
					user_code: "USER-2",
					verification_uri: "https://x.ai/device",
					expires_in: 60,
				});
				return;
			}
			if (request.path === "/token") {
				pollCalls += 1;
				sendJson(response, 200, {
					access_token: "relogin-access",
					refresh_token: "relogin-refresh",
					id_token: xaiIdToken("same@example.com", "sub-same"),
					expires_in: 3600,
				});
				return;
			}
			sendJson(response, 404, {});
		});
		baseUrl = server.url;
		try {
			await store.writeRaw("xai-legacy.json", {
				type: "xai",
				access_token: "legacy-access",
				refresh_token: "legacy-refresh",
				email: "Same@Example.com",
				sub: "sub-same",
				expired: new Date(Date.now() - 60_000).toISOString(),
				note: "legacy-note",
			});
			const auth = createXaiAuth({
				accounts: store,
				discoveryUrl: `${server.url}/discovery`,
				allowInsecureEndpoints: true,
				devicePollIntervalMs: 5,
			});
			const started = await auth.startLogin();
			const finished = await waitForSession(auth, started.id);
			expect(finished.state).toBe("success");
			expect(pollCalls).toBe(1);
			const accounts = await store.list("xai");
			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.fileName).toBe("xai-legacy.json");
			const raw = accounts[0]?.raw ?? {};
			expect(raw["access_token"]).toBe("relogin-access");
			expect(raw["note"]).toBe("legacy-note");
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
			await store.writeRaw("xai-no-refresh.json", {
				type: "xai",
				access_token: "expired-access",
				email: "no-refresh@example.com",
				token_endpoint: `${server.url}/token`,
				expired: new Date(Date.now() - 60_000).toISOString(),
			});
			const account = await loadAccount(store, "xai-no-refresh.json");
			const auth = createXaiAuth({ accounts: store });
			await expect(auth.ensureCredential(account)).rejects.toThrow(/refresh_token/);
			expect(calls).toBe(0);
		} finally {
			await server.close();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
