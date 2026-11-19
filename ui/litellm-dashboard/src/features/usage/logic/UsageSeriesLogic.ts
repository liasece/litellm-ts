import type { BreakdownMetrics, DailyData, SpendMetrics, UsageDetailItem, UsageDetailResponse, UsageTeam } from "../support/UsageModels";
import type { ChartRow } from "./UsageChartLogic";
import { activitySeriesColors } from "./UsageSeriesPaletteLogic";
import { formatKeyLabel } from "./UsageSummaryLogic";

/**
 * Activity 顶部堆叠柱状图的数据。
 *
 * Token 图与花费图回答的是两个不同问题，所以各自按本榜排序：花费图不被“Token 很多但
 * 便宜”的实体挤乱，Token 图也不按价格排序。两张图都列出全部实体，颜色按两榜并集分配，
 * 同一实体在两图里同色同名，方便横向对照“这个实体花的 token 与钱”。
 *
 * 曾经只给前 7 名单独着色、余量并成 “Other”。问题在于 detail 按花费排序分页，免费却
 * 用量很大的模型（生产上是 `hy4-flash-free`）既进不了花费榜，也落在第二页之外，于是整段
 * Token 被 “Other” 吞掉，图上再也看不出是谁在用。现在没有聚合兜底，每个实体都是独立
 * 系列；调用方必须把该维度的分页取齐，否则柱子会比当日总量矮。
 */
export interface ActivitySeriesSlice {
	/** 图表系列名，同时也是柱状图数据对象的键。 */
	label: string;
	color: string;
	tokens: number;
	spend: number;
}

/** 一张图的数据：本图只包含该指标有数值的实体，图例顺序即本图排序。 */
export interface ActivitySeriesChart {
	rows: ChartRow[];
	categories: string[];
	colors: string[];
	/** 本图图例：按本图榜单顺序排列的实体。 */
	slices: ActivitySeriesSlice[];
}

export interface ActivitySeries {
	tokens: ActivitySeriesChart;
	spend: ActivitySeriesChart;
}

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
	return { rows: [], categories: [], colors: [], slices: [] };
}

function emptySeries(): ActivitySeries {
	return { tokens: emptyChart(), spend: emptyChart() };
}

/** 同名实体（例如两个 key 用了同一个别名）必须各自成段，否则会被合并成一根柱子。 */
function uniqueLabel(label: string, used: Map<string, number>): string {
	const seen = used.get(label) ?? 0;
	used.set(label, seen + 1);
	return seen === 0 ? label : `${label} (${seen + 1})`;
}

/**
 * 按某个指标从高到低排实体。
 *
 * 两名相同时按 key 排序，保证同一份数据每次渲染的图例顺序一致。
 */
function rankedBy(entities: EntityTotal[], value: (entity: EntityTotal) => number): EntityTotal[] {
	return [...entities].sort((left, right) => value(right) - value(left) || left.key.localeCompare(right.key));
}

/** 一张图的取数指标；每张图只列该指标大于 0 的实体，避免图例里出现与这张图无关的名字。 */
type SeriesMetric = "tokens" | "spend";

/**
 * 把“实体 → 每日指标”摊平成两张堆叠柱状图。
 *
 * 两个榜单各按自己的指标排序，并集只用来分配颜色：先给 Token 榜的实体排色，再给只在
 * 花费榜出现的实体顺延。每张图的图例与柱段顺序都取自本榜，图内不再合并任何余量。
 */
function buildSeries(entities: EntityDaily[], dates: string[]): ActivitySeries {
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
	const tokenRanked = rankedBy(totals, (entity) => entity.tokens),
		spendRanked = rankedBy(totals, (entity) => entity.spend);
	const union = [...tokenRanked, ...spendRanked.filter((entity) => entity.tokens <= 0)],
		palette = activitySeriesColors(union.length),
		usedLabels = new Map<string, number>(),
		labels = new Map<string, string>(),
		colors = new Map<string, string>();
	union.forEach((entity, index) => {
		labels.set(entity.key, uniqueLabel(entity.rawLabel, usedLabels));
		colors.set(entity.key, palette[index]!);
	});

	const orderedDates = [...new Set(dates)].sort((left, right) => left.localeCompare(right));
	const buildChart = (ranked: EntityTotal[], metric: SeriesMetric): ActivitySeriesChart => {
		const selected = ranked.filter((entity) => (metric === "tokens" ? entity.tokens : entity.spend) > 0);
		const rows = orderedDates.map((date) => {
			const row: ChartRow = { date };
			for (const entity of selected) {
				const metrics = entity.daily.get(date);
				row[labels.get(entity.key)!] = metric === "tokens" ? (metrics?.total_tokens ?? 0) : (metrics?.spend ?? 0);
			}
			return row;
		});
		const slices: ActivitySeriesSlice[] = selected.map((entity) => ({
			label: labels.get(entity.key)!,
			color: colors.get(entity.key)!,
			tokens: entity.tokens,
			spend: entity.spend,
		}));
		return { rows, categories: slices.map((slice) => slice.label), colors: slices.map((slice) => slice.color), slices };
	};

	return { tokens: buildChart(tokenRanked, "tokens"), spend: buildChart(spendRanked, "spend") };
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
 * 把某维度 detail 响应的实体转成堆叠图（Global 的 Model/Key/MCP/Endpoint Tab）。
 *
 * 数据来自该维度的完整明细：调用方要先把分页取齐（见 `UsageOverviewStore.loadCompleteDetail`），
 * 否则靠后的实体会缺段，柱高对不上当日总量。
 *
 * @param detail - 当前维度 detail 响应；为空时返回空图
 * @param teams - 团队别名，用于 Key 展示
 * @param keys - 当前维度是否为 API Key
 */
export function activitySeries(detail: UsageDetailResponse | null, teams: UsageTeam[], keys: boolean): ActivitySeries {
	if (!detail || detail.items.length === 0) return emptySeries();
	const entities: EntityDaily[] = detail.items.map((item) => ({
		key: item.key,
		rawLabel: detailLabel(item, teams, keys),
		daily: new Map(item.daily.map((day) => [day.date, day.metrics])),
	}));
	const dates = [...detail.results.map((row) => row.date), ...detail.items.flatMap((item) => item.daily.map((day) => day.date))];
	return buildSeries(entities, dates);
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
 * 堆叠柱状图的悬浮明细：列出当天有数值的全部系列，按数值从大到小。
 * 直接复用默认 tooltip 会把整张图的系列全列一遍，鼠标停在空柱子上时尤其吵。
 */
export function activityTooltipRows(chart: ActivitySeriesChart, row: ChartRow): ActivityTooltipRow[] {
	return chart.categories
		.map((label, index) => ({ label, color: chart.colors[index] ?? chart.colors[0] ?? "#9ca3af", value: Number(row[label] ?? 0) }))
		.filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
		.sort((left, right) => right.value - left.value);
}
