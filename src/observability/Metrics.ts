/**
 * 进程内指标原语：计数器、仪表与滑动窗口直方图。
 *
 * 设计取向（为线上低开销而写，不是通用指标库）：
 * 1. 标签集合有上限。面板页与配置决定标签来源（路由类别、模型组、Provider），
 *    超过上限的新序列被丢弃并计数，避免一个异常输入把内存与抓取体积拖垮。
 * 2. 直方图同时维护「自进程启动」的累计值与「最近窗口」的环形分片。累计值供
 *    Prometheus 抓取与长期对比；环形窗口供运维在事故现场只看最近几分钟，不必
 *    因为一次长尾把几小时前的样本也算进去。
 * 3. 分位值只做桶内线性插值（与 Prometheus histogram_quantile 同口径），不保存
 *    原始样本，因此单序列内存恒定。
 */

/** 指标标签集合：键固定、值有限。 */
export type MetricLabels = Readonly<Record<string, string>>;

/** 直方图在某个时间窗口内的合并结果。 */
export interface HistogramWindowSnapshot {
	/** 标签集合 */
	readonly labels: MetricLabels;
	/** 窗口内样本数 */
	readonly count: number;
	/** 窗口内样本总和 */
	readonly sum: number;
	/** 各桶累计计数，长度等于 bucket 数 + 1（最后一项为 +Inf） */
	readonly cumulative: readonly number[];
}

/** 分位值结果；没有样本时为 undefined。 */
export type Quantile = number | undefined;

/** 直方图的滑动窗口配置。 */
export interface HistogramWindowOptions {
	/** 每个分片的毫秒宽度 */
	readonly slotMs: number;
	/** 环形分片数量；窗口长度 = slotMs * slotCount */
	readonly slotCount: number;
}

/** 默认滑动窗口：60 个 5 秒分片，共 5 分钟。 */
export const DEFAULT_HISTOGRAM_WINDOW: HistogramWindowOptions = { slotMs: 5_000, slotCount: 60 };

/** 标签值最大长度；超长值被截断，避免把整段请求体塞进标签。 */
const MAX_LABEL_VALUE_LENGTH = 120;

/** 单个指标允许的最大序列数。 */
const DEFAULT_MAX_SERIES = 1_000;

/** 标签键分隔符，使用不可见字符避免与常见标识符冲突。 */
const LABEL_KEY_SEPARATOR = "\u0001";

/**
 * 归一化标签值：只保留维度用的短标识，超长即截断。
 * @param value - 原始标签值
 */
export function normalizeLabelValue(value: string): string {
	if (value.length <= MAX_LABEL_VALUE_LENGTH) {
		return value;
	}
	return `${value.slice(0, MAX_LABEL_VALUE_LENGTH)}\u2026`;
}

/**
 * 按登记的标签名构造序列键；缺失标签记为空串，保证同一指标内键长度稳定。
 * @param labelNames - 指标声明的标签名
 * @param labels - 调用方传入的标签
 */
function buildSeriesKey(labelNames: readonly string[], labels: MetricLabels | undefined): string {
	if (labelNames.length === 0) {
		return "";
	}
	const parts: string[] = [];
	for (const name of labelNames) {
		parts.push(normalizeLabelValue(labels?.[name] ?? ""));
	}
	return parts.join(LABEL_KEY_SEPARATOR);
}

/**
 * 把序列键还原成标签对象，供抓取与报表输出。
 * @param labelNames - 指标声明的标签名
 * @param key - 序列键
 */
function parseSeriesKey(labelNames: readonly string[], key: string): MetricLabels {
	if (labelNames.length === 0) {
		return {};
	}
	const values = key.split(LABEL_KEY_SEPARATOR);
	const labels: Record<string, string> = {};
	for (let index = 0; index < labelNames.length; index += 1) {
		const name = labelNames[index];
		if (name === undefined) {
			continue;
		}
		labels[name] = values[index] ?? "";
	}
	return labels;
}

