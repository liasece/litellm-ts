/**
 * 主密钥日志行的展示别名。
 *
 * 回归背景：主密钥请求在 SpendLogs 里只有哈希、没有别名，日志列表的 Key Name
 * 列因此显示 "-"，整批主密钥流量在大盘上无法归属。这里保证按哈希补标签，
 * 且不影响虚拟密钥的真实别名。
 */

import { hashApiKey } from "../core/utils/crypto";
import { MASTER_KEY_SPEND_LOG_ALIAS, annotateSpendLogKeyAlias } from "./spendLogKeyIdentity";

const MASTER_KEY = "sk-test-master-key";
const MASTER_HASH = hashApiKey(MASTER_KEY);
const VIRTUAL_HASH = hashApiKey("sk-test-virtual-key");

describe("annotateSpendLogKeyAlias", () => {
	it("主密钥行补成 Master Key", () => {
		const metadata = annotateSpendLogKeyAlias(MASTER_HASH, null, MASTER_HASH);
		expect(metadata).toEqual({ user_api_key_alias: MASTER_KEY_SPEND_LOG_ALIAS });
	});

	it("保留主密钥行已有的其他 metadata 字段", () => {
		const metadata = annotateSpendLogKeyAlias(MASTER_HASH, { user_api_key: MASTER_HASH, team: "core" }, MASTER_HASH);
		expect(metadata).toEqual({ user_api_key: MASTER_HASH, team: "core", user_api_key_alias: MASTER_KEY_SPEND_LOG_ALIAS });
	});

	it("虚拟密钥已有的别名不被覆盖", () => {
		const original = { user_api_key: VIRTUAL_HASH, user_api_key_alias: "jansen" };
		const metadata = annotateSpendLogKeyAlias(VIRTUAL_HASH, original, MASTER_HASH);
		// 返回同一对象：既有别名说明归属已明确，不该被改写。
		expect(metadata).toBe(original);
	});

	it("虚拟密钥即使没有别名也不冒充主密钥", () => {
		const original = { user_api_key: VIRTUAL_HASH };
		expect(annotateSpendLogKeyAlias(VIRTUAL_HASH, original, MASTER_HASH)).toBe(original);
	});

	it("未配置主密钥时不做任何标注", () => {
		const original = { user_api_key: MASTER_HASH };
		expect(annotateSpendLogKeyAlias(MASTER_HASH, original, null)).toBe(original);
	});

	it("空 api_key 或已删除密钥的哈希保持原样", () => {
		expect(annotateSpendLogKeyAlias("", null, MASTER_HASH)).toBeNull();
		expect(annotateSpendLogKeyAlias(hashApiKey("sk-deleted"), { user_api_key: hashApiKey("sk-deleted") }, MASTER_HASH)).toEqual({
			user_api_key: hashApiKey("sk-deleted"),
		});
	});
});
