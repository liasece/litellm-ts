/**
 * 还原器契约：跨帧拼接、JSON 转义、签名内容跳过、无法还原计数。
 */
import { PlaceholderCodec } from "./PlaceholderCodec";
import { PlaceholderRestorer } from "./PlaceholderRestorer";

const codec = new PlaceholderCodec("test-secret");
const API_KEY = "sk-proj-abcdefghijklmnopqrstuvwxyz";
const EMAIL = "jansen@liasece.com";
const PEM = "-----BEGIN PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END PRIVATE KEY-----";

/**
 * 构造还原器。
 * @param onUnresolved - 计数回调
 */
function makeRestorer(onUnresolved?: () => void): PlaceholderRestorer {
	const tokens = new Map<string, string>([
		[codec.token("API_KEY", API_KEY), API_KEY],
		[codec.token("EMAIL", EMAIL), EMAIL],
		[codec.token("PEM", PEM), PEM],
	]);
	return new PlaceholderRestorer({ tokens: tokens, onUnresolved: onUnresolved });
}

describe("PlaceholderRestorer", () => {
	it("文档级还原完整占位符", () => {
		const restorer = makeRestorer();
		expect(restorer.restoreDocument(`hello ${codec.token("EMAIL", EMAIL)}`)).toBe(`hello ${EMAIL}`);
	});

	it("JSON 文档还原时按字符串转义插入原值", () => {
		const restorer = makeRestorer();
		const document = JSON.stringify({ text: codec.token("PEM", PEM) });
		const restored = restorer.restoreDocument(document, "json");
		const parsed = JSON.parse(restored) as { text: string };
		expect(parsed.text).toBe(PEM);
	});

	it("流式还原可以跨多帧拼接占位符", () => {
		const restorer = makeRestorer();
		const token = codec.token("API_KEY", API_KEY);
		const first = restorer.restoreStreaming("k", `key ${token.slice(0, 5)}`);
		expect(first).toBe("key ");
		const second = restorer.restoreStreaming("k", token.slice(5, 15));
		expect(second).toBe("");
		const third = restorer.restoreStreaming("k", `${token.slice(15)} done`);
		expect(third).toBe(`${API_KEY} done`);
		expect(restorer.hasPending).toBe(false);
	});

	it("普通文本不会被延迟", () => {
		const restorer = makeRestorer();
		expect(restorer.restoreStreaming("k", "hello world")).toBe("hello world");
		expect(restorer.hasPending).toBe(false);
	});

	it("嵌套对象深度还原，但跳过签名与加密载荷", () => {
		const restorer = makeRestorer();
		const token = codec.token("EMAIL", EMAIL);
		const value = {
			text: token,
			signature: `sig-${token}`,
			encrypted_content: `enc-${token}`,
			thinking: token,
			nested: [{ text: token }],
		};
		const restored = restorer.restoreDeep(value) as Record<string, unknown>;
		expect(restored["text"]).toBe(EMAIL);
		expect(restored["signature"]).toBe(`sig-${token}`);
		expect(restored["encrypted_content"]).toBe(`enc-${token}`);
		expect(restored["thinking"]).toBe(token);
		expect((restored["nested"] as Array<{ text: string }>)[0]?.text).toBe(EMAIL);
	});

	it("无法识别的占位符保持原样并计数", () => {
		let unresolved = 0;
		const restorer = makeRestorer(() => {
			unresolved++;
		});
		expect(restorer.restoreDocument("{{EMAIL_zzzzzzzz}}")).toBe("{{EMAIL_zzzzzzzz}}");
		expect(unresolved).toBe(1);
	});
});
