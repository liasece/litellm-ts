import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

const CLIENT_ABORT_ERROR_TYPE = "AbortError";
const CLIENT_ABORT_ERROR_MESSAGE = "client aborted";

/**
 * Recognize the gateway's historical Responses disconnect error.
 * A bare AbortError can also be an upstream timeout and must remain a failure.
 * @param metadata - Persisted metadata; only JSON objects participate in SQL filtering.
 */
export function isLegacyClientAbort(metadata: unknown): boolean {
	if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
		return false;
	}
	const record = metadata as Record<string, unknown>;
	if (record["termination_reason"] !== undefined && record["termination_reason"] !== null) {
		return false;
	}
	const error = record["error_information"];
	if (error === null || typeof error !== "object" || Array.isArray(error)) {
		return false;
	}
	const information = error as Record<string, unknown>;
	return information["error_type"] === CLIENT_ABORT_ERROR_TYPE && information["error_message"] === CLIENT_ABORT_ERROR_MESSAGE;
}

/**
 * Use the same effective status for historical rows, filters and page counts.
 * @param status - Stored status column or metadata status expression.
 * @param metadata - JSONB metadata; object field lookups on scalar values return NULL.
 */
export function spendLogStatusSql(status: SQLWrapper, metadata: SQLWrapper): SQL<string | null> {
	return sql<string | null>`CASE
		WHEN ${status} = 'failure'
			AND (${metadata})->>'termination_reason' IS NULL
			AND (${metadata})->'error_information'->>'error_type' = ${CLIENT_ABORT_ERROR_TYPE}
			AND (${metadata})->'error_information'->>'error_message' = ${CLIENT_ABORT_ERROR_MESSAGE}
		THEN 'aborted'
		ELSE ${status}
	END`;
}