/** 一个直方图序列在某个时间分片内的累计状态。 */
interface HistogramSlot {
	/** 分片所属的时间片序号；与当前序号不符说明该槽位已过期 */
	readonly epoch: number;
	/** 各桶计数 */
	readonly counts: Float64Array;
	/** 样本总和 */
	sum: number;
	/** 样本数 */
	count: number;
}

/** 直方图单序列：累计统计 + 滑动窗口分片。 */
class HistogramSeries {
	private readonly _buckets: readonly number[];
	private readonly _window: HistogramWindowOptions;
	private readonly _counts: Float64Array;
	private readonly _slots: Array<HistogramSlot | undefined>;
	private _sum = 0;
	private _count = 0;

	/**
	 * @param buckets - 桶上界（升序，单位与观测值相同）
	 * @param window - 滑动窗口配置
	 */
	constructor(buckets: readonly number[], window: HistogramWindowOptions) {
		this._buckets = buckets;
		this._window = window;
		this._counts = new Float64Array(buckets.length + 1);
		this._slots = new Array<HistogramSlot | undefined>(window.slotCount);
	}

	/**
	 * 记录一次观测。
	 * @param value - 观测值（非负）
	 * @param nowMs - 当前毫秒时间戳，取进程单调时钟
	 */
	observe(value: number, nowMs: number): void {
		const slot = this._slotFor(nowMs);
		let bucketIndex = this._buckets.length;
		for (let index = 0; index < this._buckets.length; index += 1) {
			const upper = this._buckets[index];
			if (upper !== undefined && value <= upper) {
				bucketIndex = index;
				break;
			}
		}
		this._counts[bucketIndex] = (this._counts[bucketIndex] ?? 0) + 1;
		this._sum += value;
		this._count += 1;
		slot.counts[bucketIndex] = (slot.counts[bucketIndex] ?? 0) + 1;
		slot.sum += value;
		slot.count += 1;
	}

	/** 累计样本数。 */
	get count(): number {
		return this._count;
	}

	/** 累计样本总和。 */
	get sum(): number {
		return this._sum;
	}

	/** 累计桶计数（供 Prometheus 抓取与快照使用）。 */
	get cumulative(): number[] {
		return toCumulativeCounts(this._counts);
	}

	/**
	 * 合并窗口内所有有效分片。
	 * @param nowMs - 当前毫秒时间戳
	 * @param windowMs - 需要的窗口长度（毫秒）
	 */
	window(nowMs: number, windowMs: number): { count: number; sum: number; cumulative: number[] } {
		const merged = new Float64Array(this._buckets.length + 1);
		let count = 0;
		let sum = 0;
		const currentEpoch = Math.floor(nowMs / this._window.slotMs);
		const reachableSlots = Math.max(1, Math.min(this._window.slotCount, Math.ceil(windowMs / this._window.slotMs)));
		for (let offset = 0; offset < reachableSlots; offset += 1) {
			const epoch = currentEpoch - offset;
			const slot = this._slots[epoch % this._window.slotCount];
			if (slot === undefined || slot.epoch !== epoch) {
				continue;
			}
			count += slot.count;
			sum += slot.sum;
			for (let index = 0; index < slot.counts.length; index += 1) {
				merged[index] = (merged[index] ?? 0) + (slot.counts[index] ?? 0);
			}
		}
		return { count: count, sum: sum, cumulative: toCumulativeCounts(merged) };
	}

	/**
	 * 取当前时间片对应的槽位，必要时清空复用。
	 * @param nowMs - 当前毫秒时间戳
	 */
	private _slotFor(nowMs: number): HistogramSlot {
		const epoch = Math.floor(nowMs / this._window.slotMs);
		const index = epoch % this._window.slotCount;
		const existing = this._slots[index];
		if (existing !== undefined && existing.epoch === epoch) {
			return existing;
		}
		const slot: HistogramSlot = {
			epoch: epoch,
			counts: new Float64Array(this._buckets.length + 1),
			sum: 0,
			count: 0,
		};
		this._slots[index] = slot;
		return slot;
	}
}

