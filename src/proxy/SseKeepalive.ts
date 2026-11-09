import { hostedProvider } from "../subscriptions/SubscriptionProviders";
import type { Request, Response, RequestHandler } from "express";
import { dbConfigProvider } from "../core/config/DbConfigProvider";
import type { Router } from "../router/Router";
import type { Deployment } from "../types/router";

/**
 * @param params
 * @param req
 * @param globalValue
 * @param fallback
 */
export function resolveKeepaliveSeconds(
	params: Record<string, unknown>,
	req: Pick<Request, "body" | "get">,
	globalValue: unknown,
	fallback = 0,
): number {
	const operator = params["keepalive_seconds"];
	if (operator !== undefined && Number(operator) <= 0) {
		return 0;
	}
	const override =
		params["allow_client_keepalive_override"] === true
			? (req.get("x-litellm-keepalive-seconds") ?? req.body?.keepalive_seconds)
			: undefined;
	const raw = override ?? operator ?? globalValue ?? fallback;
	if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && !raw.trim())) {
		return 0;
	}
	const value = Number(raw);
	return Number.isFinite(value) && value > 0 ? Math.max(1, Math.min(300, value)) : 0;
}

/**
 * Heartbeats are transport frames; they never enter usage, accounting or stream accumulators.
 * @param req
 * @param res
 * @param deployment
 * @param protocol
 * @param fallbackSeconds
 */
export async function startSseKeepalive(
	req: Request,
	res: Response,
	deployment?: Deployment,
	protocol: "openai" | "anthropic" = "openai",
	fallbackSeconds = 0,
): Promise<() => void> {
	const previous = res.locals["litellmSseHeartbeatStop"] as (() => void) | undefined;
	previous?.();
	const settings = await dbConfigProvider.getEffectiveParam("litellm_settings");
	const interval = resolveKeepaliveSeconds(
		deployment?.litellm_params ?? {},
		req,
		settings["sse_keepalive_ping_interval_seconds"],
		fallbackSeconds,
	);
	if (!interval) {
		return () => undefined;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stopped = false;
	const stop = (): void => {
		stopped = true;
		if (timer) {
			clearTimeout(timer);
		}
		res.off("close", stop);
		res.off("finish", stop);
		req.off("aborted", stop);
		if (res.locals["litellmSseHeartbeatStop"] === stop) {
			delete res.locals["litellmSseHeartbeatStop"];
		}
	};
	const tick = (): void => {
		if (stopped || res.writableEnded || res.destroyed) {
			stop();
			return;
		}
		try {
			if (!res.headersSent) {
				res.setHeader("Content-Type", "text/event-stream");
				res.setHeader("Cache-Control", "no-cache");
				res.setHeader("X-Accel-Buffering", "no");
			}
			res.write(protocol === "anthropic" ? 'event: ping\ndata: {"type":"ping"}\n\n' : ": keepalive\n\n");
		} catch {
			stop();
			return;
		}
		timer = setTimeout(tick, interval * 1000);
		timer.unref();
	};
	res.locals["litellmSseHeartbeatStop"] = stop;
	res.once("close", stop);
	res.once("finish", stop);
	req.once("aborted", stop);
	timer = setTimeout(tick, interval * 1000);
	timer.unref();
	return stop;
}

/**
 * Before the serving deployment is known, only a unanimous policy can grant a client override.
 * @param router
 * @param model
 * @param modelId
 */
export function getKeepaliveDeployment(router: Router, model: string, modelId?: string): Deployment | undefined {
	if (modelId) {
		return router.getDeployment?.(modelId) ?? undefined;
	}
	const ids = router.getDeploymentIdsForModel?.(model) ?? [];
	const deployments = ids.map((id) => router.getDeployment?.(id)).filter((dep): dep is Deployment => !!dep);
	const first = deployments[0];
	if (!first) {
		return undefined;
	}
	if (
		deployments.some(
			(dep) => dep.litellm_params["keepalive_seconds"] !== undefined && Number(dep.litellm_params["keepalive_seconds"]) <= 0,
		)
	) {
		return { ...first, litellm_params: { ...first.litellm_params, keepalive_seconds: 0 } };
	}
	const policies = new Set(
		deployments.map((dep) =>
			JSON.stringify([dep.litellm_params["keepalive_seconds"], dep.litellm_params["allow_client_keepalive_override"] === true]),
		),
	);
	return policies.size === 1 ? first : undefined;
}

/**
 * Start after authentication/runtime configuration, before provider connection and built-in tool work.
 * @param router
 */
export function sseKeepaliveMiddleware(router: Router): RequestHandler {
	const paths = new Set([
		"/v1/chat/completions",
		"/chat/completions",
		"/cursor/chat/completions",
		"/v1/messages",
		"/v1/responses",
		"/responses",
	]);
	return async (req, res, next) => {
		try {
			if (
				req.method === "POST" &&
				paths.has(req.path) &&
				req.body?.stream === true &&
				typeof req.body.model === "string" &&
				router.hasModel(req.body.model)
			) {
				const deployment = getKeepaliveDeployment(router, req.body.model);
				if (
					(!deployment || !hostedProvider(deployment.litellm_params))
				) {
					await startSseKeepalive(
						req,
						res,
						deployment,
						req.path === "/v1/messages" ? "anthropic" : "openai",
						req.path.includes("responses") ? 0 : 2,
					);
				}
			}
			next();
		} catch (error) {
			next(error);
		}
	};
}
