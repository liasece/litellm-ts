import { createHash, randomBytes } from "node:crypto";
import nacl from "tweetnacl";

const NONCE_BYTES = nacl.secretbox.nonceLength;
const MIN_CIPHERTEXT_BYTES = NONCE_BYTES + nacl.secretbox.overheadLength;
const BASE64_PATTERN = /^(?:[A-Za-z0-9_-]+|[A-Za-z0-9+/]+)={0,2}$/;

/**
 * 与 Python PyNaCl `SecretBox` 兼容的凭据加密器。
 * 密文格式为 `nonce || MAC || ciphertext` 的 URL-safe Base64。
 */
export class CredentialSecretBox {
	private readonly _key: Uint8Array;

	/** @param encryptionKey - 对齐 Python salt/master key 的原始文本 */
	constructor(encryptionKey: string) {
		if (encryptionKey.length === 0) {
			throw new Error("Credential encryption key is required");
		}
		this._key = createHash("sha256").update(encryptionKey, "utf8").digest();
	}

	/**
	 * 加密 UTF-8 明文为 URL-safe Base64。
	 * @param value
	 * @throws 加密库无法生成认证密文时抛出。
	 */
	encrypt(value: string): string {
		const nonce = randomBytes(NONCE_BYTES);
		const ciphertext = nacl.secretbox(Buffer.from(value, "utf8"), nonce, this._key);
		if (ciphertext === null) {
			throw new Error("Credential encryption failed");
		}
		return Buffer.concat([nonce, Buffer.from(ciphertext)]).toString("base64url");
	}

	/**
	 * 解密 URL-safe Base64，兼容旧的标准 Base64；任何异常均 fail closed。
	 * @param value
	 * @throws 密文格式、认证或密钥不匹配时统一抛出脱敏错误。
	 */
	decrypt(value: string): string {
		try {
			const encrypted = this._decodeBase64(value);
			if (encrypted.length < MIN_CIPHERTEXT_BYTES) {
				throw new Error("ciphertext is too short");
			}
			const plaintext = nacl.secretbox.open(encrypted.subarray(NONCE_BYTES), encrypted.subarray(0, NONCE_BYTES), this._key);
			if (plaintext === null) {
				throw new Error("authentication failed");
			}
			return Buffer.from(plaintext).toString("utf8");
		} catch {
			throw new Error("Credential decryption failed");
		}
	}

	private _decodeBase64(value: string): Buffer {
		if (!BASE64_PATTERN.test(value) || value.length % 4 === 1) {
			throw new Error("invalid base64");
		}
		const decoded = Buffer.from(value, "base64");
		if (decoded.length === 0) {
			throw new Error("empty ciphertext");
		}
		return decoded;
	}
}
