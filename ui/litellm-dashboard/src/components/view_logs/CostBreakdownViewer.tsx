import { useMoneyFormatter } from "@/contexts/PriceDisplay";
import React from "react";
import { Collapse } from "antd";

export interface CostBreakdown {
	cache_input_cost?: number;
	input_cost?: number;
	output_cost?: number;
	total_cost?: number;
	tool_usage_cost?: number;
	additional_costs?: Record<string, number>;
	original_cost?: number;
	discount_percent?: number;
	discount_amount?: number;
	margin_percent?: number;
	margin_fixed_amount?: number;
	margin_total_amount?: number;
}

export interface CostBreakdownViewerProps {
	costBreakdown: CostBreakdown | null | undefined;
	totalSpend: number;
	promptTokens?: number;
	completionTokens?: number;
	cacheHit?: string;
	model?: import("@/utils/priceDisplay").ModelPriceIdentity;
}

const formatPercent = (percent: number | undefined): string => {
	if (percent === undefined || percent === null) return "-";
	return `${(percent * 100).toFixed(2)}%`;
};

/**
 * 费用拆分的展示判定与派生金额。
 *
 * 费用并入 log 详情页的 Detail Info 后，面板头部和明细行要分别渲染同一份结果，
 * 所以把可见性、缓存命中时的归零金额和格式化放在一处，避免两处各算一套。
 * @param props - 费用拆分数据与上下文
 */
export function useCostBreakdownView({
	costBreakdown,
	totalSpend,
	promptTokens,
	completionTokens,
	cacheHit,
	model,
}: CostBreakdownViewerProps) {
	const formatMoney = useMoneyFormatter();
	const formatCost = (cost: number | undefined) => formatMoney(cost, 8, model);
	const isCached = cacheHit?.toLowerCase() === "true";
	const hasTokenCounts = promptTokens !== undefined || completionTokens !== undefined;

	const hasCostBreakdown = costBreakdown?.input_cost !== undefined || costBreakdown?.output_cost !== undefined;
	const hasAdditionalCosts =
		costBreakdown?.additional_costs &&
		Object.entries(costBreakdown.additional_costs).some(([, value]) => value != null && value !== 0);
	const hasDiscount =
		costBreakdown &&
		((costBreakdown.discount_percent !== undefined && costBreakdown.discount_percent !== 0) ||
			(costBreakdown.discount_amount !== undefined && costBreakdown.discount_amount !== 0));
	const hasMargin =
		costBreakdown &&
		((costBreakdown.margin_percent !== undefined && costBreakdown.margin_percent !== 0) ||
			(costBreakdown.margin_fixed_amount !== undefined && costBreakdown.margin_fixed_amount !== 0) ||
			(costBreakdown.margin_total_amount !== undefined && costBreakdown.margin_total_amount !== 0));

	// When cached, show $0 (authoritative total) instead of pre-cache costs from cost_breakdown
	return {
		formatCost,
		hasDiscount: Boolean(hasDiscount),
		hasMargin: Boolean(hasMargin),
		inputCost: isCached ? 0 : costBreakdown?.input_cost,
		isCached,
		originalCost: isCached ? 0 : costBreakdown?.original_cost,
		outputCost: isCached ? 0 : costBreakdown?.output_cost,
		totalCost: isCached ? 0 : costBreakdown?.total_cost ?? totalSpend,
		visible: Boolean(hasCostBreakdown || hasTokenCounts || hasAdditionalCosts || hasDiscount || hasMargin),
	};
}

/**
 * 费用明细行：输入/输出费用、工具与附加费用、折扣/加价和最终费用。
 *
 * 单独导出是为了让 log 详情页在 Detail Info 面板里复用同一份明细：
 * 那里已经有卡片外框，不能再套一层标题栏。没有可展示的费用数据时不渲染。
 * @param props - 费用拆分数据与上下文
 */
