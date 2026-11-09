/** 脱敏页派生逻辑：只验证会影响用户看到什么的规则。 */
import { describe, expect, it } from "vitest";
import {
	PRIVACY_ACTION_OPTIONS,
	PRIVACY_FEATURE_GROUPS,
	PRIVACY_KIND_ACTIONS,
	privacyBlockedFeatureCount,
	PRIVACY_RETENTION_OPTIONS,
	privacyBreakdownLabel,
	privacyBreakdownNote,
	privacyClientLabel,
	privacyCount,
	privacyDisabledFeatureCount,
	privacyKindAction,
	privacyRuleFrom,
	privacyRuleLabel,
	privacyRuleSignature,
	privacyRulesWithAdded,
	privacyRulesWithout,
	PRIVACY_SCOPE_CONSTRAINTS,
	privacyScopeSummary,
	privacyScopeWithAdded,
	privacyScopeWithout,
	privacyKindTone,
	privacyKindsWithAction,
	privacyWordValues,
	privacyWordsWithAdded,
	privacyWordsWithout,
	privacyKindsSummary,
	privacyProviderLabel,
	privacyRequestTableRow,
	privacyShare,
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

	it("占比对 0 与非 0 都稳定", () => {
		expect(privacyShare(0, 0)).toBe("0%");
		expect(privacyShare(3, 4)).toBe("75%");
		expect(privacyShare(1, 400)).toBe("0.3%");
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

	it("过滤特性的处置缺省是替换，配置里只记录非缺省项", () => {
		expect(privacyKindAction({}, "EMAIL")).toBe("mask");
		expect(privacyKindAction({ EMAIL: "off" }, "EMAIL")).toBe("off");
		const next = privacyKindsWithAction({ EMAIL: "warn", PHONE: "off" }, "EMAIL", "mask");
		expect(next).toEqual({ PHONE: "off" });
		const off = privacyKindsWithAction({}, "USER", "off");
		expect(off).toEqual({ USER: "off" });
	});

	it("未在替换的特性数量包含仅统计与关闭", () => {
		expect(privacyDisabledFeatureCount({})).toBe(0);
		expect(privacyDisabledFeatureCount({ EMAIL: "warn", PHONE: "off", USER: "mask" })).toBe(2);
	});

	it("面板里的类型都是后端认识的类型，处置选项覆盖三种动作", () => {
		const kinds = PRIVACY_FEATURE_GROUPS.flatMap((group) => group.features.map((feature) => feature.kind));
		expect([...kinds].sort()).toEqual(
			[
				"API_KEY",
				"BANK_CARD",
				"BEARER",
				"CN_ID",
				"CUSTOM",
				"EMAIL",
				"IBAN",
				"JWT",
				"PASSWORD",
				"PEM",
				"PHONE",
				"SECRET",
				"SSN",
				"USER",
			].sort(),
		);
		expect(PRIVACY_KIND_ACTIONS.map((option) => option.value)).toEqual(["mask", "warn", "block", "off"]);
		for (const group of PRIVACY_FEATURE_GROUPS) {
			for (const feature of group.features) {
				expect(feature.description.length).toBeGreaterThan(0);
			}
		}
	});

	it("词条归一化兼容字符串与 { value } 两种写法", () => {
		expect(privacyWordValues([" acme.io ", { value: "内网主机" }, "  ", { value: " " }])).toEqual(["acme.io", "内网主机"]);
	});

	it("追加词条时忽略空白、重复与越界，移除时忽略大小写", () => {
		const base = ["acme.io"];
		expect(privacyWordsWithAdded(base, "  ", 2)).toBe(base);
		expect(privacyWordsWithAdded(base, "ACME.IO", 2)).toBe(base);
		expect(privacyWordsWithAdded(base, "x", 2)).toBe(base);
		expect(privacyWordsWithAdded(base, " internal.host ", 2)).toEqual(["acme.io", "internal.host"]);
		expect(privacyWordsWithout(base, "ACME.IO")).toEqual([]);
		expect(privacyWordsWithout(base, "other")).toBe(base);
	});

	it("全局处置与保留天数选项与后端取值一致", () => {
		expect(PRIVACY_ACTION_OPTIONS.map((option) => option.value)).toEqual(["mask", "warn"]);
		expect(PRIVACY_RETENTION_OPTIONS.map((option) => Number(option.value))).toEqual([7, 30, 90, 365]);
	});

	it("规则按类型与表达式校验，前缀与正则二选一", () => {
		expect(privacyRuleFrom("ticket", "prefix", "ACME-")).toEqual({ kind: "TICKET", prefix: "ACME-" });
		expect(privacyRuleFrom("ORG_ID", "regex", "org_[a-z0-9]{12}")).toEqual({ kind: "ORG_ID", regex: "org_[a-z0-9]{12}" });
		expect(privacyRuleFrom("bad kind", "prefix", "ACME-")).toBeNull();
		expect(privacyRuleFrom("TICKET", "prefix", "  ")).toBeNull();
		expect(privacyRuleFrom("TICKET", "regex", "([a-z")).toBeNull();
	});

	it("规则追加去重、删除按标识，未变化时返回原数组", () => {
		const ticket = { kind: "TICKET", prefix: "ACME-" };
		const base = [ticket];
		expect(privacyRulesWithAdded(base, { kind: "TICKET", prefix: "ACME-" })).toBe(base);
		expect(privacyRulesWithAdded(base, { kind: "ORG_ID", regex: "org_[a-z]+" })).toHaveLength(2);
		expect(privacyRulesWithout(base, privacyRuleSignature(ticket))).toEqual([]);
		expect(privacyRulesWithout(base, "nope")).toBe(base);
		expect(privacyRuleLabel(ticket)).toBe("TICKET · ACME-");
		expect(privacyRuleLabel({ kind: "ORG_ID", regex: "org_[a-z]+" })).toBe("ORG_ID · /org_[a-z]+/");
	});

	it("拒绝请求的类型单独计数，不计入未替换", () => {
		expect(privacyBlockedFeatureCount({ API_KEY: "block", EMAIL: "warn" })).toBe(1);
		expect(privacyBlockedFeatureCount({ EMAIL: "off" })).toBe(0);
		expect(PRIVACY_KIND_ACTIONS.map((option) => option.value)).toEqual(["mask", "warn", "block", "off"]);
	});

	it("生效范围追加去空白、忽略大小写重复与长度上限", () => {
		const base = ["opencode"];
		expect(privacyScopeWithAdded(base, "  ")).toBe(base);
		expect(privacyScopeWithAdded(base, "OPENCODE")).toBe(base);
		expect(privacyScopeWithAdded(base, "x".repeat(PRIVACY_SCOPE_CONSTRAINTS.maxLength + 1))).toBe(base);
		expect(privacyScopeWithAdded(base, " deepseek ")).toEqual(["opencode", "deepseek"]);
		const full = Array.from({ length: PRIVACY_SCOPE_CONSTRAINTS.maxCount }, (_value, index) => `p${index}`);
		expect(privacyScopeWithAdded(full, "extra")).toBe(full);
	});

	it("生效范围移除忽略大小写，未变化时返回原数组", () => {
		const base = ["OpenCode", "deepseek"];
		expect(privacyScopeWithout(base, "opencode")).toEqual(["deepseek"]);
		expect(privacyScopeWithout(base, "missing")).toBe(base);
	});

	it("生效范围摘要说明当前是否限制到具体提供方与模型", () => {
		expect(privacyScopeSummary([], [])).toBe("当前对所有提供方与模型生效");
		expect(privacyScopeSummary(["opencode"], [])).toBe("当前只对提供方 opencode 生效");
		expect(privacyScopeSummary([], ["opencode-go/deepseek-v4.1-flash"])).toBe("当前只对模型 opencode-go/deepseek-v4.1-flash 生效");
		expect(privacyScopeSummary(["opencode"], ["opencode-go/*"])).toBe("当前只对提供方 opencode，模型 opencode-go/* 生效");
	});
});
