/**
 * SpendLogColdStorage 测试
 *
 * 对齐 PY spend_management_endpoints.py:2028-2048 详情端点冷存储回查控制流：
 *  - 无注册实现时返回 null（调用方回落 DB 分支）
 *  - 首个非 null payload 短路返回
 *  - 单个 logger 抛错不阻断后续 logger
 *
 * 注意：注册表是模块级单例且无注销接口，本文件测试顺序敏感——
 * 空注册表用例必须在任何注册之前执行。
 */
import {
	getRequestResponsePayloadFromColdStorage,
	registerSpendLogColdStorageLogger,
	type SpendLogColdStorageLogger,
} from "./SpendLogColdStorage";

const noopOnError = (): void => undefined;

describe("SpendLogColdStorage 注册表", () => {
	it("无注册实现时返回 null（详情端点回落 DB 分支）", async () => {
		const payload = await getRequestResponsePayloadFromColdStorage("req-none", undefined, undefined, noopOnError);
		expect(payload).toBeNull();
	});
});

describe("SpendLogColdStorage 注册后行为", () => {
	const mockGetPayload = jest.fn<Promise<Record<string, unknown> | null>, [string, Date?, Date?]>();
	const registeredLogger: SpendLogColdStorageLogger = { getRequestResponsePayload: mockGetPayload };

	it("注册 logger 后首个非 null payload 短路返回，并透传 requestId 与时间窗", async () => {
		registerSpendLogColdStorageLogger(registeredLogger);
		const expectedPayload = { messages: [{ role: "user", content: "hi" }], response: { id: "resp-1" } };
		mockGetPayload.mockResolvedValue(expectedPayload);
		const startTime = new Date("2026-01-01T00:00:00.000Z");
		const endTime = new Date("2026-01-02T00:00:00.000Z");
		const payload = await getRequestResponsePayloadFromColdStorage("req-hit", startTime, endTime, noopOnError);
		expect(payload).toBe(expectedPayload);
		expect(mockGetPayload).toHaveBeenCalledWith("req-hit", startTime, endTime);
	});

	it("logger 返回 null 时整体返回 null", async () => {
		mockGetPayload.mockResolvedValue(null);
		const payload = await getRequestResponsePayloadFromColdStorage("req-miss", undefined, undefined, noopOnError);
		expect(payload).toBeNull();
	});

	it("单个 logger 抛错触发 onError 且不阻断（整体返回 null）", async () => {
		mockGetPayload.mockRejectedValue(new Error("cold storage down"));
		const errors: unknown[] = [];
		const payload = await getRequestResponsePayloadFromColdStorage("req-error", undefined, undefined, (_logger, error) =>
			errors.push(error),
		);
		expect(payload).toBeNull();
		expect(errors).toHaveLength(1);
		expect((errors[0] as Error).message).toBe("cold storage down");
	});
});
