import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "../accountStore";
import { disableInvalidAccount, isTerminalRefreshFailure, refreshFailureMessage } from "./refreshFailure";

it("识别终态刷新错误而不误伤临时失败", () => {
	expect(isTerminalRefreshFailure(new Error('HTTP 400: {"error":"invalid_grant"}'))).toBe(true);
	expect(isTerminalRefreshFailure(new Error("Kimi refresh token 已被拒绝，请重新登录"))).toBe(true);
	expect(isTerminalRefreshFailure(new Error("HTTP 503: upstream unavailable"))).toBe(false);
	expect(isTerminalRefreshFailure(new Error("fetch failed"))).toBe(false);
});

it("清洗错误文本中的长 token", () => {
	const message = refreshFailureMessage(new Error("refresh failed token=abcdefghijklmnopqrstuvwxyz0123456789"));
	expect(message).toContain("token=***");
	expect(message).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
});

it("终态失败会禁用账号并累计失败次数", async () => {
	const directory = await mkdtemp(path.join(tmpdir(), "refresh-failure-"));
	try {
		const store = new SubscriptionAccountStore({ authDir: directory });
		await store.writeRaw("codex-bad.json", {
			type: "codex",
			access_token: "opaque-access-token-value",
			refresh_token: "opaque-refresh-token-value",
		});
		const account = await store.findByFileName("codex-bad.json");
		if (!account) {
			throw new Error("账号未加载");
		}
		await disableInvalidAccount(store, account, new Error("invalid_grant for refresh_token=abcdefghijklmnopqrstuvwxyz0123456789"));
		const raw = await store.readRaw("codex-bad.json");
		expect(raw["disabled"]).toBe(true);
		expect(raw["status"]).toBe("disabled (invalid grant)");
		expect(raw["refresh_failures"]).toBe(1);
		expect(raw["last_error"]).toContain("invalid_grant");
		expect(raw["last_error"]).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
		expect(raw["access_token"]).toBe("opaque-access-token-value");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
