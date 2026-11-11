import { normalizeCodexEncryptedContent } from "./signatureCompatibility";

/** 生成 Codex 原生形状的 encrypted_content。 */
function nativeEncryptedContent(seed = 1): string {
	const payload = Buffer.alloc(73);
	payload[0] = 0x80;
	for (let index = 9; index < payload.length; index++) {
		payload[index] = (index * seed) & 0xff;
	}
	return payload.toString("base64url");
}

describe("normalizeCodexEncryptedContent", () => {
	test("保留 Codex 原生 Fernet 形状", () => {
		const value = nativeEncryptedContent();
		expect(normalizeCodexEncryptedContent(value)).toBe(value);
	});

	test("剥离合法路由后缀，只回放原生载荷", () => {
		const value = nativeEncryptedContent(2);
		expect(normalizeCodexEncryptedContent(`${value}.openrouter`)).toBe(value);
	});

	test("外来 thinking 签名不可回放", () => {
		expect(normalizeCodexEncryptedContent("0279f465-965e-4262-8138-3fe1bb64d27f")).toBeUndefined();
		expect(normalizeCodexEncryptedContent("cpa-ag-compact-v1:abc")).toBeUndefined();
	});

	test("非法路由后缀或非 Codex 载荷不可回放", () => {
		const value = nativeEncryptedContent(3);
		expect(normalizeCodexEncryptedContent(`${value}.bad-suffix!`)).toBeUndefined();
		expect(normalizeCodexEncryptedContent("gAAAA")).toBeUndefined();
		expect(normalizeCodexEncryptedContent("gAAAA.not-base64!")).toBeUndefined();
	});
});
