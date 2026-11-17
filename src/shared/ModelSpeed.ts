/**
 * Speed 页面（模型输出 TPS）前后端共享契约
 *
 * 后端 `GET /global/model_speed` 与 Dashboard Speed 页面共用这里的字段定义、统计门槛
 * 和日期工具，避免两边各写一份后悄悄漂移：阈值变了页面说明却没变，会让人误读图表。
 *
 * 输出 TPS 的分母是 `endTime - completionStartTime`（首字之后的生成窗口），不是请求
 * 总耗时；非流式请求的 completionStartTime 通常等于 endTime，因此不会被计入曲线。
 *
 * 聚合口径是 token 加权：桶内平均值与服务级平均值都取 `Σ输出 token ÷ Σ生成秒数`，
 * 而不是「每条请求各自算出 TPS 再平均」。后者让一条 200 token 的短请求与一条 2 万
 * token 的长请求等权，短请求里的采样误差会被放大成整个图表的波动；按秒数加权回答的是
 * 「这些 token 平均每秒生成多少」，与只看一条长请求时的读数一致。
 */

/** Logs TPS 与 Speed 共用的输出 token 下限：太短响应的 TPS 被首字等待主导 */
export const MIN_OUTPUT_TOKENS_FOR_TPS = 20;
/** 保留旧名字，Speed 端点与前端 Speed 模块仍按这个名字引用 */
export const MIN_OUTPUT_TOKENS_FOR_SPEED = MIN_OUTPUT_TOKENS_FOR_TPS;
/**
 * 生成窗口至少占总耗时的比例。
 *
 * TTFT 与总耗时相等时没有生成窗口；但生产里也存在上游把整段回答缓冲到最后才写出、
 * 首字和结束只差几毫秒的请求。它们按「生成窗口」算出的 TPS 是交付毛刺而不是模型速度，
 * 与真正等于总耗时的行一起隐藏。1% 是经验门槛：低于它时首字等待已完全主导请求。
 *
 * 比例门槛只挡得住长请求：30 秒的请求可以有 300 毫秒窗口却只占 1%，短请求则相反。
 * 因此再配一个绝对下限 {@link MIN_GENERATION_WINDOW_MS}，两头都挡住。
 */
export const MIN_GENERATION_SHARE_FOR_TPS = 0.01;

/**
 * 生成窗口的绝对下限（毫秒）。
 *
 * 上游把整段回答缓冲到最后才写出时，首字与结束只差几毫秒；比例门槛挡不住短请求里的
 * 这种窗口（5 秒请求里的 50 毫秒仍占 1%），而 50 毫秒里的 20 个 token 会被算成
 * 400 tok/s，看起来像模型突然变快。窗口短到不足以观察生成过程时，读数由采样误差
 * 主导，按不可测算处理比给出数字更接近事实。
 *
 * 300 毫秒是经验值：正常流式响应首字之后的窗口通常是秒级（60 个输出 token 按
 * 200 tok/s 也要 300 毫秒）。生产里 100 毫秒级的窗口仍在报告 9000–13000 tok/s 的读数
 * ——那是上游一次 flush 出上千 token 的投递尖峰（Responses 通道常见），不是模型速度。
 */
export const MIN_GENERATION_WINDOW_MS = 300;

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
	/** 桶内可测算请求按 token 加权的输出 TPS：Σ输出 token ÷ Σ生成秒数 */
	readonly avg_tps: number;
	/** 桶内可测算请求在生成窗口内的输出 TPS 中位数 */
	readonly p50_tps: number;
	/** 桶内可测算请求数 */
	readonly requests: number;
}

/** 有可测算输出速度的模型 */
export interface SpeedModelSeries {
	/** 模型名，与 SpendLogs.model 一致 */
	readonly model: string;
	/**
	 * 归一化后的实际供应商。
	 *
	 * 同一个上游模型名可能由多个订阅账号或 Provider 执行（例如同一模型同时挂在
	 * OpenCode 与 Claude 订阅下），速度差异属于供应商而不是模型本身；因此序列按
	 * 「模型 × 供应商」归组，这里保存该组对应的供应商。历史行记录为 cliproxy 时，
	 * 按模型串前缀还原成真实订阅供应商；无法确定供应商时为空字符串。
	 */
	readonly provider: string;
	/** 区间内全部调用数 */
	readonly calls: number;
	/** 参与统计的可测算请求数（只含达到样本门槛的时间桶） */
	readonly requests: number;
	/** 全部纳入统计的时间桶合并后的 token 加权平均：Σ输出 token ÷ Σ生成秒数 */
	readonly avg_tps: number;
	/** 按请求数加权的生成窗口输出 TPS 中位数 */
	readonly p50_tps: number;
	/** 时间序列，按时间升序；样本不足的桶不出现 */
	readonly points: SpeedPoint[];
}

/** 有调用但没有可测算输出速度的模型（图片生成、检索工具、全部失败、样本始终不足等） */
export interface SpeedModelWithoutSeries {
	/** 模型名，与 SpendLogs.model 一致 */
	readonly model: string;
	/** 实际执行请求的供应商；无法确定时为空字符串 */
	readonly provider: string;
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
	/** 计入统计的生成窗口绝对下限（毫秒） */
	readonly min_generation_window_ms: number;
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
