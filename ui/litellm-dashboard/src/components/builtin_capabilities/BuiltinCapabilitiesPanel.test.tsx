import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BuiltinCapabilitiesPanel from "./BuiltinCapabilitiesPanel";

const mocks = vi.hoisted(() => ({
	load: vi.fn(),
	update: vi.fn(),
	credentials: vi.fn(),
	success: vi.fn(),
	error: vi.fn(),
}));

vi.mock("../networking", () => ({
	builtinCapabilitiesCall: mocks.load,
	updateBuiltinCapabilitiesCall: mocks.update,
	credentialListCall: mocks.credentials,
}));

vi.mock("../molecules/notifications_manager", () => ({
	default: {
		success: mocks.success,
		fromBackend: mocks.error,
	},
}));

const response = {
	capabilities: {
		vision: {
			enabled: true,
			always_inject: false,
			handler_model: "gpt-5.4-mini",
			executors: [
				{ type: "model", model: "gpt-5.4-mini" },
				{ type: "model", model: "gpt-5.4" },
			],
			max_iterations: 4,
			max_output_tokens: 2048,
		},
		image_generation: {
			enabled: false,
			always_inject: true,
			handler_model: "gpt-image-2",
			executors: [{ type: "model", model: "gpt-image-2" }],
			max_iterations: 4,
			max_output_tokens: 32768,
		},
		web: {
			enabled: true,
			always_inject: true,
			handler_model: "gpt-5.4",
			executors: [
				{ type: "model", model: "gpt-5.4" },
				{
					type: "deepseek_tools",
					api_base: "https://api.deepseek.com",
					credential_name: "deepseek-prod",
					timeout_ms: 15000,
					search_count: 10,
					search_need_content: false,
					localization: "",
				},
			],
			max_iterations: 4,
			max_output_tokens: 4096,
		},
	},
	available_models: [
		{ model_name: "gpt-5.4-mini", type: "model", mode: "chat" },
		{ model_name: "gpt-5.4", type: "model", mode: "chat" },
		{ model_name: "metadata-unknown", type: "model", mode: "embedding" },
	],
	image_generation_available_models: [
		{ model_name: "gpt-image-2", type: "model", mode: "image_generation" },
		{ model_name: "metadata-unknown", type: "model", mode: "embedding" },
	],
	web_available_models: [
		{ model_name: "gpt-5.4", type: "model", mode: "chat" },
		{ model_name: "metadata-unknown", type: "model", mode: "search" },
	],
};

describe("BuiltinCapabilitiesPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.load.mockResolvedValue(response);
		mocks.update.mockResolvedValue(response);
		mocks.credentials.mockResolvedValue({
			credentials: [{ credential_name: "deepseek-prod" }],
		});
	});

	it("loads the persisted executor chain and saves it unchanged", async () => {
		render(<BuiltinCapabilitiesPanel />);

		expect(await screen.findByText("Vision")).toBeInTheDocument();
		expect(
			screen.getByText(/injection requires this global switch and vision on the requested model/i),
		).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		const saved = mocks.update.mock.calls[0]![0];
		// 执行链顺序是契约的一部分：读取什么顺序就要原样保存什么顺序。
		expect(saved.vision.executors).toEqual([
			{ type: "model", model: "gpt-5.4-mini" },
			{ type: "model", model: "gpt-5.4" },
		]);
		expect(saved.web.executors).toEqual([
			{ type: "model", model: "gpt-5.4" },
			{
				type: "deepseek_tools",
				api_base: "https://api.deepseek.com",
				credential_name: "deepseek-prod",
				timeout_ms: 15000,
				search_count: 10,
				search_need_content: false,
				localization: "",
			},
		]);
		expect(mocks.success).toHaveBeenCalledWith("Built-in capabilities updated");
	});

	it("allows administrators to enable unconditional context injection", async () => {
		render(<BuiltinCapabilitiesPanel />);

		const alwaysInject = await screen.findByRole("switch", { name: "Always inject into context" });
		expect(alwaysInject).not.toBeChecked();
		fireEvent.click(alwaysInject);
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith(
				expect.objectContaining({
					vision: expect.objectContaining({ always_inject: true }),
				}),
			),
		);
	});

	it("only offers the direct client executor for the web capability", async () => {
		render(<BuiltinCapabilitiesPanel />);

		// vision / image_generation 各有一个链，"Add DeepSeek Search & Fetch" 只应出现在 web 卡片里。
		const deepSeekButtons = await screen.findAllByRole("button", { name: /Add DeepSeek Search & Fetch/i });
		expect(deepSeekButtons).toHaveLength(1);
		const modelButtons = await screen.findAllByRole("button", { name: /Add model executor/i });
		expect(modelButtons).toHaveLength(3);
	});

	it("adds a model executor to the vision chain and keeps prior entries", async () => {
		render(<BuiltinCapabilitiesPanel />);

		const addButtons = await screen.findAllByRole("button", { name: /Add model executor/i });
		// [0] 是 image_generation，[1] 是 vision，[2] 是 web
		fireEvent.click(addButtons[1]!);
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		const saved = mocks.update.mock.calls[0]![0];
		expect(saved.vision.executors).toHaveLength(3);
		expect(saved.vision.executors[2]).toEqual({ type: "model", model: "" });
		expect(saved.vision.executors.slice(0, 2)).toEqual([
			{ type: "model", model: "gpt-5.4-mini" },
			{ type: "model", model: "gpt-5.4" },
		]);
	});

	it("reorders executors so operators can control which backend wins first", async () => {
		render(<BuiltinCapabilitiesPanel />);

		// 卡片渲染顺序是 image_generation、vision、web；前者的链只有一个元素，
		// 所以「Move executor 2 up」只出现在 vision 与 web 两张卡片里。
		const moveSecondUp = await screen.findAllByRole("button", { name: "Move executor 2 up" });
		expect(moveSecondUp).toHaveLength(2);
		fireEvent.click(moveSecondUp[0]!);
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		const saved = mocks.update.mock.calls[0]![0];
		// image_generation 的链只有一个元素，这里的按钮来自 vision（两个元素）。
		expect(saved.vision.executors).toEqual([
			{ type: "model", model: "gpt-5.4" },
			{ type: "model", model: "gpt-5.4-mini" },
		]);
	});

	it("removes an executor and can delete the direct client entry", async () => {
		render(<BuiltinCapabilitiesPanel />);

		const removeButtons = await screen.findAllByRole("button", { name: /Remove executor/i });
		// 删掉 web 链的第二个元素（DeepSeek 直连），验证按类型混排时下标定位正确。
		const webRemove = removeButtons[removeButtons.length - 1]!;
		fireEvent.click(webRemove);
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => expect(mocks.update).toHaveBeenCalled());
		const saved = mocks.update.mock.calls[0]![0];
		expect(saved.web.executors).toEqual([{ type: "model", model: "gpt-5.4" }]);
	});

	it("loads credential names for the direct client executor without exposing secrets", async () => {
		render(<BuiltinCapabilitiesPanel />);

		await waitFor(() => expect(mocks.credentials).toHaveBeenCalled());
		// 只请求名称列表；凭据值从不出现在面板里。
		expect(screen.queryByText(/api_key/i)).not.toBeInTheDocument();
	});

	it("accepts worker output limits above the former 16K ceiling", async () => {
		render(<BuiltinCapabilitiesPanel />);

		// 三个能力卡片都有「Worker output token limit」，web 是第三张卡片。
		const tokenLimits = await screen.findAllByRole("spinbutton", { name: /Worker output token limit/i });
		expect(tokenLimits).toHaveLength(3);
		fireEvent.change(tokenLimits[2]!, { target: { value: "65536" } });
		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() =>
			expect(mocks.update).toHaveBeenCalledWith(
				expect.objectContaining({
					web: expect.objectContaining({ max_output_tokens: 65536 }),
				}),
			),
		);
	});
});
