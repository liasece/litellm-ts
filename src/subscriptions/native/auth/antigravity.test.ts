import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "../../../core/utils/logger";
import { SubscriptionAccountStore } from "../accountStore";
import type { SubscriptionAccount } from "../types";
import { createAntigravityAuth } from "./antigravity";
import {
	ANTIGRAVITY_CLIENT_ID,
	ANTIGRAVITY_ONBOARD_USER_AGENT,
	ANTIGRAVITY_REDIRECT_URI,
	ANTIGRAVITY_SCOPES,
} from "./antigravityConstants";

/** 固定“当前时间”，让 token 到期字段可以精确断言。 */
const FIXED_NOW = Date.parse("2026-11-10T06:00:00.000Z");

/** 一份 auth 文件迁移后的到期时间（3599 秒，无毫秒）。 */
const REFRESHED_EXPIRED = "2026-11-10T06:59:59Z";

/** Antigravity 用到的端点。 */
const ENDPOINTS = {
	token: "https://oauth2.googleapis.com/token",
	userinfo: "https://www.googleapis.com/oauth2/v2/userinfo?alt=json",
	loadCodeAssist: "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
	onboardUser: "https://daily-cloudcode-pa.googleapis.com/v1internal:onboardUser",
} as const;

/** 记录下来的上游请求。 */
interface RecordedCall {
	/** 完整 URL。 */
	readonly url: string;
	/** HTTP 方法。 */
	readonly method: string;
	/** 小写化的请求头。 */
	readonly headers: Readonly<Record<string, string>>;
	/** 请求体文本。 */
	readonly body: string;
}

/** 单个请求的响应生成器。 */
type FetchRoute = (call: RecordedCall) => Response;

/** 可注入的 fetch 与调用记录。 */
interface FetchRecorder {
	/** `typeof fetch` 形状的实现。 */
	readonly fetchImpl: typeof fetch;
	/** 依调用顺序记录的请求。 */
	readonly calls: RecordedCall[];
}

let authDir: string;

let store: SubscriptionAccountStore;

beforeEach(async () => {
	authDir = await mkdtemp(path.join(tmpdir(), "antigravity-auth-"));
	store = new SubscriptionAccountStore({ authDir: authDir });
});

afterEach(async () => {
	await rm(authDir, { recursive: true, force: true });
});

/**
 * 构造可记录调用的 fetch。
 * @param handler - 请求处理函数
 */
function createFetch(handler: FetchRoute): FetchRecorder {
	const calls: RecordedCall[] = [];
	const implementation = jest.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
			headers[key.toLowerCase()] = value;
		}
		const call: RecordedCall = {
			url: url,
			method: init?.method ?? "GET",
			headers: headers,
			body: typeof init?.body === "string" ? init.body : "",
		};
		calls.push(call);
		return handler(call);
	});
	return { fetchImpl: implementation as unknown as typeof fetch, calls: calls };
}

/**
 * 按端点路由请求；未声明的端点直接失败。
 * @param routes - 端点处理表
 */
function routeFetch(routes: Readonly<Record<string, FetchRoute>>): FetchRecorder {
	return createFetch((call) => {
		const route = routes[call.url];
		if (!route) {
			throw new Error(`未预期的请求：${call.method} ${call.url}`);
		}
		return route(call);
	});
}

/**
 * 构造 JSON 响应。
 * @param body - JSON 体
 * @param status - 状态码
 */
function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { "Content-Type": "application/json" } });
}

/**
 * 已过期、带完整字段的 auth JSON。
 * @param overrides - 覆盖字段；值为 undefined 时删除该字段
 */
