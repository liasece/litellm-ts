import { dbConfigProvider } from "./DbConfigProvider";

describe("DbConfigProvider", () => {
	it("每次读取目标配置行，不复用上一请求结果", async () => {
		let value: Record<string, unknown> = { store_prompts_in_spend_logs: false };
		const limit = jest.fn(async () => [{ param_value: structuredClone(value) }]);
		const where = jest.fn(() => ({ limit: limit }));
		const from = jest.fn(() => ({ where: where }));
		const select = jest.fn(() => ({ from: from }));

		await dbConfigProvider.initialize({ select: select } as never);
		expect(await dbConfigProvider.getParam("general_settings")).toEqual({ store_prompts_in_spend_logs: false });

		value = { store_prompts_in_spend_logs: true };
		expect(await dbConfigProvider.getParam("general_settings")).toEqual({ store_prompts_in_spend_logs: true });
		expect(select).toHaveBeenCalledTimes(2);
		expect(limit).toHaveBeenCalledTimes(2);
	});
});