/** 直方图的单序列读视图。 */
export interface HistogramSeriesSnapshot {
	/** 标签集合 */
	readonly labels: MetricLabels;
	/** 累计样本数 */
	readonly count: number;
	/** 累计样本总和 */
	readonly sum: number;
	/** 累计桶计数 */
	readonly cumulative: readonly number[];
}

/** 基础指标接口，供注册表统一遍历。 */
export interface MetricLike {
	/** 指标名（snake_case） */
	readonly name: string;
	/** 帮助文本 */
	readonly help: string;
	/** 标签名列表 */
	readonly labelNames: readonly string[];
}

/** 计数器单序列状态：累计值 + 滑动窗口分片。 */
interface CounterSeries {
	/** 自进程启动以来的累计值 */
	total: number;
	/** 每个分片的增量 */
	readonly values: Float64Array;
	/** 每个分片所属时间片序号 */
	readonly epochs: Int32Array;
}

/** 单调递增计数器；同时维护累计值与滑动窗口增量，供「最近几分钟」报表使用。 */
export class Counter implements MetricLike {
	public readonly kind = "counter";
	private readonly _series = new Map<string, CounterSeries>();
	private readonly _window: HistogramWindowOptions;

	/**
	 * @param name - 指标名
	 * @param help - 帮助文本
	 * @param labelNames - 标签名
	 * @param window - 滑动窗口配置
	 */
	constructor(
		public readonly name: string,
		public readonly help: string,
		public readonly labelNames: readonly string[] = [],
		window: HistogramWindowOptions = DEFAULT_HISTOGRAM_WINDOW,
	) {
		this._window = window;
	}

	/**
	 * 累加计数。
	 * @param labels - 标签集合
	 * @param value - 增量，默认 1
	 * @param nowMs - 当前单调时钟（毫秒），供测试注入
	 */
	inc(labels?: MetricLabels, value = 1, nowMs: number = performance.now()): void {
		const series = this._seriesFor(labels);
		series.total += value;
		const epoch = Math.floor(nowMs / this._window.slotMs);
		const index = ((epoch % this._window.slotCount) + this._window.slotCount) % this._window.slotCount;
		if (series.epochs[index] !== epoch) {
			series.epochs[index] = epoch;
			series.values[index] = 0;
		}
		series.values[index] = (series.values[index] ?? 0) + value;
	}

	/**
	 * 读取累计值。
	 * @param labels - 标签集合
	 */
	value(labels?: MetricLabels): number {
		return this._series.get(buildSeriesKey(this.labelNames, labels))?.total ?? 0;
	}

	/**
	 * 读取窗口内的增量。
	 * @param labels - 标签集合
	 * @param windowMs - 窗口长度
	 * @param nowMs - 当前单调时钟（毫秒），供测试注入
	 */
	windowValue(labels?: MetricLabels, windowMs?: number, nowMs: number = performance.now()): number {
		const series = this._series.get(buildSeriesKey(this.labelNames, labels));
		if (series === undefined) {
			return 0;
		}
		return this._windowSum(series, windowMs, nowMs);
	}

	/**
	 * 合并另一组标签后的总值，用于计算错误率这类聚合指标。
	 * @param predicate - 标签过滤
	 */
	sumWhere(predicate: (labels: MetricLabels) => boolean = () => true): number {
		let total = 0;
		for (const [key, series] of this._series) {
			if (predicate(parseSeriesKey(this.labelNames, key))) {
				total += series.total;
			}
		}
		return total;
	}

	/**
	 * 窗口内按标签过滤求和（错误率、RPS 用）。
	 * @param windowMs - 窗口长度
	 * @param predicate - 标签过滤
	 * @param nowMs - 当前单调时钟（毫秒），供测试注入
	 */
	sumWhereInWindow(
		windowMs: number,
		predicate: (labels: MetricLabels) => boolean = () => true,
		nowMs: number = performance.now(),
	): number {
		let total = 0;
		for (const [key, series] of this._series) {
			if (predicate(parseSeriesKey(this.labelNames, key))) {
				total += this._windowSum(series, windowMs, nowMs);
			}
		}
		return total;
	}