function expiredAuthFile(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	const raw: Record<string, unknown> = {
		type: "antigravity",
		access_token: "old-access",
		refresh_token: "old-refresh",
		expires_in: 3600,
		timestamp: FIXED_NOW - 7_200_000,
		expired: new Date(FIXED_NOW - 3_600_000).toISOString(),
		email: "user@example.com",
		project_id: "project-existing",
		expires_at: "2020-01-01T00:00:00Z",
		label: "Ops",
		custom_flag: "keep-me",
	};
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) {
			delete raw[key];
		} else {
			raw[key] = value;
		}
	}
	return raw;
}

/**
 * 读取磁盘上的 auth JSON。
 * @param fileName - 文件名
 */
async function readAuthFile(fileName: string): Promise<Record<string, unknown>> {
	return JSON.parse(await readFile(path.join(authDir, fileName), "utf8")) as Record<string, unknown>;
}

/**
 * 列出目录中的账号文件。
 */
async function listAuthFiles(): Promise<string[]> {
	return (await readdir(authDir)).filter((name) => name.endsWith(".json")).sort();
}

/**
 * 从回调 URL 中取出查询参数。
 * @param value - URL 字符串
 */
function queryOf(value: string): URLSearchParams {
	return new URL(value).searchParams;
}

it("刷新过期 token 时在锁内重读文件、原子写回并保留未知字段", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(fileName, expiredAuthFile());
	const staleAccount = await store.findByFileName(fileName);
	expect(staleAccount).toBeDefined();
	// 模拟另一个进程已经轮换了 refresh token：实现必须重读文件而不是用快照。
	await store.patchRaw(fileName, { refresh_token: "file-refresh" });
	const recorder = routeFetch({
		[ENDPOINTS.token]: () =>
			jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3599, token_type: "Bearer" }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});

	await auth.refresh(staleAccount as SubscriptionAccount);

	const saved = await readAuthFile(fileName);
	expect(saved).toMatchObject({
		type: "antigravity",
		access_token: "new-access",
		refresh_token: "new-refresh",
		expires_in: 3599,
		timestamp: FIXED_NOW,
		expired: REFRESHED_EXPIRED,
		email: "user@example.com",
		project_id: "project-existing",
		expires_at: REFRESHED_EXPIRED,
		label: "Ops",
		custom_flag: "keep-me",
	});
	expect(recorder.calls).toHaveLength(1);
	const tokenCall = recorder.calls[0] as RecordedCall;
	expect(tokenCall.method).toBe("POST");
	const form = new URLSearchParams(tokenCall.body);
	expect(form.get("grant_type")).toBe("refresh_token");
	expect(form.get("refresh_token")).toBe("file-refresh");
	expect(form.get("client_id")).toBe(ANTIGRAVITY_CLIENT_ID);
	expect(form.get("client_secret")).toBeTruthy();
	// 刷新链路不应把 token 写进日志或错误信息；这里确认没有额外请求。
	expect(await listAuthFiles()).toEqual([fileName]);
});

it("刷新失败时保留旧 auth 文件", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(fileName, expiredAuthFile());
	const before = await readAuthFile(fileName);
	const account = await store.findByFileName(fileName);
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => new Response('{"error":"invalid_grant"}', { status: 400 }),
	});
	const auth = createAntigravityAuth({ accounts: store, fetch: recorder.fetchImpl, now: () => FIXED_NOW });

	await expect(auth.refresh(account as SubscriptionAccount)).rejects.toThrow(/token 刷新失败/);

	expect(await readAuthFile(fileName)).toEqual(before);
	expect(await listAuthFiles()).toEqual([fileName]);
});

it("access token 剩余时间充足时直接返回，不发网络请求", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(
		fileName,
		expiredAuthFile({ expired: new Date(FIXED_NOW + 600_000).toISOString(), project_id: "project-existing" }),
	);
	const account = await store.findByFileName(fileName);
	const recorder = routeFetch({});
	const auth = createAntigravityAuth({ accounts: store, fetch: recorder.fetchImpl, now: () => FIXED_NOW });

	await expect(auth.ensureCredential(account as SubscriptionAccount)).resolves.toBe("old-access");
	expect(recorder.calls).toHaveLength(0);
});

