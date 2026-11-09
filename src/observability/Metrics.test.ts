import { Counter, Gauge, Histogram, MetricRegistry, quantileFromBuckets } from "./Metrics";

describe("MetricRegistry 基座", () => {
	it("计数器区分标签序列，并按注入时钟统计窗口增量", () => {
		const counter = new Counter("t_total", "help", ["route"], { slotMs: 1_000, slotCount: 5 });
		counter.inc({ route: "/a" }, 1, 1_000);
		counter.inc({ route: "/a" }, 2, 1_000);
		counter.inc({ route: "/b" }, 1, 1_000);
		expect(counter.value({ route: "/a" })).toBe(3);
		expect(counter.value({ route: "/b" })).toBe(1);
		expect(counter.sumWhere()).toBe(4);
		// 同一个时间片内的增量都落在窗口里
		expect(counter.sumWhereInWindow(5_000, undefined, 2_000)).toBe(4);
		// 时钟推进到窗口之外后，旧增量不再计入
			expect(counter.sumWhereInWindow(5_000, undefined, 60_000)).toBe(0);
	});

	it("仪表覆盖写入，只保留最新值", () => {
		const gauge = new Gauge("g", "help", ["kind"]);
		gauge.set(3, { kind: "x" });
		gauge.set(7, { kind: "x" });
		expect(gauge.value({ kind: "x" })).toBe(7);
		expect(gauge.value({ kind: "missing" })).toBe(0);
	});

	it("直方图按桶上界归桶并给出分位数区间", () => {
		const histogram = new Histogram("h_seconds", "help", ["op"], [1, 2, 4]);
		for (let index = 0; index < 10; index += 1) {
			histogram.observe(1.5, { op: "SELECT" });
		}
		const p50 = histogram.quantile(0.5);
		expect(p50).toBeGreaterThanOrEqual(1);
		expect(p50).toBeLessThanOrEqual(2);
		expect(histogram.windowSnapshot()[0]?.count).toBe(10);
	});

	it("分位数按真实分布估算，不会退化到最高桶上界", () => {
		const histogram = new Histogram("h4_seconds", "help", [], [0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]);
		for (let index = 0; index < 90; index += 1) {
			histogram.observe(0.004);
		}
		for (let index = 0; index < 10; index += 1) {
			histogram.observe(0.3);
		}
		// 绝大多数样本在 4ms：中位数必须落在第一个桶内，而不是被最高桶上界带走
		expect(histogram.quantile(0.5)).toBeLessThanOrEqual(0.005);
		const p95 = histogram.quantile(0.95);
		expect(p95).toBeGreaterThan(0.1);
		expect(p95).toBeLessThanOrEqual(0.5);
		// 快照桶计数是累计值：末位等于样本总数
		const snapshot = histogram.windowSnapshot()[0];
		expect(snapshot?.cumulative[snapshot.cumulative.length - 1]).toBe(100);
	});

	it("非有限值与非负约束之外的观测被忽略，不会污染分位数", () => {
		const histogram = new Histogram("h2_seconds", "help", [], [1]);
		histogram.observe(Number.NaN);
		histogram.observe(-1);
		expect(histogram.windowSnapshot()[0]?.count ?? 0).toBe(0);
	});

	it("序列数达到上限后丢弃新序列并计数，防止标签爆炸", () => {
		const histogram = new Histogram("h3_seconds", "help", ["id"], [1]);
		for (let index = 0; index < 1_001; index += 1) {
			histogram.observe(0.5, { id: `series-${index}` });
		}
		expect(histogram.windowSnapshot().length).toBe(1_000);
		expect(histogram.dropped).toBe(1);
	});

	it("quantileFromBuckets 在空样本上返回 undefined，在单桶内按线性插值给值", () => {
		expect(quantileFromBuckets([1, 2], [0, 0, 0], 0, 0.5)).toBeUndefined();
		const value = quantileFromBuckets([1, 2], [0, 10, 10], 10, 0.5);
		expect(value).toBeGreaterThanOrEqual(1);
		expect(value).toBeLessThanOrEqual(2);
	});

	it("注册表按登记顺序暴露指标并执行抓取回调", () => {
		const registry = new MetricRegistry();
		const counter = registry.register(new Counter("a_total", "a"));
		registry.register(new Gauge("b", "b"));
		let hooked = false;
		registry.onScrape(() => {
			hooked = true;
			throw new Error("抓取回调异常不能影响指标端点");
		});
		registry.runScrapeHooks();
		expect(hooked).toBe(true);
		expect(registry.metrics.map((metric) => metric.name)).toEqual(["a_total", "b"]);
		expect(counter.labelNames).toEqual([]);
	});
});
