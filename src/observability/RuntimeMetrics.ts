/**
 * Node 进程自身的运行指标采集。
 *
 * 为什么必须单独采集事件循环延迟：这个网关是单进程、单事件循环的 SSE 转发器，
 * 「接口变慢」在生产上经常不是上游慢，而是事件循环被 JSON 序列化、正则、
 * 同步日志或 GC 暂停占住。只看请求耗时会把它误判成上游问题。
 *
 * 采集成本控制：事件循环直方图跟随 Node 内建 monitorEventLoopDelay，采样间隔 20ms；
 * 内存/CPU/句柄每 10 秒一次；GC 通过 PerformanceObserver 被动接收，不轮询。
 */

import { monitorEventLoopDelay } from "node:perf_hooks";
import type { IntervalHistogram } from "node:perf_hooks";
import { PerformanceObserver } from "node:perf_hooks";
import type { PerformanceEntry } from "node:perf_hooks";
import { createModuleLogger } from "../core/utils/logger";
import {
	eventLoopDelay,
	eventLoopDelayMax,
	gcCollections,
	gcDuration,
	processActiveResources,
	processCpuSeconds,
	processMemory,
	processStartTime,
	processUptime,
} from "./MetricCatalog";
import type { Histogram } from "./Metrics";

const logger = createModuleLogger("Observability:Runtime");

/** 事件循环延迟采样间隔（毫秒）：20ms 足以捕捉 50ms 级停顿，开销可忽略。 */
const EVENT_LOOP_RESOLUTION_MS = 20;

/** 事件循环分位数读取周期（毫秒）。 */
const EVENT_LOOP_READ_INTERVAL_MS = 1_000;

/** 资源指标采样周期（毫秒）。 */
const RESOURCE_SAMPLE_INTERVAL_MS = 10_000;

/** 事件循环延迟观测上限（秒）：超过部分仍计入 +Inf 桶。 */
const EVENT_LOOP_SPIKE_THRESHOLD_SECONDS = 0.2;

/** GC 条目 kind 到名称的映射（V8 GC callback flags）。 */
const GC_KIND_NAMES: Readonly<Record<number, string>> = {
	1: "scavenge",
	2: "mark_sweep_compact",
	4: "incremental_marking",
	8: "process_weak_callbacks",
	15: "all",
	16: "minor",
};

/** 进程运行指标采集器。 */
export class RuntimeMetricsSampler {
	private _eventLoopHistogram: IntervalHistogram | null = null;
	private _eventLoopTimer: NodeJS.Timeout | null = null;
	private _resourceTimer: NodeJS.Timeout | null = null;
	private _gcObserver: PerformanceObserver | null = null;
	private _previousCpu: { readonly user: number; readonly system: number } | null = null;
	private _maxSpikeSeconds = 0;
	private _started = false;

	/** 启动采集；重复调用无副作用。 */
	start(): void {
		if (this._started) {
			return;
		}
		this._started = true;
		processStartTime.set(Math.round((Date.now() - process.uptime() * 1000) / 1000));
		this._eventLoopHistogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
		this._eventLoopHistogram.enable();
		this._safeSetInterval(() => this._sampleEventLoop(), EVENT_LOOP_READ_INTERVAL_MS);
		this._safeSetInterval(() => this._sampleResources(), RESOURCE_SAMPLE_INTERVAL_MS);
		this._sampleResources();
		this._observeGc();
		logger.debug("运行指标采集已启动", { resolutionMs: EVENT_LOOP_RESOLUTION_MS });
	}

	/** 停止采集并释放句柄；用于优雅退出与测试。 */
	stop(): void {
		if (!this._started) {
			return;
		}
		this._started = false;
		if (this._eventLoopTimer !== null) {
			clearInterval(this._eventLoopTimer);
			this._eventLoopTimer = null;
		}
		if (this._resourceTimer !== null) {
			clearInterval(this._resourceTimer);
			this._resourceTimer = null;
		}
		this._eventLoopHistogram?.disable();
		this._eventLoopHistogram = null;
		this._gcObserver?.disconnect();
		this._gcObserver = null;
	}

	/** 读取自启动以来观测到的最大事件循环停顿（秒）。 */
	get maxSpikeSeconds(): number {
		return this._maxSpikeSeconds;
	}

