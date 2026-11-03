import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpeedView from "./SpeedView";
import type { ModelSpeedReport } from "./types";

const { useModelSpeedMock } = vi.hoisted(() => ({ useModelSpeedMock: vi.fn() }));

vi.mock("./hooks/useModelSpeed", () => ({
	useModelSpeed: useModelSpeedMock,
}));

// recharts 依赖真实布局尺寸，jsdom 下画不出来；图表数值与断线规则由 utils.test.ts 覆盖。
// 这里把收到的纵轴上限透出到 DOM，用于验证「所有卡片共用同一个上限」。
vi.mock("./components/ModelSpeedChart", () => ({
	default: (props: { yMax?: number }) => <div data-testid="model-speed-chart" data-ymax={String(props.yMax)} />,
}));

const report: ModelSpeedReport = {
	start_date: "2026-10-27",
	end_date: "2026-11-02",
	bucket: "day",
	timezone: "Asia/Shanghai",
	min_output_tokens: 20,
	min_bucket_requests: 2,
	buckets: ["2026-11-01T16:00:00Z", "2026-11-02T16:00:00Z"],
	models: [
		{
			model: "MiniMax-M3",
			calls: 20341,
			requests: 20000,
			avg_tps: 89.04,
			p50_tps: 80.5,
			points: [{ bucket: "2026-11-01T16:00:00Z", avg_tps: 88, p50_tps: 80, requests: 120 }],
		},
		{
			model: "cliproxy/gpt-6-astra",
			calls: 900,
			requests: 880,
			avg_tps: 19.2,
			p50_tps: 18,
			points: [{ bucket: "2026-11-02T16:00:00Z", avg_tps: 132, p50_tps: 120, requests: 40 }],
		},
	],
	models_without_speed: [{ model: "gpt-image-2", calls: 15 }],
};

const queryState = (overrides: Record<string, unknown> = {}) => ({
	data: report,
	isPending: false,
	isError: false,
	error: null,
	...overrides,
});


describe("SpeedView", () => {
	beforeEach(() => {
		useModelSpeedMock.mockReset();
		useModelSpeedMock.mockReturnValue(queryState());
	});

	it("为每个有输出速度的模型渲染一张卡片和走势图", () => {
		render(<SpeedView />);

		expect(screen.getAllByTestId("model-speed-card")).toHaveLength(2);
		expect(screen.getByText("MiniMax-M3")).toBeInTheDocument();
		expect(screen.getByText("89.0")).toBeInTheDocument();
		expect(screen.getByText("20,000 个可用请求")).toBeInTheDocument();
		expect(screen.getAllByTestId("model-speed-chart")).toHaveLength(2);
	});

	it("所有卡片共用当前显示模型的最大值作为纵轴上限", () => {
		render(<SpeedView />);

		// 第一个模型最高 88，第二个 132：上限取全局 132，两张卡片一致
		const charts = screen.getAllByTestId("model-speed-chart");
		expect(charts.map((chart) => chart.getAttribute("data-ymax"))).toEqual(["132", "132"]);
	});

	it("过滤后纵轴上限只取仍在显示的模型", () => {
		render(<SpeedView />);

		fireEvent.change(screen.getByLabelText("搜索模型"), { target: { value: "MiniMax" } });

		const charts = screen.getAllByTestId("model-speed-chart");
		expect(charts).toHaveLength(1);
		expect(charts[0]!.getAttribute("data-ymax")).toBe("88");
	});

	it("说明样本门槛与纵轴口径，避免读者把断线当成故障", () => {
		render(<SpeedView />);

		expect(screen.getByText(/至少要有\s*2\s*个请求才作为数据点/)).toBeInTheDocument();
		expect(screen.getByText(/纵轴固定从 0 起/)).toBeInTheDocument();
		expect(screen.getByText("0 / 200 TPS")).toBeInTheDocument();
	});

	it("列出有调用但没有可测算输出的模型，说明为什么没有曲线", () => {
		render(<SpeedView />);

		expect(screen.getByText("有调用但没有可测算输出速度的模型")).toBeInTheDocument();
		expect(screen.getByText("gpt-image-2")).toBeInTheDocument();
		expect(screen.getByText("(15)")).toBeInTheDocument();
	});

	it("按模型名过滤卡片，过滤无命中时给出提示", () => {
		render(<SpeedView />);

		fireEvent.change(screen.getByLabelText("搜索模型"), { target: { value: "gpt-image" } });

		expect(screen.queryByTestId("model-speed-card")).not.toBeInTheDocument();
		expect(screen.getByText("没有匹配「gpt-image」的模型")).toBeInTheDocument();
	});

	it("区间内没有可测算数据时给出空状态", () => {
		useModelSpeedMock.mockReturnValue(
			queryState({ data: { ...report, models: [], models_without_speed: [] } }),
		);

		render(<SpeedView />);

		expect(screen.getByText("所选区间内没有可测算的输出速度数据")).toBeInTheDocument();
	});

	it("接口失败时提示错误，而不是空白页", () => {
		useModelSpeedMock.mockReturnValue(
			queryState({ data: undefined, isError: true, error: new Error("加载失败") }),
		);

		render(<SpeedView />);

		expect(screen.getByText("加载模型速度失败")).toBeInTheDocument();
	});

	it("默认按浏览器时区请求最近 7 个自然日", () => {
		render(<SpeedView />);

		const lastCall = useModelSpeedMock.mock.calls.at(-1)?.[0];
		const spanDays =
			(Date.parse(lastCall.endDate + "T00:00:00Z") - Date.parse(lastCall.startDate + "T00:00:00Z")) / 86400000;
		expect(spanDays).toBe(6);
		expect(lastCall.timezone).toEqual(expect.any(String));
		expect(lastCall.timezone.length).toBeGreaterThan(0);
	});
});
