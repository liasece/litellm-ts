/**
 * CooldownManager 测试
 */
import type { CooldownCacheBackend, CooldownCacheValue } from "./CooldownCacheTypes";
import { CooldownManager } from "./CooldownManager";
import { maskSensitiveData, maskCooldownEntries } from "./CooldownMasking";
import { RateLimitError, BadRequestError, AuthenticationError, APIConnectionError, TimeoutError } from "./RouterErrors";

describe("CooldownManager", () => {
	let cm: CooldownManager;

	beforeEach(() => {
		cm = new CooldownManager();
	});

	it("marks a deployment as failed and enters cooldown", () => {
		cm.markFailed("gpt-4", 5000);
		expect(cm.isInCooldown("gpt-4")).toBe(true);
	});

	it("returns false for deployment not in cooldown", () => {
		expect(cm.isInCooldown("claude")).toBe(false);
	});

	it("clears cooldown", () => {
		cm.markFailed("gpt-4", 5000);
		cm.clearCooldown("gpt-4");
		expect(cm.isInCooldown("gpt-4")).toBe(false);
	});

	it("tracks multiple deployments independently", () => {
		cm.markFailed("gpt-4", 5000);
		cm.markFailed("claude", 10000);
		expect(cm.isInCooldown("gpt-4")).toBe(true);
		expect(cm.isInCooldown("claude")).toBe(true);
		cm.clearCooldown("gpt-4");
		expect(cm.isInCooldown("gpt-4")).toBe(false);
		expect(cm.isInCooldown("claude")).toBe(true);
	});

	it("getRemainingCooldown returns positive during cooldown", () => {
		cm.markFailed("gpt-4", 10000);
		const remaining = cm.getRemainingCooldown("gpt-4");
		expect(remaining).toBeGreaterThan(0);
		expect(remaining).toBeLessThanOrEqual(10000);
	});

	it("getRemainingCooldown returns 0 when not in cooldown", () => {
		expect(cm.getRemainingCooldown("gpt-4")).toBe(0);
	});

	it("cooldown expires automatically", async () => {
		cm.markFailed("gpt-4", 100);
		await new Promise((r) => setTimeout(r, 200));
		expect(cm.isInCooldown("gpt-4")).toBe(false);
	});

	describe("COOLDOWN-001: per-deployment allowed_fails override", () => {
		it("deployment-level allowed_fails=2 在 3 次失败后触发冷却（覆盖 router 默认 null）", () => {
			// cm 默认 allowedFails=null，永不基于 allowed_fails 冷却
			// 但 deployment override = 2 时，3 次失败触发
			const exception = new RateLimitError("rate limit");
			// sameGroupDeploymentCount=1 避免 429 multi-deploy 早退分支
			// 第一次：failures=1，未超 2
			expect(cm.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exception, 2)).toBe(false);
			// 第二次：failures=2，未超 2
			expect(cm.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exception, 2)).toBe(false);
			// 第三次：failures=3，超 2 → 触发冷却
			expect(cm.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exception, 2)).toBe(true);
		});

		it("deployment-level AllowedFailsPolicy 按异常类型分类阈值", () => {
			const authExc = new AuthenticationError("auth failed");
			// policy: AuthenticationError=1
			const policy = { AuthenticationError: 1 };
			// 用 500 状态码避免 401 走 Stage 1 (`_should_retry==False`) 早退
			// 第一次 auth fail: 1 > 1 不成立 → false
			expect(cm.isCooldownRequired("dep-2", 500, "", 2, "AuthenticationError", authExc, policy)).toBe(false);
			// 第二次 auth fail: 2 > 1 → 触发冷却
			expect(cm.isCooldownRequired("dep-2", 500, "", 2, "AuthenticationError", authExc, policy)).toBe(true);
		});

		it("deployment override 优先于 router-level allowed_fails", () => {
			// router-level allowedFails=10（宽松），deployment-level=2（严格）
			const cmWithRouter = new CooldownManager(false, 10);
			const exc = new RateLimitError("rate");
			// sameGroupDeploymentCount=1 避免 429 multi-deploy 早退
			// 用 router-level: 11 次才会触发；用 deployment override=2: 3 次触发
			expect(cmWithRouter.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exc, 2)).toBe(false);
			expect(cmWithRouter.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exc, 2)).toBe(false);
			expect(cmWithRouter.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exc, 2)).toBe(true);
		});

		it("deployment 未设置 override 时回退到 router-level", () => {
			const cmWithRouter = new CooldownManager(false, 1);
			const exc = new RateLimitError("rate");
			// router-level=1, deployment-level undefined → 走 router
			// sameGroupDeploymentCount=1 避免 429 multi-deploy 早退
			// 第一次：1>1 不成立
			expect(cmWithRouter.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exc)).toBe(false);
			// 第二次：2>1 → 触发
			expect(cmWithRouter.isCooldownRequired("dep-1", 429, "", 1, "RateLimitError", exc)).toBe(true);
		});

		it("env override LITELLM_SINGLE_DEPLOYMENT_TRAFFIC_FAILURE_THRESHOLD 生效（IIFE 模块加载时执行，验证默认 1000 阈值逻辑）", () => {
			// PY constants.py:88: `int(os.getenv(...,1000))` — env 覆盖在模块加载时生效
			// IIFE 已在模块加载时执行，无法动态修改 env。
			// 此测试验证：默认阈值 (1000) 下，5 次失败不会触发 100% 分支；
			// 但 deployment-level allowed_fails=1 (绕过 100% 阈值) 会触发。
			const exc = new BadRequestError("error");
			// 5 次失败 + sameGroup=1，阈值 1000 不触发
			for (let i = 0; i < 5; i++) {
				cm.recordFailure("single-default");
			}
			// 默认阈值 (1000) 下，5 次失败 < 1000 → 100% 路径不触发
			expect(cm.isCooldownRequired("single-default", 500, "error", 1, "BadRequestError", exc)).toBe(false);

			// deployment-level allowed_fails=1 → 第二次必触发
			const cmWithDep = new CooldownManager();
			cmWithDep.recordFailure("single-dep");
			expect(cmWithDep.isCooldownRequired("single-dep", 500, "error", 1, "BadRequestError", exc, 1)).toBe(false);
			cmWithDep.recordFailure("single-dep");
			expect(cmWithDep.isCooldownRequired("single-dep", 500, "error", 1, "BadRequestError", exc, 1)).toBe(true);
		});
	});

	describe("DIFF-RT-02: getMinCooldown 跨 deployment 聚合", () => {
		it("3 deployment 不同冷却剩余时间返回 min", () => {
			cm.markFailed("dep-a", 10000);
			cm.markFailed("dep-b", 30000);
			cm.markFailed("dep-c", 5000);
			// 由于 3 个 markFailed 时间相近（< 1ms），剩余时间按冷却时间排序
			// dep-c 5s < dep-a 10s < dep-b 30s → min = dep-c
			const min = cm.getMinCooldown(["dep-a", "dep-b", "dep-c"]);
			expect(min).toBeGreaterThan(0);
			expect(min).toBeLessThanOrEqual(5000);
		});

		it("全部不在冷却时返回 0", () => {
			expect(cm.getMinCooldown(["dep-x", "dep-y"])).toBe(0);
		});

		it("部分 deployment 在冷却时取最小剩余", () => {
			cm.markFailed("dep-active", 20000);
			// dep-inactive 未 markFailed
			const min = cm.getMinCooldown(["dep-active", "dep-inactive"]);
			expect(min).toBeGreaterThan(0);
			expect(min).toBeLessThanOrEqual(20000);
		});
	});

	describe("DIFF-RT-04: getActiveCooldowns + SensitiveDataMasker", () => {
		it("getActiveCooldowns 返回 [(name, CooldownCacheValue)] 列表", () => {
			cm.markFailed("dep-1", 5000, 429, "rate limit");
			cm.markFailed("dep-2", 10000, 500, "server error");
			const result = cm.getActiveCooldowns(["dep-1", "dep-2", "dep-3"]);
			expect(result.length).toBe(2);
			const names = result.map(([n]) => n);
			expect(names).toContain("dep-1");
			expect(names).toContain("dep-2");
			const dep1 = result.find(([n]) => n === "dep-1")![1];
			expect(dep1.status_code).toBe(429);
			expect(dep1.cooldown_time).toBe(5000);
		});

		it("getActiveCooldowns 跳过过期条目（与 isInCooldown 行为一致）", async () => {
			cm.markFailed("dep-1", 50);
			await new Promise((r) => setTimeout(r, 100));
			const result = cm.getActiveCooldowns(["dep-1"]);
			expect(result.length).toBe(0);
		});

		it("maskSensitiveData visible_prefix=50 + 星号 (对齐 PY)", () => {
			// 长度 <= 50 不截断
			expect(maskSensitiveData("short-name")).toBe("short-name");
			// 长度 > 50 截断前 50 字符 + *****
			const long = "a".repeat(100);
			const masked = maskSensitiveData(long);
			expect(masked.length).toBe(55);
			expect(masked.endsWith("*****")).toBe(true);
			expect(masked.startsWith("a".repeat(50))).toBe(true);
		});

		it("maskCooldownEntries 转换 [(name, value)] 为 [(maskedName, maskedJsonStr)]", () => {
			const longName = "x".repeat(60);
			const entry: [string, CooldownCacheValue] = [
				longName,
				{
					exception_received: "rate limit",
					status_code: 429,
					timestamp: Date.now(),
					cooldown_time: 5000,
				},
			];
			const masked = maskCooldownEntries([entry]);
			expect(masked.length).toBe(1);
			expect(masked[0]![0]).toBe("x".repeat(50) + "*****");
			expect(masked[0]![1].length).toBeGreaterThan(0);
		});
	});

	describe("DIFF-RT-01: 冷却事件回调", () => {
		it("markFailed 后 callback 收到 deploymentId + cooldownDuration + statusCode + exceptionReceived", () => {
			const cb = jest.fn();
			const cmWithCb = new CooldownManager(false, null, [], 60000, undefined, [cb]);
			cmWithCb.markFailed("gpt-4", 5000, 500, "server error");
			expect(cb).toHaveBeenCalledTimes(1);
			expect(cb).toHaveBeenCalledWith("gpt-4", 5000, 500, "server error");
		});

		it("多个 callback 全部触发", () => {
			const cb1 = jest.fn();
			const cb2 = jest.fn();
			const cmWithCb = new CooldownManager(false, null, [], 60000, undefined, [cb1, cb2]);
			cmWithCb.markFailed("gpt-4", 5000, 429, "rate limit");
			expect(cb1).toHaveBeenCalled();
			expect(cb2).toHaveBeenCalled();
		});

		it("callback 抛错被吞，不影响主路径", () => {
			const errorCb = jest.fn(() => {
				throw new Error("callback failed");
			});
			const cmWithCb = new CooldownManager(false, null, [], 60000, undefined, [errorCb]);
			// 不应该抛错
			cmWithCb.markFailed("gpt-4", 5000, 500, "err");
			// cooldown 仍然生效
			expect(cmWithCb.isInCooldown("gpt-4")).toBe(true);
		});

		it("addCooldownCallback 动态注册", () => {
			const cmLocal = new CooldownManager();
			const cb = jest.fn();
			cmLocal.addCooldownCallback(cb);
			cmLocal.markFailed("gpt-4", 5000, 500, "err");
			expect(cb).toHaveBeenCalledWith("gpt-4", 5000, 500, "err");
		});
	});

	describe("DIFF-CACHE-01: CooldownCacheBackend 测试覆盖", () => {
		it("mock backend: isInCooldownAsync 本地未命中时查 backend", async () => {
			const remoteValue: CooldownCacheValue = {
				exception_received: "rate",
				status_code: 429,
				timestamp: Date.now(),
				cooldown_time: 5000,
			};
			const backend: CooldownCacheBackend = {
				setCooldown: jest.fn(),
				getCooldown: jest.fn().mockResolvedValue(remoteValue),
				deleteCooldown: jest.fn(),
			};
			const cmWithBackend = new CooldownManager(false, null, [], 60000, backend);
			expect(await cmWithBackend.isInCooldownAsync("dep-1")).toBe(true);
			// 命中后应写入本地
			expect(cmWithBackend.isInCooldown("dep-1")).toBe(true);
		});

		it("backend.getCooldown 抛错时主路径不报错，返回 false", async () => {
			const backend: CooldownCacheBackend = {
				setCooldown: jest.fn(),
				getCooldown: jest.fn().mockRejectedValue(new Error("redis down")),
				deleteCooldown: jest.fn(),
			};
			const cmWithBackend = new CooldownManager(false, null, [], 60000, backend);
			await expect(cmWithBackend.isInCooldownAsync("dep-1")).resolves.toBe(false);
		});

		it("backend.getCooldown 返回过期条目时清理 backend（best-effort）", async () => {
			const expired: CooldownCacheValue = {
				exception_received: "rate",
				status_code: 429,
				timestamp: Date.now() - 100_000,
				cooldown_time: 1000,
			};
			const deleteFn = jest.fn().mockResolvedValue(undefined);
			const backend: CooldownCacheBackend = {
				setCooldown: jest.fn(),
				getCooldown: jest.fn().mockResolvedValue(expired),
				deleteCooldown: deleteFn,
			};
			const cmWithBackend = new CooldownManager(false, null, [], 60000, backend);
			expect(await cmWithBackend.isInCooldownAsync("dep-1")).toBe(false);
			// best-effort 清理：deleteCooldown 被调用
			expect(deleteFn).toHaveBeenCalledWith("dep-1");
		});

		it("hydrateFromBackend 拉取后写入本地 _cooldowns map", async () => {
			const value1: CooldownCacheValue = {
				exception_received: "rate",
				status_code: 429,
				timestamp: Date.now(),
				cooldown_time: 5000,
			};
			const value2: CooldownCacheValue = {
				exception_received: "auth",
				status_code: 401,
				timestamp: Date.now(),
				cooldown_time: 3000,
			};
			const backend: CooldownCacheBackend = {
				setCooldown: jest.fn(),
				getCooldown: jest.fn((name: string) => {
					if (name === "dep-1") {
						return Promise.resolve(value1);
					}
					if (name === "dep-2") {
						return Promise.resolve(value2);
					}
					return Promise.resolve(undefined);
				}),
				deleteCooldown: jest.fn(),
			};
			const cmWithBackend = new CooldownManager(false, null, [], 60000, backend);
			await cmWithBackend.hydrateFromBackend(["dep-1", "dep-2"]);
			expect(cmWithBackend.isInCooldown("dep-1")).toBe(true);
			expect(cmWithBackend.isInCooldown("dep-2")).toBe(true);
		});

		it("backend.deleteCooldown 失败被吞", async () => {
			const backend: CooldownCacheBackend = {
				setCooldown: jest.fn(),
				getCooldown: jest.fn(),
				deleteCooldown: jest.fn().mockRejectedValue(new Error("redis down")),
			};
			const cmWithBackend = new CooldownManager(false, null, [], 60000, backend);
			cmWithBackend.markFailed("dep-1", 5000);
			cmWithBackend.clearCooldown("dep-1");
			// 不应抛错
			expect(cmWithBackend.isInCooldown("dep-1")).toBe(false);
		});
	});

	describe("DIFF-002: APIConnectionError / TimeoutError 实例豁免冷却", () => {
		it("APIConnectionError 实例（message 不含类名）也不冷却", () => {
			// PY cooldown_handlers.py:57-63 依字符串匹配，但 TS error.message 通常不含类名
			// → 用 instanceof 更可靠。
			const cmLocal = new CooldownManager();
			const exc = new APIConnectionError("connection refused"); // message 不含 "APIConnectionError"
			// 500 状态码 → 默认会冷却；但 APIConnectionError instanceof 应该短路返回 false
			const required = cmLocal.isCooldownRequired("dep-conn", 500, "connection refused", 2, "TimeoutError", exc);
			expect(required).toBe(false);
		});

		it("TimeoutError 实例同样不冷却（PY 同等豁免）", () => {
			const cmLocal = new CooldownManager();
			const exc = new TimeoutError("timed out"); // message 不含 "TimeoutError"
			const required = cmLocal.isCooldownRequired("dep-timeout", 500, "timed out", 2, "TimeoutError", exc);
			expect(required).toBe(false);
		});

		it("exceptionStr 含 'APIConnectionError' 字符串也豁免（Router 端 error.name 兜底）", () => {
			const cmLocal = new CooldownManager();
			// 模拟 Router._catch 传入 error.name 作为 exceptionStr
			const required = cmLocal.isCooldownRequired("dep-x", 500, "APIConnectionError", 2, "TimeoutError");
			expect(required).toBe(false);
		});

		it("errorCategory='TimeoutError' 时同样豁免", () => {
			const cmLocal = new CooldownManager();
			// 即使 exceptionStr 是空、无 originalException，errorCategory='TimeoutError' 也走豁免
			const required = cmLocal.isCooldownRequired("dep-x", 500, "", 2, "TimeoutError");
			expect(required).toBe(false);
		});

		it("普通 5xx Error（非 conn/timeout）不豁免", () => {
			const cmLocal = new CooldownManager(false, 1);
			const exc = new BadRequestError("server fail");
			// 走 allowed_fails=1 → 第 2 次失败应该冷却
			cmLocal.isCooldownRequired("dep-y", 500, "", 2, "InternalServerError", exc);
			const required2 = cmLocal.isCooldownRequired("dep-y", 500, "", 2, "InternalServerError", exc);
			expect(required2).toBe(true);
		});
	});

	describe("DIFF-014: async cooldown callbacks 支持", () => {
		it("async callback 返回 Promise 时不阻塞 markFailed", async () => {
			let resolved = false;
			const asyncCb = (id: string): Promise<void> => {
				return new Promise((resolve) => {
					setTimeout(() => {
						resolved = true;
						resolve();
					}, 50);
				});
			};
			const cmWithCb = new CooldownManager(false, null, [], 60000, undefined, [asyncCb]);
			cmWithCb.markFailed("gpt-4", 5000, 500, "err");
			// markFailed 立即返回（未 await callback）
			expect(resolved).toBe(false);
			expect(cmWithCb.isInCooldown("gpt-4")).toBe(true);
			// 等 callback 完成
			await new Promise((r) => setTimeout(r, 100));
			expect(resolved).toBe(true);
		});

		it("async callback reject 被吞，不影响主路径", async () => {
			const failingAsyncCb = (): Promise<void> => Promise.reject(new Error("async cb failed"));
			const cmWithCb = new CooldownManager(false, null, [], 60000, undefined, [failingAsyncCb]);
			// markFailed 不应抛错
			cmWithCb.markFailed("gpt-4", 5000, 500, "err");
			expect(cmWithCb.isInCooldown("gpt-4")).toBe(true);
			// 等 microtask 完成
			await new Promise((r) => setTimeout(r, 10));
		});

		it("addCooldownCallback 支持 async 回调", async () => {
			const cmLocal = new CooldownManager();
			let called = false;
			cmLocal.addCooldownCallback(async () => {
				await Promise.resolve();
				called = true;
			});
			cmLocal.markFailed("gpt-4", 5000, 500, "err");
			await new Promise((r) => setTimeout(r, 10));
			expect(called).toBe(true);
		});

		it("混合 sync + async callbacks 全部触发", async () => {
			const syncCalls: string[] = [];
			const asyncCalls: string[] = [];
			const syncCb = (id: string): void => {
				syncCalls.push(id);
			};
			const asyncCb = async (id: string): Promise<void> => {
				await Promise.resolve();
				asyncCalls.push(id);
			};
			const cmLocal = new CooldownManager(false, null, [], 60000, undefined, [syncCb, asyncCb]);
			cmLocal.markFailed("gpt-4", 5000, 500, "err");
			expect(syncCalls).toEqual(["gpt-4"]);
			await new Promise((r) => setTimeout(r, 10));
			expect(asyncCalls).toEqual(["gpt-4"]);
		});
	});

	describe("DIFF-RT-03: _evaluateFailureRates 阈值测试", () => {
		it("sameGroupCount=1 + recordFailure(1000) + successes=0 → 100% 路径触发", () => {
			// PY cooldown_handlers.py:227-232: 单部署组 100% + total_requests >= 1000
			// 默认阈值 1000
			const cmLocal = new CooldownManager();
			const exc = new BadRequestError("server error");
			// 999 次失败 + 0 成功 → 100% 路径不触发 (失败数 < 1000)
			for (let i = 0; i < 999; i++) {
				cmLocal.recordFailure("dep-1000");
			}
			expect(cmLocal.isCooldownRequired("dep-1000", 500, "", 1, "BadRequestError", exc)).toBe(false);
			// 第 1000 次失败 → 触发 100% 路径（failures >= 1000 && successes === 0）
			cmLocal.recordFailure("dep-1000");
			expect(cmLocal.isCooldownRequired("dep-1000", 500, "", 1, "BadRequestError", exc)).toBe(true);
		});

		it("sameGroupCount=1 + 有任何 success → 100% 路径不触发（PY: successes > 0 不算 100%）", () => {
			const cmLocal = new CooldownManager();
			const exc = new BadRequestError("server error");
			for (let i = 0; i < 1000; i++) {
				cmLocal.recordFailure("dep-mix");
			}
			cmLocal.recordSuccess("dep-mix"); // 1 个成功 → 失败率 < 100%
			expect(cmLocal.isCooldownRequired("dep-mix", 500, "", 1, "BadRequestError", exc)).toBe(false);
		});

		it("sameGroupCount=2 + recordFailure(5) + successes=0 → 50% 路径触发", () => {
			// PY cooldown_handlers.py:233-239: 多部署组 50% + total_requests >= 5
			const cmLocal = new CooldownManager();
			const exc = new BadRequestError("server error");
			// 4 次失败不触发（< 5）
			for (let i = 0; i < 4; i++) {
				cmLocal.recordFailure("dep-multi");
			}
			expect(cmLocal.isCooldownRequired("dep-multi", 500, "", 2, "BadRequestError", exc)).toBe(false);
			// 第 5 次失败 → 50% 路径触发 (5/5 = 100% > 50%)
			cmLocal.recordFailure("dep-multi");
			expect(cmLocal.isCooldownRequired("dep-multi", 500, "", 2, "BadRequestError", exc)).toBe(true);
		});

		it("sameGroupCount=2 + recordFailure(3) + recordSuccess(3) → 50% 路径不触发（50% 不 > 50%）", () => {
			// PY 50% 是严格 > 50% 才触发；3 fail / 3 success = 50% 不触发
			const cmLocal = new CooldownManager();
			const exc = new BadRequestError("server error");
			cmLocal.recordFailure("dep-half");
			cmLocal.recordFailure("dep-half");
			cmLocal.recordFailure("dep-half");
			cmLocal.recordSuccess("dep-half");
			cmLocal.recordSuccess("dep-half");
			cmLocal.recordSuccess("dep-half");
			expect(cmLocal.isCooldownRequired("dep-half", 500, "", 2, "BadRequestError", exc)).toBe(false);
		});
	});
});
