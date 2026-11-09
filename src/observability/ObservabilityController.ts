/**
 * 观测端点：Prometheus 抓取、JSON 概览与慢请求明细。
 *
 * 三个端点都挂在需要认证的路由组上：模型名、流量与耗时分布属于运营数据，
 * 不因为「只是指标」就对外公开。Prometheus 抓取用 master key 或任一有效虚拟密钥。
 */

import type { NextFunction, Request, RequestHandler, Response, Router } from "express";
import { httpMetricsMiddleware, isObservabilityEnabled } from "./HttpMetrics";
import { droppedSeries, metricsRegistry } from "./MetricCatalog";
import { buildObservabilitySummary, DEFAULT_REPORT_WINDOW_SECONDS } from "./ObservabilityReport";
import { renderPrometheusText } from "./PrometheusExposition";
import { recentSlowRequests } from "./SlowRequestLog";
import { Histogram } from "./Metrics";

/** Prometheus 文本格式的 Content-Type。 */
const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/** 已安装抓取前钩子的标记，避免重复登记。 */
let scrapeHookInstalled = false;

/** 在抓取前把各指标的序列丢弃数汇总成一个值。 */
function installDropCounterHook(): void {
	if (scrapeHookInstalled) {
		return;
	}
	scrapeHookInstalled = true;
	metricsRegistry.onScrape(() => {
		let dropped = 0;
		for (const metric of metricsRegistry.metrics) {
			if (metric instanceof Histogram) {
				dropped += metric.dropped;
			}
		}
		droppedSeries.set(dropped);
	});
}

/**
 * 解析窗口参数：缺省 5 分钟，限制在 15 秒到 1 小时之间。
 * @param raw - 查询参数
 */
function parseWindowSeconds(raw: unknown): number {
	const value = typeof raw === "string" ? Number(raw) : Number.NaN;
	if (!Number.isFinite(value) || value <= 0) {
		return DEFAULT_REPORT_WINDOW_SECONDS;
	}
	return Math.max(15, Math.min(3_600, value));
}

/**
 * 观测端点处理器集合。
 */
export class ObservabilityController {
	/**
	 * Prometheus 文本抓取。
	 * @param _req - Express 请求
	 * @param res - Express 响应
	 */
	prometheus(_req: Request, res: Response): void {
		if (!isObservabilityEnabled()) {
			res.status(404).json({ error: { message: "Observability is disabled", type: "not_found" } });
			return;
		}
		installDropCounterHook();
		const body = renderPrometheusText(metricsRegistry);
		res.status(200).type(PROMETHEUS_CONTENT_TYPE).send(body);
	}

	/**
	 * JSON 概览：分阶段耗时、模型维度、数据库与进程状态。
	 * @param req - Express 请求
	 * @param res - Express 响应
	 */
	summary(req: Request, res: Response): void {
		if (!isObservabilityEnabled()) {
			res.status(404).json({ error: { message: "Observability is disabled", type: "not_found" } });
			return;
		}
		installDropCounterHook();
		const windowSeconds = parseWindowSeconds(req.query["window"]);
		res.status(200).json(buildObservabilitySummary(windowSeconds));
	}

	/**
	 * 最近慢请求与失败请求明细。
	 * @param req - Express 请求
	 * @param res - Express 响应
	 */
	slowRequests(req: Request, res: Response): void {
		if (!isObservabilityEnabled()) {
			res.status(404).json({ error: { message: "Observability is disabled", type: "not_found" } });
			return;
		}
		const raw = req.query["limit"];
		const limit = typeof raw === "string" && Number.isFinite(Number(raw)) ? Math.max(1, Math.min(40, Number(raw))) : 20;
		res.status(200).json({ requests: recentSlowRequests(limit) });
	}
}

/**
 * 注册观测端点。
 * @param router - 目标 Router
 * @param requireAuth - 认证中间件
 */
export function registerObservabilityRoutes(router: Router, requireAuth: RequestHandler): void {
	const controller = new ObservabilityController();
	const guard = (handler: (req: Request, res: Response, next: NextFunction) => void): RequestHandler => {
		return (req, res, next) => {
			try {
				handler(req, res, next);
			} catch (error) {
				next(error);
			}
		};
	};
	router.get("/metrics", requireAuth, guard((req, res) => controller.prometheus(req, res)));
	router.get("/metrics/summary", requireAuth, guard((req, res) => controller.summary(req, res)));
	router.get("/metrics/slow", requireAuth, guard((req, res) => controller.slowRequests(req, res)));
}

/**
 * 显式引用中间件，保证导入顺序稳定（供集成测试直接使用同一实例）。
 */
export const observabilityMiddleware = httpMetricsMiddleware;