	/** 全部序列快照（累计值）。 */
	snapshot(): Array<{ labels: MetricLabels; value: number }> {
		return Array.from(this._series.entries()).map(([key, series]) => ({
			labels: parseSeriesKey(this.labelNames, key),
			value: series.total,
		}));
	}

	/**
	 * 全部序列的窗口快照。
	 * @param windowMs - 窗口长度
	 * @param nowMs - 当前单调时钟（毫秒），供测试注入
	 */
	windowSnapshot(windowMs?: number, nowMs: number = performance.now()): Array<{ labels: MetricLabels; value: number }> {
		return Array.from(this._series.entries()).map(([key, series]) => ({
			labels: parseSeriesKey(this.labelNames, key),
			value: this._windowSum(series, windowMs, nowMs),
		}));
	}

	/**
	 * 取单序列在窗口内的和。
	 * @param series - 序列状态
	 * @param windowMs - 窗口长度
	 * @param nowMs - 当前单调时钟（毫秒）
	 */
	private _windowSum(series: CounterSeries, windowMs: number | undefined, nowMs: number): number {
		const currentEpoch = Math.floor(nowMs / this._window.slotMs);
		const requested = windowMs ?? this._window.slotMs * this._window.slotCount;
		const reachable = Math.max(1, Math.min(this._window.slotCount, Math.ceil(requested / this._window.slotMs)));
		let total = 0;
		for (let offset = 0; offset < reachable; offset += 1) {
			const epoch = currentEpoch - offset;
			const index = ((epoch % this._window.slotCount) + this._window.slotCount) % this._window.slotCount;
			if (series.epochs[index] !== epoch) {
				continue;
			}
			total += series.values[index] ?? 0;
		}
		return total;
	}

	/**
	 * 维护序列存在性；超过上限时抛错由调用方转为丢弃计数。
	 * @param labels - 标签集合
	 */
	private _seriesFor(labels: MetricLabels | undefined): CounterSeries {
		const key = buildSeriesKey(this.labelNames, labels);
		const existing = this._series.get(key);
		if (existing !== undefined) {
			return existing;
		}
		const created: CounterSeries = {
			total: 0,
			values: new Float64Array(this._window.slotCount),
			epochs: new Int32Array(this._window.slotCount).fill(Number.MIN_SAFE_INTEGER),
		};
		this._series.set(key, created);
		return created;
	}
}

/** 可上可下的仪表值。 */
export class Gauge implements MetricLike {
	public readonly kind = "gauge";
	private readonly _series = new Map<string, number>();

	/**
	 * @param name - 指标名
	 * @param help - 帮助文本
	 * @param labelNames - 标签名
	 */
	constructor(
		public readonly name: string,
		public readonly help: string,
		public readonly labelNames: readonly string[] = [],
	) {}

	/**
	 * 设置绝对值。
	 * @param value - 新值
	 * @param labels - 标签集合
	 */
	set(value: number, labels?: MetricLabels): void {
		this._series.set(buildSeriesKey(this.labelNames, labels), value);
	}

	/**
	 * 增加/减少。
	 * @param delta - 增量
	 * @param labels - 标签集合
	 */
	add(delta: number, labels?: MetricLabels): void {
		const key = buildSeriesKey(this.labelNames, labels);
		this._series.set(key, (this._series.get(key) ?? 0) + delta);
	}

	/**
	 * 读取当前值。
	 * @param labels - 标签集合
	 */
	value(labels?: MetricLabels): number {
		return this._series.get(buildSeriesKey(this.labelNames, labels)) ?? 0;
	}

	/** 全部序列快照。 */
	snapshot(): Array<{ labels: MetricLabels; value: number }> {
		return Array.from(this._series.entries()).map(([key, value]) => ({
			labels: parseSeriesKey(this.labelNames, key),
			value: value,
		}));
	}
}

