import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import type { ApiError } from "./ApiError";

function isAnthropicProtocolRequest(req: Request): boolean {
	if (req.path === "/v1/messages" || req.path.startsWith("/v1/messages/")) {
		return true;
	}
	return req.path.startsWith("/v1/files") && typeof req.headers["anthropic-version"] === "string";
}

function ensureAnthropicRequestId(res: Response): string {
	const existing = res.getHeader("request-id");
	if (typeof existing === "string" && existing.length > 0) {
		return existing;
	}
	const requestId = `req_${randomUUID().replaceAll("-", "")}`;
	res.setHeader("request-id", requestId);
	return requestId;
}

/** Add protocol-mandated response headers before a route begins writing its body. */
export function prepareProtocolResponse(req: Request, res: Response): void {
	if (isAnthropicProtocolRequest(req)) {
		ensureAnthropicRequestId(res);
	}
}

function anthropicErrorType(statusCode: number): string {
	switch (statusCode) {
		case 401:
			return "authentication_error";
		case 402:
			return "billing_error";
		case 403:
			return "permission_error";
		case 404:
			return "not_found_error";
		case 409:
			return "conflict_error";
		case 413:
			return "request_too_large";
		case 429:
			return "rate_limit_error";
		case 504:
			return "timeout_error";
		case 529:
			return "overloaded_error";
		default:
			return statusCode >= 500 ? "api_error" : "invalid_request_error";
	}
}

/** Serialize an API error using the wire protocol selected by the request route/headers. */
export function sendProtocolError(req: Request, res: Response, error: ApiError): void {
	if (!isAnthropicProtocolRequest(req)) {
		res.status(error.statusCode).json(error.toErrorBody());
		return;
	}

	const requestId = ensureAnthropicRequestId(res);
	res.status(error.statusCode).json({
		type: "error",
		error: {
			type: anthropicErrorType(error.statusCode),
			message: error.message,
		},
		request_id: requestId,
	});
}
