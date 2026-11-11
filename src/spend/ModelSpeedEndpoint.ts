/**
 * 模型输出速率（输出 TPS）时间序列端点
 *
 * OBSERVABILITY > Speed 页面数据源：按「模型 × 时间桶」返回输出 TPS 随时间的变化。
 * 数据来自 LiteLLM_SpendLogs，口径与 Logs 页「输出 TPS」列严格一致：
 *   TPS = completion_tokens / (endTime - startTime)
 * 两处用同一公式，同一条请求在 Logs 与 Speed 上读到的是同一个数值。
 *
 * 桶内聚合：先算桶内每条可测算请求的 TPS，再求平均（avg_tps），同时给出中位数
 * （p50_tps）。不使用 sum(tokens)/sum(duration)：那是并发吞吐，会被单条长请求主导。
 *
 * 可测算请求（eligible）必须同时满足：
 *   - completion_tokens >= 20（与 Logs 列一致，过短响应的 TPS 被首字等待主导）
 *   - endTime > startTime（排除时长为 0 或负值的脏数据）
 *
 * 归属口径：按「最终实际执行的上游模型」统计，而不是客户端请求的模型名。
 * 正常情况下 model 列就是执行的 deployment 模型（带 provider 前缀）；但发生 fallback、
 * 或在选到部署前就失败时，model 会退化成请求名，此时以 resolved_model_group 为准。
 * 否则一次 claude-opus → gpt-6-astra 的 fallback 会被算成 claude-opus 的速度。
 *
 * 模型相同不代表速度相同：同一个上游 ID 可能由不同订阅账号或 Provider 执行（例如
 * 同一模型同时挂在 OpenCode 和 Claude 订阅下）。归属维度因此是「模型 × 供应商」，
 * 页面才能把供应商图标和速度对应起来，而不是把两条来源不同的曲线合成一条。
 *
 * 供应商取归一化后的身份：历史行会把 custom_llm_provider 记成 cliproxy，真实供应商
 * 在模型串前缀里（cliproxy/opencode-go/deepseek-v4）。只按原始列分组会把同一模型拆成
 * 「cliproxy」和真实供应商两张看起来一样的卡片，所以这里与 Dashboard 的 modelSupplier
 * 保持同一规则。供应商为空或无法确定时按空供应商单独归组。
 *
 * 单个时间桶还要有至少 MIN_BUCKET_REQUESTS 个可测算请求才作为数据点：一两个样本的
 * TPS 波动极大，画出来会让人误判趋势；样本不足的桶按「没有数据」处理。
 *
 * 响应额外给出完整的桶时间轴（buckets），页面用它补齐空档、在缺口处断线；否则前端
 * 把相邻两点直接连起来，看起来像「那些时段也有数据」。
 *
 * 时间桶按调用方时区划分：startTime 在库里是 UTC 的 timestamp without time zone，
 * 先 AT TIME ZONE 'UTC' 还原成真实时刻，再换到目标时区做 date_trunc，最后换回 UTC。
 * 这样「每天」对齐的是使用者当地的午夜，而不是 UTC 午夜。
 */

import type { Router } from "express";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { LlmProviders } from "../types/provider";
import {
	addDays,
	currentDayInTimeZone,
	MIN_BUCKET_REQUESTS,
	MIN_OUTPUT_TOKENS_FOR_SPEED,
	type ModelSpeedReport,
	type SpeedBucket,
	type SpeedModelSeries,
	type SpeedModelWithoutSeries,
	type SpeedPoint,
} from "../shared/ModelSpeed";
import { getInternalUserId } from "./spendManagementHelpers";

export { addDays, currentDayInTimeZone, MIN_BUCKET_REQUESTS, MIN_OUTPUT_TOKENS_FOR_SPEED };
export type { ModelSpeedReport, SpeedBucket, SpeedModelSeries, SpeedModelWithoutSeries, SpeedPoint };

const SPEED_BUCKETS: readonly string[] = ["hour", "day"];