	/**
	 * 注册不阻止进程退出的周期定时器。
	 * @param callback - 周期任务
	 * @param intervalMs - 周期长度
	 */
	private _safeSetInterval(callback: () => void, intervalMs: number): void {
		const timer = setInterval(() => {
			try {
				callback();
			} catch (error) {
				logger.warn("运行指标采样失败", { error: error });
			}
		}, intervalMs);
		timer.unref();
		if (intervalMs === EVENT_LOOP_READ_INTERVAL_MS) {
			this._eventLoopTimer = timer;
		} else {
			this._resourceTimer = timer;
		}
	}

	/** 读取最近一个区间的事件循环延迟分位数并重置直方图。 */
	private _sampleEventLoop(): void {
		const histogram = this._eventLoopHistogram;
		if (histogram === null) {
			return;
		}
		const nanosToSeconds = 1e-9;
		const p50 = histogram.percentile(50) * nanosToSeconds;
		const p95 = histogram.percentile(95) * nanosToSeconds;
		const p99 = histogram.percentile(99) * nanosToSeconds;
		const max = histogram.max * nanosToSeconds;
		eventLoopDelay.set(round3(p50), { quantile: "0.5" });
		eventLoopDelay.set(round3(p95), { quantile: "0.95" });
		eventLoopDelay.set(round3(p99), { quantile: "0.99" });
		if (Number.isFinite(max) && max > this._maxSpikeSeconds) {
			this._maxSpikeSeconds = max;
			eventLoopDelayMax.set(round3(max));
		} else {
			eventLoopDelayMax.set(round3(this._maxSpikeSeconds));
		}
		if (max >= EVENT_LOOP_SPIKE_THRESHOLD_SECONDS) {
			logger.warn("事件循环出现停顿", { maxMs: Math.round(max * 1000), p99Ms: Math.round(p99 * 1000) });
		}
		histogram.reset();
	}

	/** 采样内存、CPU、句柄与运行时长。 */
	private _sampleResources(): void {
		const memory = process.memoryUsage();
		processMemory.set(memory.rss, { kind: "rss" });
		processMemory.set(memory.heapUsed, { kind: "heap_used" });
		processMemory.set(memory.heapTotal, { kind: "heap_total" });
		processMemory.set(memory.external, { kind: "external" });
		processMemory.set(memory.arrayBuffers, { kind: "array_buffers" });
		processUptime.set(round3(process.uptime()));
		const usage = process.cpuUsage();
		const previous = this._previousCpu;
		if (previous !== null) {
			processCpuSeconds.inc({ mode: "user" }, Math.max(0, usage.user - previous.user) / 1_000_000);
			processCpuSeconds.inc({ mode: "system" }, Math.max(0, usage.system - previous.system) / 1_000_000);
		} else {
			processCpuSeconds.inc({ mode: "user" }, usage.user / 1_000_000);
			processCpuSeconds.inc({ mode: "system" }, usage.system / 1_000_000);
		}
		this._previousCpu = { user: usage.user, system: usage.system };
		const resources = process.getActiveResourcesInfo();
		const counts = new Map<string, number>();
		for (const type of resources) {
			counts.set(type, (counts.get(type) ?? 0) + 1);
		}
		for (const [kind, count] of counts) {
			processActiveResources.set(count, { kind: kind });
		}
	}

	/** 订阅 GC 事件，记录暂停时长与次数。 */
	private _observeGc(): void {
		try {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					const gcEntry = entry as PerformanceEntry & { kind?: number; detail?: { kind?: number } };
					const kindCode = gcEntry.detail?.kind ?? gcEntry.kind ?? 0;
					const kind = GC_KIND_NAMES[kindCode] ?? `other_${kindCode}`;
					const durationSeconds = entry.duration / 1000;
					(gcDuration as Histogram).observe(durationSeconds);
					gcCollections.inc({ kind: kind });
				}
			});
			observer.observe({ entryTypes: ["gc"] });
			this._gcObserver = observer;
		} catch (error) {
			logger.warn("GC 观测不可用", { error: error });
		}
	}
}

/**
 * 保留三位小数，秒级指标在这个精度下足够表达毫秒。
 * @param value - 原始数值
 */
function round3(value: number): number {
	return Math.round(value * 1000) / 1000;
}

/** 进程级采集器单例；由服务启动时开启，关闭时停止。 */
export const runtimeMetricsSampler = new RuntimeMetricsSampler();
