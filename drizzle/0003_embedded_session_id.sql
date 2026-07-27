CREATE OR REPLACE FUNCTION litellm_session_group_key(
	metadata jsonb,
	session_id text,
	request_id text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
	WITH candidate AS (
		SELECT
			CASE
				WHEN jsonb_typeof(metadata) = 'object'
					THEN btrim(metadata #>> '{spend_logs_metadata,user_id}')
				WHEN jsonb_typeof(metadata) = 'string'
					THEN (
						regexp_match(
							metadata #>> '{}',
							'"spend_logs_metadata"[[:space:]]*:[[:space:]]*\{[^{}]*"user_id"[[:space:]]*:[[:space:]]*"[[:space:]]*(user_[A-Za-z0-9_-]+_account_[A-Za-z0-9_-]*_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[[:space:]]*"',
							'i'
						)
					)[1]
				ELSE NULL
			END AS claude_code_user_id,
			CASE
				WHEN jsonb_typeof(metadata) = 'object'
					THEN (
						regexp_match(
							metadata #>> '{spend_logs_metadata,user_id}',
							'"session_id"[[:space:]]*:[[:space:]]*"[[:space:]]*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})[[:space:]]*"',
							'i'
						)
					)[1]
				ELSE NULL
			END AS embedded_session_id
	)
	SELECT CASE
		WHEN claude_code_user_id ~* '^user_[A-Za-z0-9_-]+_account_[A-Za-z0-9_-]*_session_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN 'c:' || claude_code_user_id
		WHEN embedded_session_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN 's:' || embedded_session_id
		WHEN NULLIF(btrim(session_id), '') IS NOT NULL
			THEN 's:' || btrim(session_id)
		ELSE 'r:' || request_id
	END
	FROM candidate
$$;
--> statement-breakpoint
UPDATE "LiteLLM_SpendLogs"
SET "session_id" = "session_id"
WHERE "session_group_key" IS DISTINCT FROM
	litellm_session_group_key(metadata, "session_id", request_id);
--> statement-breakpoint
ANALYZE "LiteLLM_SpendLogs";