/** 小时桶允许的最大区间（天）：更长区间按天聚合，避免返回过多时间点 */
const HOUR_BUCKET_MAX_RANGE_DAYS = 31;

/** 单次查询允许的最大区间（天） */
export const MAX_SPEED_RANGE_DAYS = 366;

/** 未指定区间时的默认天数 */
const DEFAULT_SPEED_RANGE_DAYS = 7;

/** 时区名白名单：PostgreSQL 时区名只含字母、数字与 _ + - / */
const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+/-]{1,64}$/;

const DATE_ONLY_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

/** 统一把时间投影格式化成 UTC ISO 文本，避免驱动层对 timestamptz 的表示差异 */
const ISO_TEXT_FORMAT = '\'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\'';

/** 单个「模型 × 供应商 × 时间桶」聚合结果（直接来自 SQL） */
export interface SpeedAggregateRow {
	/** 桶起点，SQL 已格式化为 UTC ISO 文本 */
	readonly bucket: string;
	/** 模型名 */
	readonly model: string;
	/** 实际执行请求的供应商原始值（custom_llm_provider）；cliproxy 行由 speedProviderIdentity 归一 */
	readonly provider: string | null;
	/** 桶内全部调用数（含不可测算的请求） */
	readonly calls: number;
	/** 桶内可测算请求数 */
	readonly requests: number;
	/** 桶内可测算请求的输出 TPS 平均值；无样本时为 null */
	readonly avg_tps: number | null;
	/** 桶内可测算请求的输出 TPS 中位数；无样本时为 null */
	readonly p50_tps: number | null;
}

/**
 * 校验时区名并返回规范值。
 *
 * 时区始终以绑定参数进入 SQL，不存在拼接注入；这里校验的目的是把非法时区挡在数据库
 * 之外，让调用方拿到 400 而不是 500。
 * @param raw - 原始 query 值
 * @throws {ApiError} 时区名不是合法 IANA 时区
 */
export function parseSpeedTimeZone(raw: unknown): string {
	if (raw === undefined || raw === null) {
		return "UTC";
	}
	if (typeof raw !== "string") {
		throw ApiError.badRequest("timezone must be an IANA time zone name");
	}
	const value = raw.trim();
	if (value.length === 0) {
		return "UTC";
	}
	if (!TIME_ZONE_PATTERN.test(value)) {
		throw ApiError.badRequest("timezone must be an IANA time zone name");
	}
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: value });
	} catch {
		throw ApiError.badRequest("timezone must be an IANA time zone name");
	}
	return value;
}

/**
 * 校验 YYYY-MM-DD，并确认它对应真实存在的一天。
 * @param raw - 原始字符串
 * @param paramName - 出现在错误信息里的参数名
 * @throws {ApiError} 日期格式非法或不存在该日期
 */
function assertValidDay(raw: string, paramName: string): void {
	if (!DATE_ONLY_PATTERN.test(raw)) {
		throw ApiError.badRequest(paramName + " must be a valid YYYY-MM-DD value");
	}
	const year = Number(raw.slice(0, 4));
	const month = Number(raw.slice(5, 7));
	const day = Number(raw.slice(8, 10));
	const parsed = new Date(Date.UTC(year, month - 1, day));
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	) {
		throw ApiError.badRequest(paramName + " must be a valid YYYY-MM-DD value");
	}
}

/**
 * 两个 YYYY-MM-DD 之间的天数差。
 * @param start - 起始日期
 * @param end - 结束日期
 */
function daysBetween(start: string, end: string): number {
	return Math.round((Date.parse(end + "T00:00:00.000Z") - Date.parse(start + "T00:00:00.000Z")) / 86400000);
}

/**
 * 解析并校验查询区间。
 *
 * 区间按调用方时区的自然日理解：end_date 是包含在内的最后一天。
 * @param query - Express query
 * @param timezone - 已校验的时区
 * @param now - 当前时刻（便于测试）
 * @throws {ApiError} 区间格式非法、起止颠倒或超过允许天数
 */
