import type { Request, RequestHandler } from "express";
import type { Router } from "../router/Router";

const CLAUDE_ROUTER_PREFIX = "claude-router-";
const EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/**
 * @param req
 */
export function isClaudeCodeClient(req?: Request): boolean {
	return req?.get?.("x-gateway-client") === "claude-code" || /claude-code|claude-cli/i.test(req?.get?.("user-agent") ?? "");
}

/**
 * @param model
 */
export function claudeCodeModelId(model: string): string {
	return /^claude(?:-|$)/i.test(model) ? model : CLAUDE_ROUTER_PREFIX + Buffer.from(model).toString("hex");
}

/**
 * @param body
 * @param router
 * @param cursor
 */
export function resolveCodingClientModel(
	body: Record<string, unknown>,
	router: Pick<Router, "hasModel">,
	cursor = false,
): Record<string, unknown> {
	const model = body["model"];
	if (typeof model !== "string" || router.hasModel(model)) {
		return body;
	}
	let decoded = model;
	if (decoded.endsWith("[1m]")) {
		decoded = decoded.slice(0, -4);
	}
	if (decoded.startsWith(CLAUDE_ROUTER_PREFIX)) {
		const hex = decoded.slice(CLAUDE_ROUTER_PREFIX.length);
		if (!/^(?:[0-9a-f]{2})+$/.test(hex)) {
			return body;
		}
		const candidate = Buffer.from(hex, "hex").toString("utf8");
		if (Buffer.from(candidate).toString("hex") !== hex) {
			return body;
		}
		decoded = candidate;
	}
	if (decoded !== model && router.hasModel(decoded)) {
		return { ...body, model: decoded };
	}
	if (!cursor) {
		return body;
	}
	const variant = model.replace(/-fast$/, "");
	const match = /^(.*)-thinking-([a-z]+)$/.exec(variant);
	const effort = match && EFFORTS.has(match[2]!) ? match[2] : undefined;
	const base = effort ? match![1]! : variant;
	if (base === model || !router.hasModel(base)) {
		return body;
	}
	const resolved = { ...body, model: base };
	if (!effort) {
		return resolved;
	}
	if ("messages" in body && !("input" in body)) {
		return { ...resolved, reasoning_effort: body["reasoning_effort"] ?? effort };
	}
	const reasoning =
		typeof body["reasoning"] === "object" && body["reasoning"] !== null ? (body["reasoning"] as Record<string, unknown>) : {};
	return { ...resolved, reasoning: { ...reasoning, effort: reasoning["effort"] ?? effort } };
}

/**
 * @param router
 */
export function codingClientModelMiddleware(router: Pick<Router, "hasModel">): RequestHandler {
	return (req, _res, next) => {
		if (req.body && typeof req.body === "object") {
			if (
				/codex/i.test(req.get("user-agent") ?? "") &&
				req.method === "POST" &&
				/(?:completions|responses|messages)$/.test(req.path)
			) {
				req.body = { ...req.body, drop_params: req.body.drop_params ?? true };
			}
			req.body = resolveCodingClientModel(req.body, router, req.path === "/cursor/chat/completions");
		}
		next();
	};
}