it("access token 距到期不足 5 分钟时先刷新再返回", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(
		fileName,
		expiredAuthFile({ expired: new Date(FIXED_NOW + 4 * 60_000).toISOString(), project_id: "project-existing" }),
	);
	const account = await store.findByFileName(fileName);
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => jsonResponse({ access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3599 }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});

	await expect(auth.ensureCredential(account as SubscriptionAccount)).resolves.toBe("fresh-access");
	expect(recorder.calls).toHaveLength(1);
	expect((await readAuthFile(fileName))["access_token"]).toBe("fresh-access");
});

it("缺少到期信息时保守刷新而不是直接使用 token", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(fileName, {
		type: "antigravity",
		access_token: "unknown-expiry-access",
		refresh_token: "unknown-expiry-refresh",
		email: "user@example.com",
		project_id: "project-existing",
	});
	const account = await store.findByFileName(fileName);
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => jsonResponse({ access_token: "refreshed-access", expires_in: 3599 }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});

	await expect(auth.ensureCredential(account as SubscriptionAccount)).resolves.toBe("refreshed-access");
	expect(recorder.calls).toHaveLength(1);
	const saved = await readAuthFile(fileName);
	expect(saved["access_token"]).toBe("refreshed-access");
	expect(saved["refresh_token"]).toBe("unknown-expiry-refresh");
	expect(saved["expired"]).toBe(REFRESHED_EXPIRED);
});

it("有效 token 缺少 project_id 时通过 loadCodeAssist 补齐并写回", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(
		fileName,
		expiredAuthFile({
			project_id: undefined,
			expired: new Date(FIXED_NOW + 600_000).toISOString(),
		}),
	);
	const account = await store.findByFileName(fileName);
	const recorder = routeFetch({
		[ENDPOINTS.loadCodeAssist]: () => jsonResponse({ projectId: "project-from-load" }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});

	await expect(auth.ensureCredential(account as SubscriptionAccount)).resolves.toBe("old-access");
	expect(recorder.calls).toHaveLength(1);
	const loadCall = recorder.calls[0] as RecordedCall;
	expect(loadCall.method).toBe("POST");
	expect(loadCall.headers["authorization"]).toBe("Bearer old-access");
	expect(loadCall.headers["user-agent"]).toMatch(/^antigravity\/hub\//);
	expect(loadCall.headers["x-goog-api-client"]).toBeUndefined();
	expect(JSON.parse(loadCall.body)).toEqual({ metadata: { ideType: "ANTIGRAVITY" } });

	const saved = await readAuthFile(fileName);
	expect(saved["project_id"]).toBe("project-from-load");
	expect(saved["label"]).toBe("Ops");
	expect(saved["custom_flag"]).toBe("keep-me");
});

it("刷新后缺 project_id 时用 onboardUser 轮询并写回", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(fileName, expiredAuthFile({ project_id: undefined }));
	const account = await store.findByFileName(fileName);
	let onboardCalls = 0;
	const sleep = jest.fn(async () => undefined);
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3599 }),
		[ENDPOINTS.loadCodeAssist]: () => jsonResponse({ allowedTiers: [{ id: "free-tier", isDefault: true }] }),
		[ENDPOINTS.onboardUser]: () => {
			onboardCalls += 1;
			if (onboardCalls === 1) {
				return jsonResponse({ done: false });
			}
			return jsonResponse({
				done: true,
				response: { cloudaicompanionProject: { id: "project-onboarded", name: "project-onboarded" } },
			});
		},
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: sleep,
	});

	await auth.refresh(account as SubscriptionAccount);

	const saved = await readAuthFile(fileName);
	expect(saved["project_id"]).toBe("project-onboarded");
	expect(saved["access_token"]).toBe("new-access");
	expect(onboardCalls).toBe(2);
	expect(sleep).toHaveBeenCalledTimes(1);
	expect(sleep).toHaveBeenCalledWith(2_000);
	const onboard = recorder.calls.filter((call) => call.url === ENDPOINTS.onboardUser);
	expect(onboard).toHaveLength(2);
	const onboardCall = onboard[0] as RecordedCall;
	expect(onboardCall.headers["authorization"]).toBe("Bearer new-access");
	expect(onboardCall.headers["accept"]).toBe("*/*");
	expect(onboardCall.headers["user-agent"]).toBe(ANTIGRAVITY_ONBOARD_USER_AGENT);
	expect(onboardCall.headers["x-goog-api-client"]).toBe("gl-node/22.21.1");
	expect(JSON.parse(onboardCall.body)).toEqual({
		tier_id: "free-tier",
		metadata: { ide_type: "ANTIGRAVITY", ide_version: "2.29.0", ide_name: "antigravity" },
	});
});

