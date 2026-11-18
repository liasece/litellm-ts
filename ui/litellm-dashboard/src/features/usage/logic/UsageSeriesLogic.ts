import type { BreakdownMetrics, DailyData, SpendMetrics, UsageDetailItem, UsageDetailResponse, UsageTeam } from "../support/UsageModels";
import { usageColors, type ChartRow } from "./UsageChartLogic";
import { formatKeyLabel } from "./UsageSummaryLogic";

/**
 * Activity 顶部堆叠柱状图的数据。
 *
 * 每个系列就是一条柱子中的一段，颜色由实体在页面中的先后顺序决定，Token 图与
 * 花费图共用同一套颜色，方便横向对照“这个实体花的 token 与钱”。
 */
export interface ActivitySeriesSlice {
	/** 图表系列名，同时也是柱状图数据对象的键。 */
	label: string;
	color: string;
	tokens: number;
	spend: number;
	/** 余量合并出来的 “Other”，没有余量时不生成。 */
	other: boolean;
}

export interface ActivitySeriesChart {
	rows: ChartRow[];
	categories: string[];
	colors: string[];
}

export interface ActivitySeries {
	slices: ActivitySeriesSlice[];
	tokens: ActivitySeriesChart;
	spend: ActivitySeriesChart;
}

/** 颜色按顺序分配：前几个用现有调色板，超出后循环，保证同一张图内尽量可区分。 */
const SERIES_COLORS = ["indigo", "cyan", "emerald", "amber", "rose", "violet", "orange", "blue"];
const OTHER_COLOR = "#9ca3af";
const OTHER_LABEL = "Other";
/** 图例一行放得下的系列数；多出的实体并入 Other，避免柱子碎得看不出趋势。 */
export const ACTIVITY_SERIES_LIMIT = 7;
/** 花费是浮点累加，余量可能只剩 1e-15；低于这两个阈值说明只是误差，不该长出一个 Other 图例。 */
const SPEND_NOISE = 1e-6;
const TOKEN_NOISE = 0.5;
/** 支持绘制堆叠图的 breakdown 维度；providers/model_groups 等维度没有对应 Activity Tab。 */
export type ActivitySeriesDimension = "models" | "api_keys" | "mcp_servers" | "endpoints" | "entities";

interface EntityDaily {
	key: string;
	/** 未去重的展示名；同名实体会在 buildSeries 里追加序号。 */
	rawLabel: string;
	daily: Map<string, SpendMetrics>;
}

interface EntityTotal {
	key: string;
	rawLabel: string;
	daily: Map<string, SpendMetrics>;
	tokens: number;
	spend: number;
}

function emptyChart(): ActivitySeriesChart {
	return { rows: [], categories: [], colors: [] };
}

function emptySeries(): ActivitySeries {
	return { slices: [], tokens: emptyChart(), spend: emptyChart() };
}

/** 同名实体（例如两个 key 用了同一个别名）必须各自成段，否则会被合并成一根柱子。 */
function uniqueLabel(label: string, used: Map<string, number>): string {
	const seen = used.get(label) ?? 0;
	used.set(label, seen + 1);
	return seen === 0 ? label : `${label} (${seen + 1})`;
}

/**
 * 按花费与 Token 两个榜单挑选要单独着色的实体。
 *
 * 只按花费排序会让“Token 很多但便宜”的实体沉到 Other 里；只按 Token 排序又会
 * 漏掉贵的实体。取两个名次的较小值，等于保留“至少在一个榜上靠前”的实体。
 */
function rankedEntities(entities: EntityTotal[], limit: number): EntityTotal[] {
	const rank = (value: (entity: EntityTotal) => number) => {
		const order = [...entities].sort((left, right) => value(right) - value(left) || left.key.localeCompare(right.key));
		return new Map(order.map((entity, index) => [entity.key, index]));
	};
	const spendRank = rank((entity) => entity.spend),
		tokenRank = rank((entity) => entity.tokens);
	return (
		[...entities]
			.map((entity) => ({ entity, best: Math.min(spendRank.get(entity.key) ?? 0, tokenRank.get(entity.key) ?? 0) }))
			.sort((left, right) => left.best - right.best || right.entity.spend - left.entity.spend)
			.slice(0, limit)
			// 图例按花费从高到低，与页面下方的实体列表顺带对齐。
			.sort((left, right) => right.entity.spend - left.entity.spend)
			.map((entry) => entry.entity)
	);
}

