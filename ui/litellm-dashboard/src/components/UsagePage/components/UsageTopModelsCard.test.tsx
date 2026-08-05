import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import UsageTopModelsCard, { calculateInputCacheHitRate, type TopModelUsage } from "./UsageTopModelsCard";

vi.mock("./TopRankingBarChart", () => ({
	default: ({
		data,
		renderBarAnnotation,
	}: {
		data: Array<Record<string, unknown>>;
		renderBarAnnotation?: (row: Record<string, unknown>) => ReactNode;
	}) => (
		<div>
			{data.map((row) => (
				<div key={String(row.key)}>{renderBarAnnotation?.(row)}</div>
			))}
		</div>
	),
}));

describe("calculateInputCacheHitRate", () => {
	it("calculates the cached share of input tokens as a rounded percentage", () => {
		expect(calculateInputCacheHitRate(250, 1_000)).toBe(25);
		expect(calculateInputCacheHitRate(2, 3)).toBe(67);
	});

	it("handles empty and inconsistent token counts safely", () => {
		expect(calculateInputCacheHitRate(10, 0)).toBe(0);
		expect(calculateInputCacheHitRate(-10, 100)).toBe(0);
		expect(calculateInputCacheHitRate(150, 100)).toBe(100);
	});
});

describe("UsageTopModelsCard", () => {
	it("shows each model's input cache hit rate beside its bar", () => {
		const model: TopModelUsage = {
			key: "gpt-final",
			spend: 1,
			requests: 1,
			successful_requests: 1,
			failed_requests: 0,
			tokens: 1_500,
			prompt_tokens: 1_000,
			cache_read_input_tokens: 250,
		};

		render(
			<UsageTopModelsCard
				viewType="groups"
				onViewTypeChange={vi.fn()}
				groupModels={[model]}
				individualModels={[]}
				loading={false}
				isDateChanging={false}
			/>,
		);

		expect(screen.getByLabelText("Input cache hit rate: 25%")).toHaveTextContent("25%");
	});
});
