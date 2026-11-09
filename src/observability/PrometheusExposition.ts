/**
 * Prometheus 文本格式输出。
 *
 * 只实现抓取需要的最小子集：counter / gauge / histogram 的 HELP、TYPE、样本行与
 * +Inf 桶。不引入 prom-client 依赖，避免为了一个文本格式把运行时依赖做大。
 */

import { Counter, Gauge, Histogram } from "./Metrics";
import type { MetricLabels, MetricRegistry } from "./Metrics";

/**
 * 转义标签值：反斜杠、双引号与换行必须转义，否则抓取端解析失败。
 * @param value - 原始值
 */
export function escapeLabelValue(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

/**
 * 格式化数值：整数不带小数点，小数最多保留 6 位且去掉尾随零。
 * @param value - 数值
 */
export function formatMetricValue(value: number): string {
	if (!Number.isFinite(value)) {
		return value > 0 ? "+Inf" : "NaN";
	}
	if (Number.isInteger(value)) {
		return String(value);
	}
	return String(Number(value.toFixed(6)));
}

/**
 * 拼接标签串；空值标签直接省略，保持输出紧凑。
 * @param labels - 标签集合
 */
function renderLabels(labels: MetricLabels): string {
	const parts: string[] = [];
	for (const [name, value] of Object.entries(labels)) {
		if (value.length === 0) {
			continue;
		}
		parts.push(`${name}="${escapeLabelValue(value)}"`);
	}
	return parts.length === 0 ? "" : `{${parts.join(",")}}`;
}

/**
 * 在已有标签串上追加 le 或其它键。
 * @param labels - 已有标签串（形如 `{a="b"}` 或空串）
 * @param extra - 追加的键值
 */
function renderLabelsWith(labels: MetricLabels, extra: ReadonlyArray<readonly [string, string]>): string {
	const merged: Record<string, string> = { ...labels };
	for (const [key, value] of extra) {
		merged[key] = value;
	}
	return renderLabels(merged);
}

/**
 * 渲染整个注册表。
 * @param registry - 指标注册表
 */
export function renderPrometheusText(registry: MetricRegistry): string {
	registry.runScrapeHooks();
	const lines: string[] = [];
	for (const metric of registry.metrics) {
		if (metric instanceof Counter) {
			lines.push(`# HELP ${metric.name} ${metric.help}`);
			lines.push(`# TYPE ${metric.name} counter`);
			for (const item of metric.snapshot()) {
				lines.push(`${metric.name}${renderLabels(item.labels)} ${formatMetricValue(item.value)}`);
			}
			continue;
		}
		if (metric instanceof Gauge) {
			lines.push(`# HELP ${metric.name} ${metric.help}`);
			lines.push(`# TYPE ${metric.name} gauge`);
			for (const item of metric.snapshot()) {
				lines.push(`${metric.name}${renderLabels(item.labels)} ${formatMetricValue(item.value)}`);
			}
			continue;
		}
		if (metric instanceof Histogram) {
			lines.push(`# HELP ${metric.name} ${metric.help}`);
			lines.push(`# TYPE ${metric.name} histogram`);
			for (const item of metric.snapshot()) {
				for (let index = 0; index < metric.buckets.length; index += 1) {
					const upper = metric.buckets[index];
					if (upper === undefined) {
						continue;
					}
					lines.push(
						`${metric.name}_bucket${renderLabelsWith(item.labels, [["le", formatMetricValue(upper)]])} ${formatMetricValue(item.cumulative[index] ?? 0)}`,
					);
				}
				lines.push(
					`${metric.name}_bucket${renderLabelsWith(item.labels, [["le", "+Inf"]])} ${formatMetricValue(item.count)}`,
				);
				lines.push(`${metric.name}_sum${renderLabels(item.labels)} ${formatMetricValue(item.sum)}`);
				lines.push(`${metric.name}_count${renderLabels(item.labels)} ${formatMetricValue(item.count)}`);
			}
		}
	}
	lines.push("# EOF");
	return `${lines.join("\n")}\n`;
}
