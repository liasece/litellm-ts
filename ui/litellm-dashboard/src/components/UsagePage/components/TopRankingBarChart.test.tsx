import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TopRankingBarChart from "./TopRankingBarChart";

const tooltipProps = vi.fn();
const barProps = vi.fn();
const chartProps = vi.fn();

vi.mock("recharts", async () => {
	const React = await import("react");
	return {
		ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		BarChart: (props: any) => {
			chartProps(props);
			return <div>{props.children}</div>;
		},
		XAxis: () => null,
		YAxis: () => null,
		Tooltip: (props: any) => {
			const [active, setActive] = React.useState(false);
			tooltipProps(props);
			return (
				<>
					<button aria-label="activate tooltip" onMouseEnter={() => setActive(true)} />
					{props.content({
						active,
						coordinate: { x: 20, y: 30 },
						payload: [{ payload: { key: "row", spend: 1 } }],
					})}
				</>
			);
		},
		Bar: (props: any) => {
			barProps(props);
			return (
				<>
					<button onClick={() => props.onClick?.({ key: "row", spend: 1 })}>bar</button>
					<svg>{props.children}</svg>
				</>
			);
		},
		LabelList: ({ content }: any) => <>{content({ index: 0, viewBox: { x: 10, y: 0, width: 100, height: 40 } })}</>,
	};
});

describe("TopRankingBarChart", () => {
	it("renders active tooltips outside overflow containers and forwards bar clicks", () => {
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

		fireEvent.mouseEnter(screen.getByRole("button", { name: "activate tooltip" }));
		expect(screen.getByText("row")).toBeInTheDocument();
		const tooltip = screen.getByTestId("top-ranking-tooltip-portal");
		expect(tooltip.parentElement).toBe(document.body);
		expect(tooltip).toHaveClass("fixed");
		expect(tooltipProps).toHaveBeenCalledWith(expect.not.objectContaining({ position: expect.anything() }));
		screen.getByRole("button", { name: "bar" }).click();
		expect(onBarClick).toHaveBeenCalledWith({ key: "row", spend: 1 });
		expect(barProps).toHaveBeenCalled();
	});

	it("renders a row annotation inside the bar at a shared left edge", () => {
		render(
			<TopRankingBarChart
				data={[{ key: "row", spend: 1, cacheHitRate: 25 }]}
				categoryKey="key"
				valueKey="spend"
				yAxisWidth={120}
				height={40}
				valueFormatter={String}
				renderTooltip={() => null}
				renderBarAnnotation={(row) => <span aria-label="cache hit">{row.cacheHitRate}%</span>}
			/>,
		);

		const annotation = screen.getByLabelText("cache hit");
		expect(annotation).toHaveTextContent("25%");
		expect(annotation.parentElement?.parentElement).toHaveAttribute("x", "18");
		expect(chartProps).toHaveBeenLastCalledWith(
			expect.objectContaining({ margin: { top: 4, right: 16, bottom: 4, left: 0 } }),
		);
	});
});