it("onboarding 失败时仍保存新 token，随后 ensureCredential 给出明确错误", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(fileName, expiredAuthFile({ project_id: undefined }));
	const account = await store.findByFileName(fileName);
	const warn = jest.spyOn(logger, "warn").mockImplementation(() => logger);
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => jsonResponse({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3599 }),
		[ENDPOINTS.loadCodeAssist]: () => new Response('{"error":{"code":403}}', { status: 403 }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});

	await auth.refresh(account as SubscriptionAccount);

	const saved = await readAuthFile(fileName);
	expect(saved["access_token"]).toBe("new-access");
	expect(saved["project_id"]).toBeUndefined();
	expect(warn).toHaveBeenCalledTimes(1);
	const warning = String(warn.mock.calls[0]?.[0]);
	expect(warning).toContain(fileName);
	expect(warning).not.toContain("new-access");
	expect(warning).not.toContain("new-refresh");

	await expect(auth.ensureCredential(account as SubscriptionAccount)).rejects.toThrow(/获取 project_id 失败/);
	warn.mockRestore();
});

it("Google OAuth PKCE 登录成功后写入稳定的 auth 文件和 project_id", async () => {
	const recorder = routeFetch({
		[ENDPOINTS.token]: () =>
			jsonResponse({ access_token: "login-access", refresh_token: "login-refresh", expires_in: 3599, token_type: "Bearer" }),
		[ENDPOINTS.userinfo]: () => jsonResponse({ email: "new@example.com" }),
		[ENDPOINTS.loadCodeAssist]: () => jsonResponse({ cloudaicompanionProject: "project-login" }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});

	const started = await auth.startLogin?.();
	expect(started?.state).toBe("pending");
	expect(started?.prompt).toBeTruthy();
	expect(started?.url).toBeDefined();
	const params = queryOf(started?.url as string);
	expect(new URL(started?.url as string).pathname).toBe("/o/oauth2/v2/auth");
	expect(params.get("client_id")).toBe(ANTIGRAVITY_CLIENT_ID);
	expect(params.get("redirect_uri")).toBe(ANTIGRAVITY_REDIRECT_URI);
	expect(params.get("response_type")).toBe("code");
	expect(params.get("access_type")).toBe("offline");
	expect(params.get("prompt")).toBe("consent");
	expect(params.get("scope")).toBe(ANTIGRAVITY_SCOPES.join(" "));
	expect(params.get("code_challenge_method")).toBe("S256");
	const challenge = params.get("code_challenge") as string;
	const state = params.get("state") as string;

	const callback = new URL(ANTIGRAVITY_REDIRECT_URI);
	callback.searchParams.set("code", "auth-code");
	callback.searchParams.set("state", state);
	const result = await auth.submitLoginInput?.(started?.id as string, callback.toString());
	expect(result?.state).toBe("success");
	expect(result?.error).toBeUndefined();
	expect(await listAuthFiles()).toEqual(["antigravity-new@example.com.json"]);
	const saved = await readAuthFile("antigravity-new@example.com.json");
	expect(saved).toMatchObject({
		type: "antigravity",
		access_token: "login-access",
		refresh_token: "login-refresh",
		expires_in: 3599,
		timestamp: FIXED_NOW,
		expired: REFRESHED_EXPIRED,
		email: "new@example.com",
		project_id: "project-login",
		disabled: false,
	});

	const tokenCall = recorder.calls.find((call) => call.url === ENDPOINTS.token) as RecordedCall;
	const form = new URLSearchParams(tokenCall.body);
	expect(form.get("grant_type")).toBe("authorization_code");
	expect(form.get("code")).toBe("auth-code");
	expect(form.get("redirect_uri")).toBe(ANTIGRAVITY_REDIRECT_URI);
	expect(form.get("client_id")).toBe(ANTIGRAVITY_CLIENT_ID);
	const verifier = form.get("code_verifier") as string;
	expect(createHash("sha256").update(verifier).digest("base64url")).toBe(challenge);
	const userinfoCall = recorder.calls.find((call) => call.url === ENDPOINTS.userinfo) as RecordedCall;
	expect(userinfoCall.method).toBe("GET");
	expect(userinfoCall.headers["authorization"]).toBe("Bearer login-access");
	const output = JSON.stringify(result?.output);
	expect(output).not.toContain("login-access");
	expect(output).not.toContain("login-refresh");
	expect(output).not.toContain("auth-code");
});

it("重复登录同一邮箱时复用既有账号文件并保留其未知字段", async () => {
	const fileName = "legacy-antigravity.json";
	await store.writeRaw(fileName, {
		type: "antigravity",
		access_token: "stale-access",
		refresh_token: "stale-refresh",
		email: "new@example.com",
		project_id: "old-project",
		expires_at: "2020-01-01T00:00:00Z",
		disabled: true,
		label: "Primary",
		custom_flag: 7,
	});
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => jsonResponse({ access_token: "login-access", refresh_token: "login-refresh", expires_in: 3599 }),
		[ENDPOINTS.userinfo]: () => jsonResponse({ email: "new@example.com" }),
		[ENDPOINTS.loadCodeAssist]: () => jsonResponse({ cloudaicompanionProject: "project-login" }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});

	const started = await auth.startLogin?.();
	const callback = new URL(ANTIGRAVITY_REDIRECT_URI);
	callback.searchParams.set("code", "auth-code");
	const result = await auth.submitLoginInput?.(started?.id as string, callback.toString());

	expect(result?.state).toBe("success");
	expect(await listAuthFiles()).toEqual([fileName]);
	const saved = await readAuthFile(fileName);
	expect(saved).toMatchObject({
		type: "antigravity",
		access_token: "login-access",
		refresh_token: "login-refresh",
		email: "new@example.com",
		project_id: "project-login",
		expires_at: REFRESHED_EXPIRED,
		disabled: true,
		label: "Primary",
		custom_flag: 7,
	});
});

