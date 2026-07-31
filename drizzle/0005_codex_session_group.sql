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
					THEN btrim(metadata ->> 'session_group_key')
				ELSE NULL
			END AS canonical_session_group_key,
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
		WHEN canonical_session_group_key ~* '^s:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
			THEN canonical_session_group_key
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
WITH codex_session AS (
	SELECT
		request_id,
		COALESCE(
			CASE
				WHEN btrim(proxy_server_request #>> '{body,client_metadata,thread_id}')
					~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
					THEN btrim(proxy_server_request #>> '{body,client_metadata,thread_id}')
			END,
			CASE
				WHEN btrim(proxy_server_request #>> '{body,client_metadata,session_id}')
					~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
					THEN btrim(proxy_server_request #>> '{body,client_metadata,session_id}')
			END,
			CASE
				WHEN btrim(proxy_server_request #>> '{body,prompt_cache_key}')
					~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
					THEN btrim(proxy_server_request #>> '{body,prompt_cache_key}')
			END
		) AS codex_session_id
	FROM "LiteLLM_SpendLogs"
	WHERE
		jsonb_typeof(metadata) = 'object'
		AND jsonb_typeof(proxy_server_request) = 'object'
		AND (
			custom_llm_provider = 'cliproxy'
			OR model LIKE 'cliproxy/%'
		)
)
UPDATE "LiteLLM_SpendLogs" AS spend_log
SET metadata = jsonb_set(
	spend_log.metadata,
	'{session_group_key}',
	to_jsonb('s:' || codex_session.codex_session_id),
	true
)
FROM codex_session
WHERE
	spend_log.request_id = codex_session.request_id
	AND codex_session.codex_session_id IS NOT NULL
	AND spend_log.metadata ->> 'session_group_key'
		IS DISTINCT FROM 's:' || codex_session.codex_session_id;
--> statement-breakpoint
ANALYZE "LiteLLM_SpendLogs";
