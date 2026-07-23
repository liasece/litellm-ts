import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TopRankingBarChart from "./TopRankingBarChart";

const tooltipProps = vi.fn();
const barProps = vi.fn();

vi.mock("recharts", async () => {
	const React = await import("react");
	return {
		ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		XAxis: () => null,
		YAxis: () => null,
		Tooltip: (props: any) => {
			tooltipProps(props);
			return <>{props.content({ active: true, payload: [{ payload: { key: "row", spend: 1 } }] })}</>;
		},
		Bar: (props: any) => {
			barProps(props);
			return <button onClick={() => props.onClick?.({ key: "row", spend: 1 })}>bar</button>;
		},
	};
});

describe("TopRankingBarChart", () => {
	it("renders active rows without a fixed tooltip position and forwards bar clicks", () => {
		const onBarClick = vi.fn();
		render(
			<TopRankingBarChart
				data={[{ key: "row", spend: 1 }]}
				categoryKey="key"
				valueKey="spend"
				yAxisWidth={120}
				height={52}
				valueFormatter={String}
				renderTooltip={(row) => (row ? <span>{row.key}</span> : null)}
				onBarClick={onBarClick}
			/>,
		);

		expect(screen.getByText("row")).toBeInTheDocument();
		expect(tooltipProps).toHaveBeenCalledWith(expect.not.objectContaining({ position: expect.anything() }));
		screen.getByRole("button", { name: "bar" }).click();
		expect(onBarClick).toHaveBeenCalledWith({ key: "row", spend: 1 });
		expect(barProps).toHaveBeenCalled();
	});
});
