import { ApiError } from "../core/api/ApiError";
import type { UserAPIKeyAuth } from "../types/auth";
import { hashApiKey } from "../core/utils/crypto";

/**
 * @param query
 * @param now
 * @throws {Error} Rejects invalid input or a denied operation.
 */
export function usageDateRange(
	query: Record<string, unknown>,
	now = new Date(),
): {
	/**
	 *
	 */
	start: Date;
	/**
	 *
	 */
	end: Date;
	/**
	 *
	 */
	startDay: string;
	/**
	 *
	 */
	endDay: string;
} {
	const endDay = typeof query["end_date"] === "string" ? query["end_date"] : now.toISOString().slice(0, 10);
	const defaultStart = new Date(now);
	defaultStart.setUTCDate(defaultStart.getUTCDate() - 29);
	const startDay = typeof query["start_date"] === "string" ? query["start_date"] : defaultStart.toISOString().slice(0, 10);
	const parse = (day: string): Date => {
		const value = new Date(`${day}T00:00:00.000Z`);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== day) {
			throw ApiError.badRequest("Dates must be valid YYYY-MM-DD values");
		}
		return value;
	};
	const start = parse(startDay);
	const end = parse(endDay);
	if (end < start || end.getTime() - start.getTime() >= 366 * 86400000) {
		throw ApiError.badRequest("Usage date range must be ordered and at most 366 days");
	}
	end.setUTCDate(end.getUTCDate() + 1);
	return { start: start, end: end, startDay: startDay, endDay: endDay };
}

/**
 * @param auth
 */
export function isUsageAdmin(auth: UserAPIKeyAuth): boolean {
	return auth.user_role === "proxy_admin" || auth.user_role === "proxy_admin_viewer";
}

/**
 * @param auth
 * @param scope
 * @param requested
 * @throws {Error} Rejects invalid input or a denied operation.
 */
export function resolveUsageScope(
	auth: UserAPIKeyAuth | undefined,
	scope: "key" | "user" | "team" | "organization",
	requested?: string,
): string | undefined {
	if (!auth) {
		throw ApiError.unauthorized("Authentication required");
	}
	const value =
		scope === "key"
			? (auth.token ?? hashApiKey(auth.api_key))
			: scope === "user"
				? auth.user_id
				: scope === "team"
					? auth.team_id
					: auth.organization_id;
	const normalized = scope === "key" && requested?.startsWith("sk-") ? hashApiKey(requested) : requested;
	if (isUsageAdmin(auth)) {
		return normalized;
	}
	if (scope === "organization" && auth.user_role !== "org_admin") {
		throw ApiError.forbidden("Organization reports require organization admin access");
	}
	if (!value || (normalized !== undefined && normalized !== value)) {
		throw ApiError.forbidden("Requested usage scope is not accessible");
	}
	return value;
}
