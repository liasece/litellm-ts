import { Counter, Gauge, Histogram, MetricRegistry } from "./Metrics";
import { escapeLabelValue, formatMetricValue, renderPrometheusText } from "./PrometheusExposition";

describe("Prometheus 文本输出", () => {
	it("转义标签值中的反斜杠、引号与换行", () => {
		expect(escapeLabelValue('a"b\\c\nd')).toBe('a\\"b\\\\c\\nd');
	});

	it("整数不带小数点，小数去掉尾随零，非有限值有明确表示", () => {
		expect(formatMetricValue(3)).toBe("3");
		expect(formatMetricValue(0.5)).toBe("0.5");
		expect(formatMetricValue(1.23456789)).toBe("1.234568");
		expect(formatMetricValue(Number.POSITIVE_INFINITY)).toBe("+Inf");
		expect(formatMetricValue(Number.NaN)).toBe("NaN");
	});

	it("输出 HELP/TYPE 与带标签样本，直方图包含 le、+Inf、sum 与 count", () => {
		const registry = new MetricRegistry();
		const counter = registry.register(new Counter("litellm_demo_total", "演示计数", ["route"]));
		const gauge = registry.register(new Gauge("litellm_demo_gauge", "演示仪表", []));
		const histogram = registry.register(new Histogram("litellm_demo_seconds", "演示直方图", ["op"], [1, 2]));
		counter.inc({ route: "/v1/models" });
		gauge.set(42);
		histogram.observe(0.5, { op: "SELECT" });
		histogram.observe(1.5, { op: "SELECT" });

		const text = renderPrometheusText(registry);
		expect(text).toContain("# TYPE litellm_demo_total counter");
		expect(text).toContain('litellm_demo_total{route="/v1/models"} 1');
		expect(text).toContain("# TYPE litellm_demo_gauge gauge");
		expect(text).toContain("litellm_demo_gauge 42");
		expect(text).toContain('litellm_demo_seconds_bucket{op="SELECT",le="1"} 1');
		expect(text).toContain('litellm_demo_seconds_bucket{op="SELECT",le="2"} 2');
		expect(text).toContain('litellm_demo_seconds_bucket{op="SELECT",le="+Inf"} 2');
		expect(text).toContain('litellm_demo_seconds_sum{op="SELECT"} 2');
		expect(text).toContain('litellm_demo_seconds_count{op="SELECT"} 2');
		expect(text.trimEnd().endsWith("# EOF")).toBe(true);
	});

	it("抓取前先刷新抓取回调，保证连接池这类当前值指标是最新的", () => {
		const registry = new MetricRegistry();
		const gauge = registry.register(new Gauge("litellm_pool", "连接池", ["state"]));
		registry.onScrape(() => gauge.set(7, { state: "total" }));
		expect(renderPrometheusText(registry)).toContain('litellm_pool{state="total"} 7');
	});
});
