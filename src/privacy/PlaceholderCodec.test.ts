/**
 * 占位符编解码契约：确定性、类型隔离、字符集安全、前缀集合。
 */
import { PlaceholderCodec, collectPlaceholderPrefixes, isPlaceholderToken, resolvePlaceholderSecret } from "./PlaceholderCodec";

describe("PlaceholderCodec", () => {
	const codec = new PlaceholderCodec("test-secret");

	it("同一个值在任何调用下得到同一个占位符", () => {
		const first = codec.token("EMAIL", "jansen@liasece.com");
		const second = codec.token("EMAIL", "jansen@liasece.com");
		expect(first).toBe(second);
		expect(first).toMatch(/^\{\{EMAIL_[a-z2-7]{8}\}\}$/);
	});

	it("不同值、不同类型互不相同", () => {
		expect(codec.token("EMAIL", "a@b.com")).not.toBe(codec.token("EMAIL", "a@c.com"));
		expect(codec.token("SECRET", "same-value")).not.toBe(codec.token("API_KEY", "same-value"));
	});

	it("字符集不含引号、反斜杠与 base64 特殊字符", () => {
		const token = codec.token("PEM", "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----");
		expect(token).not.toContain('"');
		expect(token).not.toContain("\\");
		expect(token).not.toContain("+");
		expect(token).not.toContain("/");
		expect(token).not.toContain("=");
	});

	it("isPlaceholderToken 只接受完整占位符", () => {
		expect(isPlaceholderToken("{{EMAIL_abcdefgh}}")).toBe(true);
		expect(isPlaceholderToken("prefix {{EMAIL_abcdefgh}}")).toBe(false);
		expect(isPlaceholderToken("{{EMAIL_abcdefgh}} suffix")).toBe(false);
		expect(isPlaceholderToken("{{email_abcdefgh}}")).toBe(false);
		expect(isPlaceholderToken("{{EMAIL_ABCDEFGH}}")).toBe(false);
		expect(isPlaceholderToken("{{EMAIL_abcdefg}}")).toBe(false);
	});

	it("hash 与占位符里的指纹一致", () => {
		const token = codec.token("PHONE", "13800138000");
		expect(token).toContain(codec.hash("PHONE", "13800138000"));
	});

	it("前缀集合包含可跨帧的前缀，但不含单字符", () => {
		const prefixes = collectPlaceholderPrefixes(["{{EMAIL_abcdefgh}}"]);
		expect(prefixes.has("{{")).toBe(true);
		expect(prefixes.has("{{EMAIL_abc")).toBe(true);
		expect(prefixes.has("{")).toBe(false);
		expect(prefixes.has("{{EMAIL_abcdefgh}}")).toBe(false);
	});

	it("未配置密钥时也能稳定工作", () => {
		const secret = resolvePlaceholderSecret();
		expect(typeof secret).toBe("string");
		expect(secret.length).toBeGreaterThan(0);
	});
});
