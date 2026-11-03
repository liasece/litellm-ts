/**
 * Speed 页面（模型输出 TPS）前后端共享契约
 *
 * 后端 `GET /global/model_speed` 与 Dashboard Speed 页面共用这里的字段定义、统计门槛
 * 和日期工具，避免两边各写一份后悄悄漂移：阈值变了页面说明却没变，会让人误读图表。
 */

/** 与 Logs 页「输出 TPS」列一致的输出 token 下限 */
export const MIN_OUTPUT_TOKENS_FOR_SPEED = 20;

/**
 * 单个时间桶至少要有这么多可测算请求，才作为图上的数据点。
 *
 * 单个请求算出来的 TPS 波动极大（首字等待的长短就能翻倍），把它画成曲线会让人
 * 误判模型在变快或变慢；低于该门槛的时段按「没有数据」处理，曲线在该处断开。
 */
export const MIN_BUCKET_REQUESTS = 2;

/** 时间桶粒度 */
export type SpeedBucket = "hour" | "day";

/** 时间序列上的一个点 */
export interface SpeedPoint {
	/** 桶起点（UTC ISO-8601） */
	readonly bucket: string;
	/** 桶内可测算请求的输出 TPS 平均值 */
	readonly avg_tps: number;
	/** 桶内可测算请求的输出 TPS 中位数 */
	readonly p50_tps: number;
	/** 桶内可测算请求数 */
	readonly requests: number;
}

/** 有可测算输出速度的模型 */
export interface SpeedModelSeries {
	/** 模型名，与 SpendLogs.model 一致 */
	readonly model: string;
	/** 区间内全部调用数 */
	readonly calls: number;
	/** 参与统计的可测算请求数（只含达到样本门槛的时间桶） */
	readonly requests: number;
	/** 按请求数加权的输出 TPS 平均值 */
	readonly avg_tps: number;
	/** 按请求数加权的输出 TPS 中位数 */
	readonly p50_tps: number;
	/** 时间序列，按时间升序；样本不足的桶不出现 */
	readonly points: SpeedPoint[];
}

/** 有调用但没有可测算输出速度的模型（图片生成、检索工具、全部失败、样本始终不足等） */
export interface SpeedModelWithoutSeries {
	/** 模型名，与 SpendLogs.model 一致 */
	readonly model: string;
	/** 区间内全部调用数 */
	readonly calls: number;
}

/** 端点响应 */
export interface ModelSpeedReport {
	/** 统计起始自然日，YYYY-MM-DD */
	readonly start_date: string;
	/** 统计结束自然日，YYYY-MM-DD（含当天） */
	readonly end_date: string;
	/** 实际使用的时间桶粒度 */
	readonly bucket: SpeedBucket;
	/** 分桶使用的 IANA 时区 */
	readonly timezone: string;
	/** 计入统计的输出 token 下限 */
	readonly min_output_tokens: number;
	/** 单个时间桶的样本量门槛 */
	readonly min_bucket_requests: number;
	/** 完整的桶时间轴（UTC ISO-8601，按时间升序），页面据此在缺口处断线 */
	readonly buckets: string[];
	/** 有可测算输出速度的模型，按平均输出 TPS 降序 */
	readonly models: SpeedModelSeries[];
	/** 有调用但没有可测算输出的模型，按调用数降序 */
	readonly models_without_speed: SpeedModelWithoutSeries[];
}

/**
 * 日期加减天数，输出 YYYY-MM-DD。
 * @param day - 起始日期
 * @param days - 偏移天数
 */
export function addDays(day: string, days: number): string {
	const base = new Date(day + "T00:00:00.000Z");
	base.setUTCDate(base.getUTCDate() + days);
	return base.toISOString().slice(0, 10);
}

/**
 * 取指定时区下的「今天」，格式 YYYY-MM-DD。
 * @param timezone - IANA 时区名
 * @param now - 当前时刻
 */
export function currentDayInTimeZone(timezone: string, now: Date): string {
	// en-CA 的短日期格式即 YYYY-MM-DD
	return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}