export function parseSpeedDateRange(
	query: Record<string, unknown>,
	timezone: string,
	now = new Date(),
): { startDate: string; endDate: string; rangeDays: number } {
	const rawEnd = query["end_date"];
	const rawStart = query["start_date"];
	const endDate = typeof rawEnd === "string" && rawEnd.trim().length > 0 ? rawEnd.trim() : currentDayInTimeZone(timezone, now);
	const startDate =
		typeof rawStart === "string" && rawStart.trim().length > 0 ? rawStart.trim() : addDays(endDate, -(DEFAULT_SPEED_RANGE_DAYS - 1));
	assertValidDay(startDate, "start_date");
	assertValidDay(endDate, "end_date");
	const rangeDays = daysBetween(startDate, endDate);
	if (rangeDays < 0) {
		throw ApiError.badRequest("start_date must not be after end_date");
	}
	if (rangeDays > MAX_SPEED_RANGE_DAYS) {
		throw ApiError.badRequest("Date range must be at most " + MAX_SPEED_RANGE_DAYS + " days");
	}
	return { startDate: startDate, endDate: endDate, rangeDays: rangeDays };
}

/**
 * 选择时间桶粒度。
 *
 * 不传 bucket 时：7 天及以内按小时，更长区间按天。
 * 显式传 hour 时限制在 31 天以内，避免一次返回上千个时间点。
 * @param rangeDays - 区间天数
 * @param requested - 原始 query 值
 * @throws {ApiError} 粒度非法，或小时桶超出允许区间
 */
export function resolveSpeedBucket(rangeDays: number, requested: unknown): SpeedBucket {
	if (requested === undefined || requested === null || requested === "") {
		return rangeDays <= 7 ? "hour" : "day";
	}
	if (typeof requested !== "string" || !SPEED_BUCKETS.includes(requested)) {
		throw ApiError.badRequest('bucket must be "hour" or "day"');
	}
	const bucket = requested as SpeedBucket;
	if (bucket === "hour" && rangeDays > HOUR_BUCKET_MAX_RANGE_DAYS) {
		throw ApiError.badRequest("hourly buckets are only available for ranges up to " + HOUR_BUCKET_MAX_RANGE_DAYS + " days");
	}
	return bucket;
}

/**
 * 把 SQL 时间值归一为 UTC ISO 字符串。
 *
 * SQL 已把桶起点格式化成 UTC ISO 文本；这里同时兼容 Date 与 PostgreSQL 的其它文本形式
 * （例如 2026-11-01 06:00:00+00，V8 不接受省略分钟的 +00 偏移），避免驱动层差异
 * 把所有数据点当成无效时间丢掉。
 * @param value - 时间投影结果
 */
function toBucketIso(value: Date | string): string {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? "" : value.toISOString();
	}
	if (typeof value !== "string") {
		return "";
	}
	let text = value.trim();
	if (text.length === 0) {
		return "";
	}
	text = text.replace(" ", "T");
	if (/[+-][0-9]{2}$/.test(text)) {
		text = text + ":00";
	} else if (!/([+-][0-9]{2}:[0-9]{2}|Z)$/.test(text)) {
		text = text + "Z";
	}
	const parsed = new Date(text);
	return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/**
 * 把任意数值输入归一为有限数，否则返回 fallback。
 *
 * Number(null) 是 0，直接转换会把「没有样本」的 NULL 聚合画成 0 TPS。
 * @param value - 原始值
 * @param fallback - 兜底值
 */
