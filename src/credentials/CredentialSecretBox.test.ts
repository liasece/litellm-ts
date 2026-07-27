import * as nodeCrypto from "node:crypto";
import { CredentialSecretBox } from "./CredentialSecretBox";

jest.mock("node:crypto", () => {
	const actual = jest.requireActual<typeof import("node:crypto")>("node:crypto");
	return {
		...actual,
		randomBytes: jest.fn(actual.randomBytes),
	};
});

const FIXED_NONCE = Buffer.from(Array.from({ length: 24 }, (_value, index) => index));
const PY_NACL_URL_SAFE_VECTOR = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXZ8HYOBVM_l16okLzVNMyjIIJNc9tEGLcT05VhSqE";
const PY_NACL_STANDARD_VECTOR = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXZ8HYOBVM/l16okLzVNMyjIIJNc9tEGLcT05VhSqE";

describe("CredentialSecretBox", () => {
	const key = "test-salt-key";

	it("解密 Python PyNaCl SecretBox 生成的 URL-safe 固定向量", () => {
		expect(new CredentialSecretBox(key).decrypt(PY_NACL_URL_SAFE_VECTOR)).toBe("sk-test-secret");
	});

	it("固定 nonce 时 encrypt 字节与 Python PyNaCl golden vector 完全一致", () => {
		const randomBytesMock = jest.mocked(nodeCrypto.randomBytes);
		randomBytesMock.mockReturnValueOnce(FIXED_NONCE as never);
		expect(new CredentialSecretBox(key).encrypt("sk-test-secret")).toBe(PY_NACL_URL_SAFE_VECTOR);
	});

	it("兼容旧标准 Base64 格式", () => {
		expect(new CredentialSecretBox(key).decrypt(PY_NACL_STANDARD_VECTOR)).toBe("sk-test-secret");
	});

	it.each(["凭据🔐", ""])("UTF-8/空字符串 %p 可完整往返", (plaintext) => {
		const box = new CredentialSecretBox(key);
		expect(box.decrypt(box.encrypt(plaintext))).toBe(plaintext);
	});

	it("明确篡改 nonce、MAC 或 ciphertext 均 fail closed", () => {
		const original = Buffer.from(PY_NACL_URL_SAFE_VECTOR, "base64url");
		for (const index of [0, 24, original.length - 1]) {
			const tampered = Buffer.from(original);
			tampered[index] = tampered[index]! ^ 1;
			expect(() => new CredentialSecretBox(key).decrypt(tampered.toString("base64url"))).toThrow("Credential decryption failed");
		}
	});

	it.each([
		["空输入", ""],
		["非法 Base64 长度", "A"],
		["短于 nonce+MAC", Buffer.alloc(39).toString("base64url")],
	])("拒绝%s", (_caseName, ciphertext) => {
		expect(() => new CredentialSecretBox(key).decrypt(ciphertext)).toThrow("Credential decryption failed");
	});

	it("密钥缺失、损坏密文或错误密钥时 fail closed，错误不包含 key 或值", () => {
		expect(() => new CredentialSecretBox("")).toThrow("Credential encryption key is required");
		for (const operation of [
			() => new CredentialSecretBox(key).decrypt("invalid-secret-value"),
			() => new CredentialSecretBox("other-key").decrypt(PY_NACL_URL_SAFE_VECTOR),
		]) {
			try {
				operation();
				throw new Error("Expected decryption to fail");
			} catch (error) {
				expect(error).toMatchObject({ message: "Credential decryption failed" });
				expect(String(error)).not.toContain(key);
				expect(String(error)).not.toContain("other-key");
				expect(String(error)).not.toContain("invalid-secret-value");
			}
		}
	});
});