/**
 * 把“实体 → 每日指标”摊平成两张堆叠柱状图。
 *
 * `dayTotals` 是每天的真实总量；没被单独着色的实体由它减去已选实体得到，所以
 * 柱高总和始终等于当天用量。缺数据的日子按 0 处理，保证所有系列形状一致。
 */
function buildSeries(entities: EntityDaily[], dates: string[], dayTotals: Map<string, SpendMetrics>, limit: number): ActivitySeries {
	const totals: EntityTotal[] = entities
		.map((entity) => ({
			key: entity.key,
			rawLabel: entity.rawLabel,
			daily: entity.daily,
			tokens: [...entity.daily.values()].reduce((sum, day) => sum + day.total_tokens, 0),
			spend: [...entity.daily.values()].reduce((sum, day) => sum + day.spend, 0),
		}))
		.filter((entity) => entity.tokens > 0 || entity.spend > 0);
	if (totals.length === 0) return emptySeries();
	const selected = rankedEntities(totals, limit),
		usedLabels = new Map<string, number>(),
		labels = new Map(selected.map((entity) => [entity.key, uniqueLabel(entity.rawLabel, usedLabels)]));

	const orderedDates = [...new Set(dates)].sort((left, right) => left.localeCompare(right));
	const tokenRows: ChartRow[] = [],
		spendRows: ChartRow[] = [],
		otherRow = { tokens: 0, spend: 0 };
	for (const date of orderedDates) {
		const tokenRow: ChartRow = { date },
			spendRow: ChartRow = { date };
		let tokenSum = 0,
			spendSum = 0;
		for (const entity of selected) {
			const metrics = entity.daily.get(date),
				tokens = metrics?.total_tokens ?? 0,
				spend = metrics?.spend ?? 0,
				label = labels.get(entity.key)!;
			tokenRow[label] = tokens;
			spendRow[label] = spend;
			tokenSum += tokens;
			spendSum += spend;
		}
		const total = dayTotals.get(date);
		// 浮点误差会让余量出现 -0.0000001，夹到 0 免得堆叠出现负段。
		const restTokens = Math.max(0, (total?.total_tokens ?? tokenSum) - tokenSum),
			restSpend = Math.max(0, (total?.spend ?? spendSum) - spendSum),
			meaningful = restTokens >= TOKEN_NOISE || restSpend >= SPEND_NOISE;
		// 每天都写 Other 键，图表系列在所有列上形状一致；只有真实余量才生成图例项。
		tokenRow[OTHER_LABEL] = meaningful ? restTokens : 0;
		spendRow[OTHER_LABEL] = meaningful ? restSpend : 0;
		if (meaningful) {
			otherRow.tokens += restTokens;
			otherRow.spend += restSpend;
		}
		tokenRows.push(tokenRow);
		spendRows.push(spendRow);
	}

	const slices: ActivitySeriesSlice[] = selected.map((entity, index) => {
		const label = labels.get(entity.key)!;
		return {
			label,
			color: usageColors[SERIES_COLORS[index % SERIES_COLORS.length]]!,
			tokens: tokenRows.reduce((sum, row) => sum + Number(row[label] ?? 0), 0),
			spend: spendRows.reduce((sum, row) => sum + Number(row[label] ?? 0), 0),
			other: false,
		};
	});
	if (otherRow.tokens > 0 || otherRow.spend > 0)
		slices.push({ label: OTHER_LABEL, color: OTHER_COLOR, tokens: otherRow.tokens, spend: otherRow.spend, other: true });

	return {
		slices,
		tokens: { rows: tokenRows, categories: slices.map((slice) => slice.label), colors: slices.map((slice) => slice.color) },
		spend: { rows: spendRows, categories: slices.map((slice) => slice.label), colors: slices.map((slice) => slice.color) },
	};
}