/** 固定桶直方图。 */
export class Histogram implements MetricLike {
	public readonly kind = "histogram";
	public readonly buckets: readonly number[];
	private readonly _window: HistogramWindowOptions;
	private readonly _series = new Map<string, HistogramSeries>();
	private _dropped = 0;

	/**
	 * @param name - 指标名
	 * @param help - 帮助文本
	 * @param labelNames - 标签名
	 * @param buckets - 桶上界
	 * @param window - 滑动窗口配置
	 */
	constructor(
		public readonly name: string,
		public readonly help: string,
		public readonly labelNames: readonly string[],
		buckets: readonly number[],
		window: HistogramWindowOptions = DEFAULT_HISTOGRAM_WINDOW,
	) {
		this.buckets = [...buckets].sort((left, right) => left - right);
		this._window = window;
	}

	/**
	 * 记录一次观测；被丢弃的序列计入 dropped。
	 * @param value - 观测值
	 * @param labels - 标签集合
	 * @param nowMs - 当前单调时钟（毫秒）
	 */
	observe(value: number, labels?: MetricLabels, nowMs: number = performance.now()): void {
		if (!Number.isFinite(value) || value < 0) {
			return;
		}
		const series = this._seriesFor(labels);
		if (series === undefined) {
			this._dropped += 1;
			return;
		}
		series.observe(value, nowMs);
	}

	/**
	 * 已丢弃的观测次数（序列数超过上限）。
	 */
	get dropped(): number {
		return this._dropped;
	}

	/**
	 * 取窗口内快照。
	 * @param windowMs - 窗口长度
	 */
	windowSnapshot(windowMs: number = this._window.slotMs * this._window.slotCount): HistogramWindowSnapshot[] {
		const nowMs = performance.now();
		return Array.from(this._series.entries()).map(([key, series]) => {
			const merged = series.window(nowMs, windowMs);
			return {
				labels: parseSeriesKey(this.labelNames, key),
				count: merged.count,
				sum: merged.sum,
				cumulative: merged.cumulative,
			};
		});
	}

	/** 累计快照（含自启动以来的全部样本）。 */
	snapshot(): HistogramSeriesSnapshot[] {
		return Array.from(this._series.entries()).map(([key, series]) => ({
			labels: parseSeriesKey(this.labelNames, key),
			count: series.count,
			sum: series.sum,
			cumulative: series.cumulative,
		}));
	}

	/**
	 * 按序列取窗口分位值，供报表与告警使用。
	 * @param quantile - 分位点，0-1
	 * @param windowMs - 窗口长度
	 * @param predicate - 序列过滤
	 */
	quantile(
		quantile: number,
		windowMs?: number,
		predicate: (labels: MetricLabels) => boolean = () => true,
	): Quantile {
		const merged = { count: 0, sum: 0, cumulative: new Array<number>(this.buckets.length + 1).fill(0) };
		for (const snapshot of this.windowSnapshot(windowMs)) {
			if (!predicate(snapshot.labels)) {
				continue;
			}
			merged.count += snapshot.count;
			merged.sum += snapshot.sum;
			for (let index = 0; index < snapshot.cumulative.length; index += 1) {
				merged.cumulative[index] = (merged.cumulative[index] ?? 0) + (snapshot.cumulative[index] ?? 0);
			}
		}
		return quantileFromBuckets(this.buckets, merged.cumulative, merged.count, quantile);
	}

	/**
	 * 取某个序列的窗口分位值。
	 * @param labels - 目标序列标签
	 * @param quantile - 分位点
	 * @param windowMs - 窗口长度
	 */
	seriesQuantile(labels: MetricLabels, quantile: number, windowMs?: number): Quantile {
		const key = buildSeriesKey(this.labelNames, labels);
		const target = parseSeriesKey(this.labelNames, key);
		const snapshot = this.windowSnapshot(windowMs).find((item) => buildSeriesKey(this.labelNames, item.labels) === buildSeriesKey(this.labelNames, target));
		if (snapshot === undefined) {
			return undefined;
		}
		return quantileFromBuckets(this.buckets, snapshot.cumulative, snapshot.count, quantile);
	}

