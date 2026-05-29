/**
 * RedisCooldownBackend 单元测试
 *
 * 覆盖：
 * - setCooldown：SET 命令、EX TTL 单位（秒）、JSON payload
 * - getCooldown：JSON 解析、缺失返回 undefined、损坏 JSON 返回 undefined
 * - deleteCooldown：DEL 命令、错误包装
 * - keyPrefix 默认值与自定义值
 */

import type { CooldownCacheValue } from "./CooldownCacheTypes";
import { RedisCooldownBackend, type RedisLike } from "./RedisCooldownBackend";

/**
 * 内存 mock Redis，记录调用 args，便于测试断言。
 * 仅实现 set/get/del/expire 四个方法。
 */
class MockRedis implements RedisLike {
	store = new Map<string, string>();
	setCalls: Array<{ key: string; value: string; args: unknown[] }> = [];
	delCalls: string[] = [];
	expireCalls: Array<{ key: string; seconds: number }> = [];
	setError?: Error;
	delError?: Error;

	async set(key: string, value: string, ...args: unknown[]): Promise<string> {
		this.setCalls.push({ key: key, value: value, args: args });
		if (this.setError) {
			throw this.setError;
		}
		this.store.set(key, value);
		return "OK";
	}

	async get(key: string): Promise<string | null> {
		const v = this.store.get(key);
		return v ?? null;
	}

	async del(key: string): Promise<number> {
		this.delCalls.push(key);
		if (this.delError) {
			throw this.delError;
		}
		const existed = this.store.delete(key);
		return existed ? 1 : 0;
	}

	async expire(key: string, seconds: number): Promise<number> {
		this.expireCalls.push({ key: key, seconds: seconds });
		return 1;
	}
}

const baseValue: CooldownCacheValue = {
	// eslint-disable-next-line camelcase
	exception_received: "rate_limited",

	status_code: 429,
	timestamp: 1_700_000_000_000,

	cooldown_time: 5_000,
};

describe("RedisCooldownBackend", () => {
	describe("setCooldown", () => {
		it("写入完整 JSON payload，使用默认 key prefix", async () => {
			const redis = new MockRedis();
			const backend = new RedisCooldownBackend(redis);
			await backend.setCooldown("gpt-4", baseValue);
			expect(redis.setCalls).toHaveLength(1);
			const call = redis.setCalls[0]!;
			expect(call.key).toBe("litellm:cooldown:gpt-4");
			expect(JSON.parse(call.value)).toEqual(baseValue);
		});

		it("EX TTL 以秒为单位，cooldown_time(ms)/1000 向上取整", async () => {
			const redis = new MockRedis();
			const backend = new RedisCooldownBackend(redis);

			await backend.setCooldown("a", { ...baseValue, cooldown_time: 5_000 });
			expect(redis.setCalls[0]!.args).toEqual(["EX", 5]);

			await backend.setCooldown("b", { ...baseValue, cooldown_time: 7_100 });
			expect(redis.setCalls[1]!.args).toEqual(["EX", 8]);
		});

		it("cooldown_time < 1000ms 时 TTL 至少 1 秒（避免 EX 0 直接失效）", async () => {
			const redis = new MockRedis();
			const backend = new RedisCooldownBackend(redis);

			await backend.setCooldown("tiny", { ...baseValue, cooldown_time: 100 });
			expect(redis.setCalls[0]!.args).toEqual(["EX", 1]);
		});

		it("自定义 keyPrefix 生效", async () => {
			const redis = new MockRedis();
			const backend = new RedisCooldownBackend(redis, "myapp:cd:");
			await backend.setCooldown("gpt-4", baseValue);
			expect(redis.setCalls[0]!.key).toBe("myapp:cd:gpt-4");
		});

		it("Redis SET 失败包装为 RedisCooldownBackend 错误", async () => {
			const redis = new MockRedis();
			redis.setError = new Error("ECONNREFUSED");
			const backend = new RedisCooldownBackend(redis);
			await expect(backend.setCooldown("gpt-4", baseValue)).rejects.toThrow(/RedisCooldownBackend\.setCooldown failed: ECONNREFUSED/);
		});
	});

	describe("getCooldown", () => {
		it("读取并 JSON 反序列化为 CooldownCacheValue", async () => {
			const redis = new MockRedis();
			redis.store.set("litellm:cooldown:gpt-4", JSON.stringify(baseValue));
			const backend = new RedisCooldownBackend(redis);
			const got = await backend.getCooldown("gpt-4");
			expect(got).toEqual(baseValue);
		});

		it("key 不存在返回 undefined", async () => {
			const backend = new RedisCooldownBackend(new MockRedis());
			const got = await backend.getCooldown("missing");
			expect(got).toBeUndefined();
		});

		it("JSON 解析失败返回 undefined（不抛错）", async () => {
			const redis = new MockRedis();
			redis.store.set("litellm:cooldown:bad", "{not-json");
			const backend = new RedisCooldownBackend(redis);
			const got = await backend.getCooldown("bad");
			expect(got).toBeUndefined();
		});

		it("自定义 keyPrefix 时读取走对应 key", async () => {
			const redis = new MockRedis();
			redis.store.set("custom:cooldown:m1", JSON.stringify(baseValue));
			const backend = new RedisCooldownBackend(redis, "custom:cooldown:");
			const got = await backend.getCooldown("m1");
			expect(got).toEqual(baseValue);
		});
	});

	describe("deleteCooldown", () => {
		it("调用 DEL 并使用默认 prefix", async () => {
			const redis = new MockRedis();
			redis.store.set("litellm:cooldown:gpt-4", JSON.stringify(baseValue));
			const backend = new RedisCooldownBackend(redis);
			await backend.deleteCooldown("gpt-4");
			expect(redis.delCalls).toEqual(["litellm:cooldown:gpt-4"]);
			expect(redis.store.has("litellm:cooldown:gpt-4")).toBe(false);
		});

		it("Redis DEL 失败包装为 RedisCooldownBackend 错误", async () => {
			const redis = new MockRedis();
			redis.delError = new Error("timeout");
			const backend = new RedisCooldownBackend(redis);
			await expect(backend.deleteCooldown("gpt-4")).rejects.toThrow(/RedisCooldownBackend\.deleteCooldown failed: timeout/);
		});

		it("自定义 keyPrefix 时 DEL 走对应 key", async () => {
			const redis = new MockRedis();
			const backend = new RedisCooldownBackend(redis, "prefix:");
			await backend.deleteCooldown("m1");
			expect(redis.delCalls).toEqual(["prefix:m1"]);
		});
	});

	describe("end-to-end roundtrip", () => {
		it("set → get 还原同值", async () => {
			const redis = new MockRedis();
			const backend = new RedisCooldownBackend(redis);
			await backend.setCooldown("k", baseValue);
			const got = await backend.getCooldown("k");
			expect(got).toEqual(baseValue);
		});

		it("set → delete → get 返回 undefined", async () => {
			const redis = new MockRedis();
			const backend = new RedisCooldownBackend(redis);
			await backend.setCooldown("k", baseValue);
			await backend.deleteCooldown("k");
			const got = await backend.getCooldown("k");
			expect(got).toBeUndefined();
		});
	});
});
