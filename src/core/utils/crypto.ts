/**
 * API 密钥哈希与验证工具
 * 使用 SHA-256 对 API 密钥进行单向哈希，避免明文存储
 */

import * as crypto from "crypto";

/** 哈希算法 */
const HASH_ALGORITHM = "sha256";

/** 摘要编码格式 */
const DIGEST_ENCODING: crypto.BinaryToTextEncoding = "hex";

/**
 * 生成 API 密钥的 SHA-256 哈希值
 * @param key - 明文 API 密钥
 * @returns 十六进制编码的哈希字符串
 */
export function hashApiKey(key: string): string {
	return crypto.createHash(HASH_ALGORITHM).update(key, "utf8").digest(DIGEST_ENCODING);
}

/**
 * 验证 API 密钥是否与哈希值匹配
 * @param key - 待验证的明文 API 密钥
 * @param hash - 存储的哈希值
 * @returns 密钥是否匹配
 */
export function verifyApiKey(key: string, hash: string): boolean {
	const computedHash = hashApiKey(key);

	// 使用 timing-safe 比较防止时序攻击
	if (computedHash.length !== hash.length) {
		return false;
	}
	return crypto.timingSafeEqual(Buffer.from(computedHash, DIGEST_ENCODING), Buffer.from(hash, DIGEST_ENCODING));
}

/**
 * 生成随机 API 密钥
 * 格式为 "sk-" 前缀 + 48 字符随机十六进制字符串
 * @returns 新生成的 API 密钥
 */
export function generateApiKey(): string {
	const randomBytes = crypto.randomBytes(32);
	const hexString = randomBytes.toString("hex");
	return `sk-${hexString}`;
}