	/**
	 * 维护序列存在性；超过上限返回 undefined 并计入丢弃。
	 * @param labels - 标签集合
	 */
	private _seriesFor(labels: MetricLabels | undefined): HistogramSeries | undefined {
		const key = buildSeriesKey(this.labelNames, labels);
		const existing = this._series.get(key);
		if (existing !== undefined) {
			return existing;
		}
		if (this._series.size >= DEFAULT_MAX_SERIES) {
			return undefined;
		}
		const created = new HistogramSeries(this.buckets, this._window);
		this._series.set(key, created);
		return created;
	}
}

/**
 * 把「按桶精确计数」转换成「累计计数」，末位为 +Inf 溢出桶。
 *
 * 抓取与分位估算都要求累计值。内部按桶精确存放（便于合并窗口切片），
 * 只在出口转换一次，避免把精确计数误当累计值——那样分位数会整段退化到最高桶上界。
 * @param counts - 按桶精确计数（长度 = 桶数 + 1）
 */
export function toCumulativeCounts(counts: ArrayLike<number>): number[] {
	const cumulative: number[] = new Array<number>(counts.length).fill(0);
	let running = 0;
	for (let index = 0; index < counts.length; index += 1) {
		running += counts[index] ?? 0;
		cumulative[index] = running;
	}
	return cumulative;
}

/**
 * 从桶累计计数估算分位值，口径同 Prometheus histogram_quantile：
 * 落在目标桶后按桶区间线性插值，+Inf 桶取前一个上界。
 * @param buckets - 桶上界（升序）
 * @param cumulative - 各桶累计计数，末位为 +Inf
 * @param count - 样本总数
 * @param quantile - 分位点 0-1
 */
export function quantileFromBuckets(
	buckets: readonly number[],
	cumulative: readonly number[],
	count: number,
	quantile: number,
): Quantile {
	if (count <= 0) {
		return undefined;
	}
	const clamped = Math.min(1, Math.max(0, quantile));
	const target = clamped * count;
	let previousUpper = 0;
	let previousCount = 0;
	for (let index = 0; index < buckets.length; index += 1) {
		const upper = buckets[index];
		const observed = cumulative[index] ?? 0;
		if (upper === undefined) {
			break;
		}
		if (observed >= target) {
			const inBucket = observed - previousCount;
			if (inBucket <= 0) {
				return upper;
			}
			const ratio = (target - previousCount) / inBucket;
			return previousUpper + (upper - previousUpper) * ratio;
		}
		previousUpper = upper;
		previousCount = observed;
	}
	const overflow = cumulative[buckets.length] ?? 0;
	if (overflow > previousCount) {
		return previousUpper;
	}
	return previousUpper;
}

/** 指标注册表：统一遍历、抓取与序列上限告警。 */
export class MetricRegistry {
	private readonly _metrics: MetricLike[] = [];
	private readonly _scrapeHooks: Array<() => void> = [];

	/**
	 * 登记指标并返回自身，便于在同一处定义与导出。
	 * @param metric - 待登记指标
	 */
	register<T extends MetricLike>(metric: T): T {
		this._metrics.push(metric);
		return metric;
	}

	/**
	 * 注册抓取前回调：读取连接池、内存这类「当前值」型数据。
	 * @param hook - 回调
	 */
	onScrape(hook: () => void): void {
		this._scrapeHooks.push(hook);
	}

	/** 执行所有抓取前回调。 */
	runScrapeHooks(): void {
		for (const hook of this._scrapeHooks) {
			try {
				hook();
			} catch {
				// 抓取回调只影响观测自身，任何异常都不能让指标端点失败。
			}
		}
	}

	/** 全部指标。 */
	get metrics(): readonly MetricLike[] {
		return this._metrics;
	}
}
