/**
 * 请求级上下文契约：幂等、同请求传播、统计口径、按类型处置。
 */
import { PrivacyContext } from "./PrivacyContext";
import { DEFAULT_PRIVACY_MASKING_SETTINGS, parsePrivacyMaskingSettings } from "./PrivacyConfig";

/**
 * 构造上下文。
 * @param overrides - 配置覆盖
 * @param extras - 词条与凭据
 */
function makeContext(
	overrides: Record<string, unknown> = {},
	extras: { customWords?: Array<{ value: string }>; configuredSecrets?: string[] } = {},
): PrivacyContext {
	const settings = parsePrivacyMaskingSettings({ ...overrides });
	return new PrivacyContext({
		settings: settings,
		customWords: extras.customWords ?? settings.customWords,
		configuredSecrets: extras.configuredSecrets ?? [],
	});
}

describe("PrivacyContext", () => {
	it("脱敏后再次脱敏结果不变（幂等）", () => {
		const context = makeContext();
		const once = context.maskText("mail jansen@liasece.com and key sk-proj-abcdefghijklmnopqrstuvwxyz");
		const twice = context.maskText(once);
		expect(twice).toBe(once);
		expect(once).toContain("{{EMAIL_");
		expect(once).toContain("{{API_KEY_");
	});

	it("同一个值在后续文本里复用同一个占位符", () => {
		const context = makeContext();
		const first = context.maskText("jansen@liasece.com");
		const second = context.maskText("reply to jansen@liasece.com");
		expect(first).toMatch(/^\{\{EMAIL_[a-z2-7]{8}\}\}$/);
		expect(second).toContain(first);
	});

	it("后续文本即使缺少语境也会复用已登记的值", () => {
		const context = makeContext();
		const masked = context.maskText('API_KEY="supersecretvalue123"');
		expect(masked).toContain("{{SECRET_");
		// 只出现值本身（没有 KEY= 语境）也能被替换
		const later = context.maskText("the value supersecretvalue123 appears again");
		expect(later).not.toContain("supersecretvalue123");
	});

	it("统计处数、值数与类型分布", () => {
		const context = makeContext();
		context.maskText("a@liasece.com b@liasece.com c@liasece.com");
		const stats = context.snapshotStats();
		expect(stats.occurrences).toBe(3);
		expect(stats.distinctValues).toBe(3);
		expect(stats.kinds["EMAIL"]).toBe(3);
		expect(stats.action).toBe("mask");
	});

	it("值级统计只包含指纹、长度与前 3 个字符", () => {
		const context = makeContext();
		context.maskText("phone 13800138000");
		const rows = context.valueStats();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("PHONE");
		expect(rows[0]?.length).toBe(11);
		expect(rows[0]?.hint).toBe("138");
		expect(rows[0]?.hash).toMatch(/^[a-z2-7]{8}$/);
	});

	it("warn 模式只统计不替换", () => {
		const context = makeContext({ action: "warn" });
		const output = context.maskText("mail jansen@liasece.com");
		expect(output).toContain("jansen@liasece.com");
		const stats = context.snapshotStats();
		expect(stats.occurrences).toBe(1);
		expect(stats.action).toBe("warn");
	});

	it("可以按类型关闭", () => {
		const context = makeContext({ kinds: { EMAIL: "off" } });
		const output = context.maskText("mail jansen@liasece.com key sk-proj-abcdefghijklmnopqrstuvwxyz");
		expect(output).toContain("jansen@liasece.com");
		expect(output).toContain("{{API_KEY_");
	});

	it("白名单值不脱敏", () => {
		const context = makeContext({ never_mask: ["jansen@liasece.com"] });
		expect(context.maskText("jansen@liasece.com")).toBe("jansen@liasece.com");
	});

	it("工具参数 JSON 保持结构并脱敏叶子", () => {
		const context = makeContext();
		const output = context.maskJsonText(JSON.stringify({ email: "jansen@liasece.com", nested: { token: "sk-proj-abcdefghijklmnopqrstuvwxyz" } }));
		const parsed = JSON.parse(output) as { email: string; nested: { token: string } };
		expect(parsed.email).toMatch(/^\{\{EMAIL_/);
		expect(parsed.nested.token).toMatch(/^\{\{API_KEY_/);
	});

	it("非法 JSON 退化为文本脱敏", () => {
		const context = makeContext();
		const output = context.maskJsonText('{"email": "jansen@liasece.com"');
		expect(output).not.toContain("jansen@liasece.com");
	});

	it("配置凭据按精确匹配替换", () => {
		const context = makeContext({}, { configuredSecrets: ["provider-key-abc123456"] });
		expect(context.maskText("key provider-key-abc123456 here")).toContain("{{SECRET_");
	});

	it("默认配置为开启且直接替换", () => {
		expect(DEFAULT_PRIVACY_MASKING_SETTINGS.enabled).toBe(true);
		expect(DEFAULT_PRIVACY_MASKING_SETTINGS.action).toBe("mask");
	});
});
