/**
 * 会话身份解析回归测试。
 *
 * 守住一条业务约定：一次对话在 Logs 里必须是一个会话，而不论客户端用哪种写法
 * 声明它的会话 ID。这里覆盖生产上真实造成拆分的几种写法——Harness 的
 * `session_id` 请求头 + `session-<uuid>` 缓存键、Codex 的 `client_metadata`、
 * 裸 UUID 缓存键、以及 Claude Code 由 user_id 整体分组的既有行为。
 */
import { resolveRequestSessionGroupKey, normalizeSessionUuid } from "./sessionIdentity";

const SESSION = "2e24587f-15e6-4d81-b63d-f5e53668efb3";
const THREAD = "019fa826-205c-7350-9e17-7e76ce77ce43";

describe("会话身份解析", () => {
	it("Harness 的 session- 前缀缓存键归一成裸 UUID 分组键", () => {
		expect(resolveRequestSessionGroupKey({ body: { prompt_cache_key: `session-${SESSION}` }, headers: {} })).toBe(`s:${SESSION}`);
	});

	it("会话请求头与同值缓存键得到同一个分组键", () => {
		const prefixed = `session-${SESSION}`;
		const fromBody = resolveRequestSessionGroupKey({ body: { prompt_cache_key: prefixed }, headers: {} });
		const fromHeader = resolveRequestSessionGroupKey({ body: {}, headers: { session_id: prefixed } });
		expect(fromHeader).toBe(fromBody);
		expect(fromHeader).toBe(`s:${SESSION}`);
	});

	it("同一会话的多次请求即使缓存键写法不同也归入同一会话", () => {
		const groups = [
			resolveRequestSessionGroupKey({ body: { prompt_cache_key: `session-${SESSION}` }, headers: {} }),
			resolveRequestSessionGroupKey({ body: { prompt_cache_key: SESSION }, headers: {} }),
			resolveRequestSessionGroupKey({ body: {}, headers: { session_id: `session-${SESSION}` } }),
			resolveRequestSessionGroupKey({ body: {}, headers: { "session-id": SESSION } }),
			resolveRequestSessionGroupKey({ body: { prompt_cache_key: `session-${SESSION}`.toUpperCase() }, headers: {} }),
		];
		expect(new Set(groups)).toEqual(new Set([`s:${SESSION}`]));
	});

	it("Codex 的 client_metadata 线程 ID 优先于会话头与缓存键", () => {
		expect(
			resolveRequestSessionGroupKey({
				body: {
					client_metadata: { thread_id: THREAD, session_id: SESSION },
					prompt_cache_key: "11111111-1111-4111-8111-111111111111",
				},
				headers: { session_id: "22222222-2222-4222-8222-222222222222" },
			}),
		).toBe(`s:${THREAD}`);
	});

	const CLAUDE_CODE_USER_ID = "user_device-1_account__session_63c6d8fc-3ca5-4f54-8cd9-aae8ca57dad9";

	it("Claude Code 由 user_id 整体分组，不被会话头拆开", () => {
		for (const body of [
			{ metadata: { user_id: CLAUDE_CODE_USER_ID }, prompt_cache_key: `session-${SESSION}` },
			{ metadata: { spend_logs_metadata: { user_id: CLAUDE_CODE_USER_ID } }, prompt_cache_key: `session-${SESSION}` },
		]) {
			expect(
				resolveRequestSessionGroupKey({
					body: body,
					headers: { session_id: `session-${SESSION}` },
				}),
			).toBe(`c:${CLAUDE_CODE_USER_ID}`);
		}
	});

	it("user_id 里内嵌的会话 UUID 参与分组，且让位给显式会话标识", () => {
		const embedded = { metadata: { user_id: `{"device_id":"d-1","session_id":"${SESSION}"}` }, prompt_cache_key: `session-${SESSION}` };
		expect(resolveRequestSessionGroupKey({ body: embedded, headers: {} })).toBe(`s:${SESSION}`);
		expect(resolveRequestSessionGroupKey({ body: embedded, headers: { session_id: THREAD } })).toBe(`s:${THREAD}`);
	});

	it("无法识别为会话标识的值不参与分组", () => {
		for (const value of ["", "   ", "repro-1", "not-a-uuid", "session-", "gpt-5.6-sol"]) {
			expect(normalizeSessionUuid(value)).toBeNull();
			expect(resolveRequestSessionGroupKey({ body: { prompt_cache_key: value }, headers: {} })).toBeUndefined();
		}
	});

	it("请求头与请求体缺失时安全返回 undefined", () => {
		expect(resolveRequestSessionGroupKey({ body: undefined, headers: undefined })).toBeUndefined();
		expect(resolveRequestSessionGroupKey({ body: null, headers: {} })).toBeUndefined();
		expect(resolveRequestSessionGroupKey({ body: "text", headers: {} })).toBeUndefined();
	});
});