function detailLabel(item: UsageDetailItem, teams: UsageTeam[], keys: boolean): string {
	if (!keys) return item.key || "Unknown Item";
	const metadata = (item.metadata ?? {}) as { key_alias?: string | null; key_name?: string | null; team_id?: string | null };
	return formatKeyLabel(
		{ key_alias: metadata.key_alias ?? null, key_name: metadata.key_name ?? null, team_id: metadata.team_id ?? null },
		item.key,
		teams,
	);
}

/**
 * 把某维度 detail 响应的已加载实体转成堆叠图（Global 的 Model/Key/MCP/Endpoint Tab）。
 *
 * 数据来自当前已加载的实体（默认按花费排序的第一页，加载更多后会补进新实体），
 * 每天的总量取自响应里的 `results`，因此未加载的实体仍然计入柱子总高度，不会
 * 出现“图上总量小于实际用量”的错觉。
 *
 * @param detail - 当前维度 detail 响应；为空时返回空图
 * @param teams - 团队别名，用于 Key 展示
 * @param keys - 当前维度是否为 API Key
 */
export function activitySeries(
	detail: UsageDetailResponse | null,
	teams: UsageTeam[],
	keys: boolean,
	limit = ACTIVITY_SERIES_LIMIT,
): ActivitySeries {
	if (!detail || detail.items.length === 0) return emptySeries();
	const entities: EntityDaily[] = detail.items.map((item) => ({
		key: item.key,
		rawLabel: detailLabel(item, teams, keys),
		daily: new Map(item.daily.map((day) => [day.date, day.metrics])),
	}));
	const dates = [...detail.results.map((row) => row.date), ...detail.items.flatMap((item) => item.daily.map((day) => day.date))];
	return buildSeries(entities, dates, new Map(detail.results.map((row) => [row.date, row.metrics])), limit);
}

/**
 * 从 full 响应的每日 breakdown 转成堆叠图（Team/Org/User 等实体视图）。
 *
 * 这些页面本来就拿完整响应，breakdown 里已包含全部实体与全部日期，不需要再发
 * 请求；聚合兜底（没有 breakdown）时返回空图，由调用方决定不渲染。
 *
 * @param days - full 响应的每日结果
 * @param dimension - 要着色的维度
 * @param teams - 团队别名，用于 Key 展示
 * @param keys - 当前维度是否为 API Key
 */
export function activityBreakdownSeries(
	days: readonly DailyData[],
	dimension: ActivitySeriesDimension,
	teams: UsageTeam[],
	keys: boolean,
	limit = ACTIVITY_SERIES_LIMIT,
): ActivitySeries {
	if (days.length === 0) return emptySeries();
	const grouped = new Map<string, EntityDaily>();
	for (const day of days) {
		const breakdown = (day.breakdown?.[dimension] ?? {}) as BreakdownMetrics[ActivitySeriesDimension];
		for (const [key, entry] of Object.entries(breakdown)) {
			const entity = grouped.get(key) ?? {
				key: key,
				rawLabel: keys ? keyLabel(entry.metadata, key, teams) : key,
				daily: new Map<string, SpendMetrics>(),
			};
			entity.daily.set(day.date, entry.metrics);
			grouped.set(key, entity);
		}
	}
	return buildSeries(
		[...grouped.values()],
		days.map((day) => day.date),
		new Map(days.map((day) => [day.date, day.metrics])),
		limit,
	);
}

function keyLabel(metadata: unknown, key: string, teams: UsageTeam[]): string {
	const value = (metadata ?? {}) as { key_alias?: string | null; key_name?: string | null; team_id?: string | null };
	return formatKeyLabel(
		{ key_alias: value.key_alias ?? null, key_name: value.key_name ?? null, team_id: value.team_id ?? null },
		key,
		teams,
	);
}

export interface ActivityTooltipRow {
	label: string;
	color: string;
	value: number;
}

/**
 * 堆叠柱状图的悬浮明细：只列出当天有数值的系列，按数值从大到小。
 * 直接复用默认 tooltip 会把整张图的系列全列一遍，鼠标停在空柱子上时尤其吵。
 */
export function activityTooltipRows(chart: ActivitySeriesChart, row: ChartRow): ActivityTooltipRow[] {
	return chart.categories
		.map((label, index) => ({ label, color: chart.colors[index] ?? OTHER_COLOR, value: Number(row[label] ?? 0) }))
		.filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
		.sort((left, right) => right.value - left.value);
}
