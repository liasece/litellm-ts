-- 显式维护入口，不由应用启动调用。仅在已授权写入目标数据库时使用。
-- psql -v after_request_id='' -v batch_size=100 -f scripts/backfill-session-group-ids.sql
-- 每次仅按主键读取一批；下一批使用返回的 next_request_id，scanned_rows=0 时结束。
-- 每批最多 1000 行，失败只回滚当前批；同一批可以重复执行。
-- 仅修复请求级分组，保留已有稳定分组及无法解析的请求。
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
WITH batch AS MATERIALIZED (
	SELECT request_id, session_id, session_group_key, metadata, proxy_server_request
	FROM "LiteLLM_SpendLogs"
	WHERE request_id > :'after_request_id'
	ORDER BY request_id
	LIMIT GREATEST(1, LEAST(:batch_size, 1000))
), resolved AS MATERIALIZED (
	SELECT request_id, lower(COALESCE(
			(regexp_match(btrim(proxy_server_request #>> '{body,client_metadata,thread_id}'),
				'^(?:[a-z][a-z0-9]{0,31}[-_])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i'))[1],
			(regexp_match(btrim(proxy_server_request #>> '{body,client_metadata,session_id}'),
				'^(?:[a-z][a-z0-9]{0,31}[-_])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i'))[1],
			(regexp_match(btrim(proxy_server_request #>> '{headers,session_id}'),
				'^(?:[a-z][a-z0-9]{0,31}[-_])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i'))[1],
			(regexp_match(btrim(proxy_server_request #>> '{headers,session-id}'),
				'^(?:[a-z][a-z0-9]{0,31}[-_])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i'))[1],
			(regexp_match(btrim(proxy_server_request #>> '{body,prompt_cache_key}'),
				'^(?:[a-z][a-z0-9]{0,31}[-_])?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$', 'i'))[1]
		)) AS session_uuid
	FROM batch
	WHERE
		session_group_key = 's:' || lower(btrim(session_id))
		AND (metadata IS NULL OR jsonb_typeof(metadata) IN ('object', 'null'))
		AND jsonb_typeof(proxy_server_request) = 'object'
), updated AS (
	UPDATE "LiteLLM_SpendLogs" AS spend_log
	SET metadata = jsonb_set(
		COALESCE(NULLIF(spend_log.metadata, 'null'::jsonb), '{}'::jsonb),
		'{session_group_key}',
		to_jsonb('s:' || resolved.session_uuid),
		true
	)
	FROM resolved
	WHERE spend_log.request_id = resolved.request_id
		AND resolved.session_uuid IS NOT NULL
		AND spend_log.metadata ->> 'session_group_key'
			IS DISTINCT FROM 's:' || resolved.session_uuid
	RETURNING spend_log.request_id
)
SELECT
	(SELECT max(request_id) FROM batch) AS next_request_id,
	(SELECT count(*) FROM batch) AS scanned_rows,
	(SELECT count(*) FROM updated) AS updated_rows;
COMMIT;
