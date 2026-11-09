/** 脱敏页派生逻辑：只验证会影响用户看到什么的规则。 */
import { describe, expect, it } from "vitest";
import {
	privacyBreakdownLabel,
	privacyBreakdownNote,
	privacyClientLabel,
	privacyCount,
	privacyKindTone,
	privacyKindsSummary,
	privacyProviderLabel,
	privacyRequestTableRow,
	privacyShare,
	privacyShareWidth,
	privacyValueHint,
	privacyValueTableRow,
} from "./PrivacyLogic";

describe("privacy display logic", () => {
	it("数量按 K/M 缩写，小数字保留原文", () => {
		expect(privacyCount(0)).toBe("0");
		expect(privacyCount(171)).toBe("171");
		expect(privacyCount(2_540)).toBe("2,540");
		expect(privacyCount(59_204)).toBe("59.2K");
		expect(privacyCount(2_400_000)).toBe("2.4M");
	});

	it("占比与条宽对 0 与非 0 都稳定", () => {
		expect(privacyShare(0, 0)).toBe("0%");
		expect(privacyShare(3, 4)).toBe("75%");
		expect(privacyShare(1, 400)).toBe("0.3%");
		expect(privacyShareWidth(0, 10)).toBe(0);
		expect(privacyShareWidth(1, 1000)).toBe(2);
		expect(privacyShareWidth(9, 10)).toBe(90);
	});

	it("客户端与提供方有中文展示名，未知值回退原文", () => {
		expect(privacyClientLabel("claude_code")).toBe("Claude Code");
		expect(privacyClientLabel("pi")).toBe("Pi");
		expect(privacyClientLabel("my-cli")).toBe("my-cli");
		expect(privacyProviderLabel("cliproxy")).toBe("CLIProxy");
		expect(privacyProviderLabel("")).toBe("未知提供方");
	});

	it("类型有中文名与颜色", () => {
		expect(privacyBreakdownLabel("kind", "EMAIL")).toBe("邮箱");
		expect(privacyBreakdownLabel("kind", "CN_ID")).toBe("身份证号");
		expect(privacyKindTone("PEM")).toBe("red");
		expect(privacyKindTone("EMAIL")).toBe("blue");
		expect(privacyKindTone("WHATEVER")).toBe("default");
	});

	it("分组说明区分请求数与值数", () => {
		expect(privacyBreakdownNote("client", { name: "pi", occurrences: 10, requests: 3 })).toBe("3 个请求");
		expect(privacyBreakdownNote("kind", { name: "EMAIL", occurrences: 10, requests: 3, values: 2 })).toBe("2 个不同的值");
	});

	it("请求行类型摘要按次数排序", () => {
		expect(privacyKindsSummary({})).toBe("-");
		expect(privacyKindsSummary({ EMAIL: 1, API_KEY: 3 })).toBe("服务密钥 3 · 邮箱 1");
	});

	it("值行只展示前 3 个字符与长度", () => {
		expect(
			privacyValueHint({
				kind: "PHONE",
				hash: "abcdefgh",
				length: 11,
				hint: "138",
				occurrences: 2,
				requests: 1,
				clients: [],
				lastSeen: "",
			}),
		).toBe("138…（11 字符）");
	});

	it("表格行不包含任何可还原原文的字段", () => {
		const row = privacyRequestTableRow({
			requestId: "req-1",
			createdAt: "2026-11-09T02:00:00.000Z",
			client: "claude_code",
			provider: "cliproxy",
			model: "claude-sonnet-4.5",
			occurrences: 4,
			distinctValues: 3,
			kinds: { EMAIL: 4 },
			action: "mask",
			durationMs: 1200,
			unresolved: 0,
		});
		expect(row["client"]).toBe("Claude Code");
		expect(row["action"]).toBe("已替换");
		expect(row["kinds"]).toBe("邮箱 4");
		expect(row["created"]).not.toBe("");
		const valueRow = privacyValueTableRow({
			kind: "EMAIL",
			hash: "abcdefgh",
			length: 18,
			hint: "jan",
			occurrences: 5,
			requests: 2,
			clients: ["pi", "codex"],
			lastSeen: "2026-11-09T03:00:00.000Z",
		});
		expect(valueRow["hint"]).toBe("jan…（18 字符）");
		expect(valueRow["clients"]).toBe("Pi、Codex");
	});
});