function finiteOr(value: unknown, fallback: number): number {
	if (value === null || value === undefined || value === "") {
		return fallback;
	}
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

interface Accumulator {
	model: string;
	provider: string;
	calls: number;
	requests: number;
	tpsSum: number;
	tpsWeight: number;
	points: SpeedPoint[];
}

/** 与 Dashboard 的 subscription_provider_slugs 一致的订阅供应商集合 */
const SUBSCRIPTION_PROVIDERS = new Set<string>([
	LlmProviders.CodexSubscription,
	LlmProviders.CommandCode,
	LlmProviders.OpenCodeGo,
	LlmProviders.KimiSubscription,
	LlmProviders.ClaudeSubscription,
	LlmProviders.AntigravitySubscription,
	LlmProviders.XaiSubscription,
]);

/**
 * 归一化供应商身份，与 Dashboard 的 `modelSupplier` 保持同一规则。
 *
 * 历史行把 custom_llm_provider 记成 cliproxy，真实供应商在模型前缀里
 * （cliproxy/opencode-go/deepseek-v4 → opencode-go）。不归一化就会把同一模型拆成
 * 「cliproxy」和真实供应商两张看起来一样的卡片。非 cliproxy 行原样返回，
 * "-" 和空值归一为空字符串。
 * @param model - 模型名，可能带 cliproxy/ 前缀
 * @param provider - custom_llm_provider 原始值
 */
export function speedProviderIdentity(model: string, provider: string | null | undefined): string {
	const raw = typeof provider === "string" ? provider.trim() : "";
	if (raw.toLowerCase() === "cliproxy") {
		const segments = model.trim().toLowerCase().split("/");
		const prefix = segments[0] === "cliproxy" ? segments[1] : segments[0];
		return prefix && SUBSCRIPTION_PROVIDERS.has(prefix) ? prefix : "";
	}
	return raw === "-" ? "" : raw;
}

/**
 * 把「模型 × 供应商 × 时间桶」聚合行整理成按「模型 × 供应商」分组的时间序列。
 *
 * 纯函数：便于在不连数据库的情况下验证分组、样本门槛、排序与空模型归类。
 * - 同一模型由不同供应商执行时分成独立序列，不能把两者的速度混在一起；
 * - 历史 cliproxy 行按上游前缀归一成真实订阅供应商，避免同名卡片重复；
 * - 单个桶的可测算请求少于 MIN_BUCKET_REQUESTS 时按「没有数据」处理，不进入序列，
 *   也不计入模型级平均；
 * - 有数据点的模型进入 models，按平均输出 TPS 降序；
 * - 只有调用、没有可用数据点的模型进入 models_without_speed，按调用数降序。
 * @param rows - SQL 聚合结果
 * @param options - 区间、粒度与桶时间轴信息
 */
export function buildModelSpeedReport(
	rows: readonly SpeedAggregateRow[],
	options: {
		readonly startDate: string;
		readonly endDate: string;
		readonly bucket: SpeedBucket;
		readonly timezone: string;
		readonly buckets: readonly string[];
	},
): ModelSpeedReport {
	const byModel = new Map<string, Accumulator>();

	for (const row of rows) {
		const model = typeof row.model === "string" && row.model.length > 0 ? row.model : "(unknown)";
		const provider = speedProviderIdentity(model, row.provider);
		// 模型名里可能带分隔符，用不可见字符拼 key 避免 model/provider 边界串组
		const key = model + "\u0000" + provider;
		let entry = byModel.get(key);
		if (!entry) {
			entry = { model: model, provider: provider, calls: 0, requests: 0, tpsSum: 0, tpsWeight: 0, points: [] };
			byModel.set(key, entry);
		}
		const requests = Math.max(0, finiteOr(row.requests, 0));
		entry.calls += Math.max(0, finiteOr(row.calls, 0));

		// 样本不足的时段按「没有数据」处理：既不画点，也不参与模型级平均
		if (requests < MIN_BUCKET_REQUESTS) {
			continue;
		}
		const avgTps = finiteOr(row.avg_tps, Number.NaN);
		const bucketIso = toBucketIso(row.bucket);
		if (!Number.isFinite(avgTps) || avgTps < 0 || bucketIso.length === 0) {
			continue;
		}
		const p50Tps = finiteOr(row.p50_tps, avgTps);
		entry.requests += requests;
		entry.tpsSum += avgTps * requests;
		entry.tpsWeight += requests;
		entry.points.push({
			bucket: bucketIso,
			avg_tps: avgTps,
			p50_tps: Number.isFinite(p50Tps) ? p50Tps : avgTps,
			requests: requests,
		});
	}

	const models: SpeedModelSeries[] = [];
	const modelsWithoutSpeed: SpeedModelWithoutSeries[] = [];

	for (const entry of byModel.values()) {
		if (entry.requests <= 0 || entry.tpsWeight <= 0 || entry.points.length === 0) {
			modelsWithoutSpeed.push({ model: entry.model, provider: entry.provider, calls: entry.calls });
			continue;
		}
		entry.points.sort((left, right) => left.bucket.localeCompare(right.bucket));
		const p50Weighted = entry.points.reduce((sum, point) => sum + point.p50_tps * point.requests, 0) / entry.tpsWeight;
		models.push({
			model: entry.model,
			provider: entry.provider,
			calls: entry.calls,
			requests: entry.requests,
			avg_tps: entry.tpsSum / entry.tpsWeight,
			p50_tps: p50Weighted,
			points: entry.points,
		});
	}

	// 展示顺序：平均输出 TPS 降序，快的模型排在前面；同速时按样本量、再按模型名与供应商稳定排序
	models.sort(
		(left, right) =>
			right.avg_tps - left.avg_tps ||
			right.requests - left.requests ||
			left.model.localeCompare(right.model) ||
			left.provider.localeCompare(right.provider),
	);
	modelsWithoutSpeed.sort(
		(left, right) => right.calls - left.calls || left.model.localeCompare(right.model) || left.provider.localeCompare(right.provider),
	);

	return {
		start_date: options.startDate,
		end_date: options.endDate,
		bucket: options.bucket,
		timezone: options.timezone,
		min_output_tokens: MIN_OUTPUT_TOKENS_FOR_SPEED,
		min_bucket_requests: MIN_BUCKET_REQUESTS,
		buckets: Array.from(options.buckets),
		models: models,
		models_without_speed: modelsWithoutSpeed,
	};
}

/**
 * 注册 Speed 页面所需的模型输出速率端点。
 * @param router - 已鉴权的 Express Router
 * @param db - Drizzle 数据库实例
 */
export function registerModelSpeedEndpoints(router: Router, db: NodePgDatabase<typeof schema>): void {
	registerRoute(router, { method: "get", path: "/global/model_speed" }, async (req) => {
		const timezone = parseSpeedTimeZone(req.query["timezone"]);
		const range = parseSpeedDateRange(req.query, timezone);
		const bucket = resolveSpeedBucket(range.rangeDays, req.query["bucket"]);
		const endDateExclusive = addDays(range.endDate, 1);

		// eligible 与 Logs 页「输出 TPS」列同一门槛
		const eligible = sql`(${liteLLM_SpendLogs.completion_tokens} >= ${MIN_OUTPUT_TOKENS_FOR_SPEED} AND ${liteLLM_SpendLogs.endTime} > ${liteLLM_SpendLogs.startTime})`;
		const tpsExpr = sql`${liteLLM_SpendLogs.completion_tokens}::double precision / EXTRACT(EPOCH FROM (${liteLLM_SpendLogs.endTime} - ${liteLLM_SpendLogs.startTime}))`;
		// 统一格式化成 UTC ISO 文本：驱动层对 timestamptz 的返回类型不一致（Date 或文本），
		// 由 SQL 固化格式后前端才能稳定解析
		// 归属模型：有 deployment（model_id）时它就是实际执行的模型；没有时
		// （fallback、或选到部署前就失败）退回最终解析到的模型组。
		// 只在 model_id 为空的少量行上读 metadata，避免为分组 detoast 全部 JSON。
		const attributedModelExpr = sql`CASE
				WHEN COALESCE(${liteLLM_SpendLogs.model_id}, '') <> '' THEN ${liteLLM_SpendLogs.model}
				ELSE COALESCE(NULLIF(${liteLLM_SpendLogs.metadata}->>'resolved_model_group', ''), ${liteLLM_SpendLogs.model})
			END`;
		const bucketTextExpr = sql`to_char((date_trunc(${bucket}::text, (${liteLLM_SpendLogs.startTime} AT TIME ZONE 'UTC' AT TIME ZONE ${timezone}::text)) AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC', ${sql.raw(ISO_TEXT_FORMAT)})`;

		// 区间边界：把调用方时区的自然日换算成 UTC 的 timestamp without time zone。
		// 右侧是常量表达式，startTime 索引仍然可用。
		const startBound = sql`((${range.startDate}::timestamp AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC')`;
		const endBound = sql`((${endDateExclusive}::timestamp AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC')`;

		const conditions: SQL[] = [sql`${liteLLM_SpendLogs.startTime} >= ${startBound}`, sql`${liteLLM_SpendLogs.startTime} < ${endBound}`];
		// internal_user / internal_user_viewer 只能看到自己产生的调用，与其他 /global 端点一致
		const internalUserId = getInternalUserId(req.auth);
		if (internalUserId !== undefined) {
			conditions.push(eq(liteLLM_SpendLogs.user, internalUserId));
		}

		// Speed 的原始行分两条来源：
		// - 有 deployment（99% 的行）只读普通列，可走覆盖索引的 index-only scan；
		// - 没有 deployment 的行（约 1%）才读 metadata 的 resolved_model_group。
		// 两段 UNION ALL 后再聚合，p50 仍在完整样本上计算，不是两个分位数的加权近似。
		const hasDeployment = sql`COALESCE(${liteLLM_SpendLogs.model_id}, '') <> ''`;
		const lacksDeployment = sql`COALESCE(${liteLLM_SpendLogs.model_id}, '') = ''`;
		const providerExpr = sql`COALESCE(${liteLLM_SpendLogs.custom_llm_provider}, '')`;
		const speedRowSelect = (model: SQL, predicate: SQL): SQL => sql`
			SELECT
				${bucketTextExpr} AS bucket,
				${model} AS model,
				${providerExpr} AS provider,
				CASE WHEN ${eligible} THEN ${tpsExpr} END AS tps
			FROM ${liteLLM_SpendLogs}
			WHERE ${and(...conditions, predicate)!}
		`;
		const speedRowsQuery = sql`
			WITH speed_rows AS (
				${speedRowSelect(sql`${liteLLM_SpendLogs.model}`, hasDeployment)}
				UNION ALL
				${speedRowSelect(attributedModelExpr, lacksDeployment)}
			)
			SELECT
				bucket,
				model,
				provider,
				(COUNT(*))::int AS calls,
				(COUNT(*) FILTER (WHERE tps IS NOT NULL))::int AS requests,
				AVG(tps) FILTER (WHERE tps IS NOT NULL) AS avg_tps,
				(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY tps) FILTER (WHERE tps IS NOT NULL)) AS p50_tps
			FROM speed_rows
			GROUP BY 1, 2, 3
		`;
		const speedResult = (await db.execute(speedRowsQuery)) as unknown as { rows: SpeedAggregateRow[] };
		const rows = speedResult.rows;

		// 完整的桶时间轴：让页面能在没有数据的时段断开曲线，而不是把两端直接连起来。
		// generate_series 走「当地墙钟」，再换回 UTC，夏令时切换日的 23/25 小时也能对齐。
		const step = bucket === "hour" ? sql.raw("interval '1 hour'") : sql.raw("interval '1 day'");
		const axisResult = (await db.execute(sql`
			SELECT to_char(
				(series.bucket_local AT TIME ZONE ${timezone}::text) AT TIME ZONE 'UTC',
				${sql.raw(ISO_TEXT_FORMAT)}
			) AS bucket_start
			FROM generate_series(
				${range.startDate}::timestamp,
				${endDateExclusive}::timestamp - interval '1 second',
				${step}
			) AS series(bucket_local)
		`)) as unknown as { rows: Array<{ bucket_start: string }> };
		const buckets = axisResult.rows.map((row) => toBucketIso(row.bucket_start)).filter((value) => value.length > 0);

		return buildModelSpeedReport(rows, {
			startDate: range.startDate,
			endDate: range.endDate,
			bucket: bucket,
			timezone: timezone,
			buckets: buckets,
		});
	});
}