export const CostBreakdownDetails: React.FC<CostBreakdownViewerProps> = (props) => {
	const { costBreakdown: breakdown, promptTokens, completionTokens } = props;
	const { formatCost, hasDiscount, hasMargin, inputCost, isCached, originalCost, outputCost, totalCost, visible } =
		useCostBreakdownView(props);

	if (!visible) {
		return null;
	}

	return (
		<div className="space-y-4">
			{/* Step 1: Base Token Costs */}
			<div className="space-y-2 max-w-2xl">
				<div className="flex text-sm">
					<span className="text-gray-600 font-medium w-1/3">Input Cost:</span>
					<span className="text-gray-900">
						{formatCost(inputCost)}
						{promptTokens !== undefined && (
							<span className="text-gray-500 font-normal ml-1">
								({promptTokens.toLocaleString()} prompt tokens)
							</span>
						)}
					</span>
				</div>
				<div className="flex text-sm">
					<span className="text-gray-600 font-medium w-1/3">Output Cost:</span>
					<span className="text-gray-900">
						{formatCost(outputCost)}
						{completionTokens !== undefined && (
							<span className="text-gray-500 font-normal ml-1">
								({completionTokens.toLocaleString()} completion tokens)
							</span>
						)}
					</span>
				</div>
				{breakdown?.tool_usage_cost !== undefined && breakdown.tool_usage_cost > 0 && (
					<div className="flex text-sm">
						<span className="text-gray-600 font-medium w-1/3">Tool Usage Cost:</span>
						<span className="text-gray-900">{formatCost(breakdown.tool_usage_cost)}</span>
					</div>
				)}
				{breakdown?.additional_costs &&
					Object.entries(breakdown.additional_costs)
						.filter(([, value]) => value != null && value !== 0)
						.map(([key, value]) => (
							<div key={key} className="flex text-sm">
								<span className="text-gray-600 font-medium w-1/3">{key}:</span>
								<span className="text-gray-900">{formatCost(value)}</span>
							</div>
						))}
			</div>

			{/* Subtotal / Original Cost - hide when cached since it would be $0 */}
			{!isCached && (
				<div className="pt-2 border-t border-gray-100 max-w-2xl">
					<div className="flex text-sm font-semibold">
						<span className="text-gray-900 w-1/3">Original LLM Cost:</span>
						<span className="text-gray-900">{formatCost(originalCost)}</span>
					</div>
				</div>
			)}

			{/* Step 2: Adjustments (Discount & Margin) */}
			{breakdown && (hasDiscount || hasMargin) && (
				<div className="pt-2 space-y-2 max-w-2xl">
					{/* Discounts */}
					{hasDiscount && (
						<div className="space-y-2">
							{breakdown.discount_percent !== undefined && breakdown.discount_percent !== 0 && (
								<div className="flex text-sm text-gray-600">
									<span className="font-medium w-1/3">Discount ({formatPercent(breakdown.discount_percent)}):</span>
									<span className="text-gray-900">-{formatCost(breakdown.discount_amount)}</span>
								</div>
							)}
							{breakdown.discount_amount !== undefined && breakdown.discount_percent === undefined && (
								<div className="flex text-sm text-gray-600">
									<span className="font-medium w-1/3">Discount Amount:</span>
									<span className="text-gray-900">-{formatCost(breakdown.discount_amount)}</span>
								</div>
							)}
						</div>
					)}

					{/* Margins */}
					{hasMargin && (
						<div className="space-y-2">
							{breakdown.margin_percent !== undefined && breakdown.margin_percent !== 0 && (
								<div className="flex text-sm text-gray-600">
									<span className="font-medium w-1/3">Margin ({formatPercent(breakdown.margin_percent)}):</span>
									<span className="text-gray-900">
										+{formatCost((breakdown.margin_total_amount || 0) - (breakdown.margin_fixed_amount || 0))}
									</span>
								</div>
							)}
							{breakdown.margin_fixed_amount !== undefined && breakdown.margin_fixed_amount !== 0 && (
								<div className="flex text-sm text-gray-600">
									<span className="font-medium w-1/3">Margin:</span>
									<span className="text-gray-900">+{formatCost(breakdown.margin_fixed_amount)}</span>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{/* Final Summary */}
			<div className="mt-4 pt-4 border-t border-gray-200 max-w-2xl">
				<div className="flex items-center">
					<span className="font-bold text-sm text-gray-900 w-1/3">Final Calculated Cost:</span>
					<span className="text-sm font-bold text-gray-900">
						{formatCost(totalCost)}
						{isCached && " (Cached)"}
					</span>
				</div>
			</div>
		</div>
	);
};

/**
 * 独立的费用拆分卡片，用于把费用当作单独区块展示的页面。
 * @param props - 费用拆分数据与上下文
 */
export const CostBreakdownViewer: React.FC<CostBreakdownViewerProps> = (props) => {
	const { formatCost, isCached, visible } = useCostBreakdownView(props);

	if (!visible) {
		return null;
	}

	return (
		<div className="bg-white rounded-lg shadow w-full max-w-full overflow-hidden mb-6">
			<Collapse
				expandIconPosition="start"
				items={[
					{
						key: "1",
						label: (
							<div className="flex items-center justify-between w-full">
								<h3 className="text-lg font-medium text-gray-900">Cost Breakdown</h3>
								<div className="flex items-center space-x-2 mr-4">
									<span className="text-sm text-gray-500">Total:</span>
									<span className="text-sm font-semibold text-gray-900">
										{formatCost(props.totalSpend)}
										{isCached && " (Cached)"}
									</span>
								</div>
							</div>
						),
						children: (
							<div className="p-6">
								<CostBreakdownDetails {...props} />
							</div>
						),
					},
				]}
			/>
		</div>
	);
};

export default CostBreakdownViewer;