it("也接受直接粘贴的授权码", async () => {
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => jsonResponse({ access_token: "code-access", refresh_token: "code-refresh", expires_in: 3599 }),
		[ENDPOINTS.userinfo]: () => jsonResponse({ email: "code@example.com" }),
		[ENDPOINTS.loadCodeAssist]: () => jsonResponse({ cloudaicompanionProject: "project-code" }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});
	const started = await auth.startLogin?.();

	const result = await auth.submitLoginInput?.(started?.id as string, "  bare-authorization-code  ");

	expect(result?.state).toBe("success");
	expect(await listAuthFiles()).toEqual(["antigravity-code@example.com.json"]);
	const tokenCall = recorder.calls.find((call) => call.url === ENDPOINTS.token) as RecordedCall;
	expect(new URLSearchParams(tokenCall.body).get("code")).toBe("bare-authorization-code");
});

it("缺少 refresh token 的账号无法刷新且不发请求", async () => {
	const fileName = "antigravity-user@example.com.json";
	await store.writeRaw(fileName, expiredAuthFile({ refresh_token: undefined }));
	const account = await store.findByFileName(fileName);
	const recorder = routeFetch({});
	const auth = createAntigravityAuth({ accounts: store, fetch: recorder.fetchImpl, now: () => FIXED_NOW });

	await expect(auth.refresh(account as SubscriptionAccount)).rejects.toThrow(/缺少 refresh token/);
	expect(recorder.calls).toHaveLength(0);
	expect(await listAuthFiles()).toEqual([fileName]);
});

it("Google 拒绝授权码时登录会话报错且不写文件", async () => {
	const recorder = routeFetch({
		[ENDPOINTS.token]: () => new Response('{"error":"invalid_grant"}', { status: 400 }),
	});
	const auth = createAntigravityAuth({
		accounts: store,
		fetch: recorder.fetchImpl,
		now: () => FIXED_NOW,
		sleep: async () => undefined,
	});
	const started = await auth.startLogin?.();
	const callback = new URL(ANTIGRAVITY_REDIRECT_URI);
	callback.searchParams.set("code", "bad-code");

	const result = await auth.submitLoginInput?.(started?.id as string, callback.toString());

	expect(result?.state).toBe("error");
	expect(result?.error).toMatch(/token 交换失败/);
	expect(result?.error).not.toContain("bad-code");
	expect(await listAuthFiles()).toEqual([]);
	const polled = await auth.pollLogin?.(started?.id as string);
	expect(polled?.state).toBe("error");
});

it("回调 URL 缺少 code 时保持会话以便重试", async () => {
	const recorder = routeFetch({});
	const auth = createAntigravityAuth({ accounts: store, fetch: recorder.fetchImpl, now: () => FIXED_NOW });
	const started = await auth.startLogin?.();

	await expect(auth.submitLoginInput?.(started?.id as string, ANTIGRAVITY_REDIRECT_URI)).rejects.toThrow(/缺少 code/);

	const polled = await auth.pollLogin?.(started?.id as string);
	expect(polled?.state).toBe("pending");
	expect(recorder.calls).toHaveLength(0);
});

it("回调 state 不匹配时终止会话且不请求 token", async () => {
	const recorder = routeFetch({});
	const auth = createAntigravityAuth({ accounts: store, fetch: recorder.fetchImpl, now: () => FIXED_NOW });
	const started = await auth.startLogin?.();
	const callback = new URL(ANTIGRAVITY_REDIRECT_URI);
	callback.searchParams.set("code", "auth-code");
	callback.searchParams.set("state", "not-the-state");

	const result = await auth.submitLoginInput?.(started?.id as string, callback.toString());

	expect(result?.state).toBe("error");
	expect(result?.error).toMatch(/state 不匹配/);
	expect(recorder.calls).toHaveLength(0);
	expect(await listAuthFiles()).toEqual([]);
});

it("登录会话受容量与 TTL 约束", async () => {
	let nowMs = FIXED_NOW;
	const auth = createAntigravityAuth({
		accounts: store,
		now: () => nowMs,
		maxLoginSessions: 1,
		loginSessionTtlMs: 60_000,
	});
	const first = await auth.startLogin?.();
	const second = await auth.startLogin?.();

	await expect(auth.pollLogin?.(first?.id as string)).rejects.toThrow(/不存在或已过期/);
	await expect(auth.pollLogin?.(second?.id as string)).resolves.toMatchObject({ state: "pending" });

	nowMs += 61_000;
	const expired = await auth.pollLogin?.(second?.id as string);
	expect(expired?.state).toBe("error");
	expect(expired?.error).toMatch(/过期/);
	await expect(auth.pollLogin?.(second?.id as string)).rejects.toThrow(/不存在或已过期/);
});
