CREATE OR REPLACE FUNCTION litellm_resolved_model_group(
	metadata jsonb,
	original_model_group text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
	explicit_group text;
	fallback_depth integer := 0;
	fallback_count integer := 0;
	chain_entry jsonb;
	resolved_group text;
BEGIN
	IF jsonb_typeof(metadata) = 'object' THEN
		explicit_group := NULLIF(btrim(metadata ->> 'resolved_model_group'), '');
		IF explicit_group IS NOT NULL THEN
			RETURN explicit_group;
		END IF;

		IF COALESCE(metadata ->> 'attempted_retries', '') ~ '^[0-9]+$' THEN
			fallback_depth := (metadata ->> 'attempted_retries')::integer;
		END IF;
		IF jsonb_typeof(metadata -> 'fallback_models') = 'array' THEN
			fallback_count := jsonb_array_length(metadata -> 'fallback_models');
			IF metadata ->> 'attempted_retries' IS NULL THEN
				fallback_depth := GREATEST(fallback_count - 1, 0);
			END IF;
		END IF;

		IF jsonb_typeof(metadata -> 'model_resolution_chain') = 'array' THEN
			FOR chain_entry IN
				SELECT value
				FROM jsonb_array_elements(metadata -> 'model_resolution_chain')
			LOOP
				IF COALESCE(chain_entry ->> 'fallback_index', '') ~ '^[0-9]+$'
					AND (chain_entry ->> 'fallback_index')::integer = fallback_depth
				THEN
					resolved_group := NULLIF(btrim(chain_entry ->> 'resolved_model'), '');
					IF resolved_group IS NOT NULL THEN
						RETURN resolved_group;
					END IF;
				END IF;
			END LOOP;
		END IF;

		IF fallback_count > 0 THEN
			resolved_group := NULLIF(
				btrim(
					metadata -> 'fallback_models' ->> LEAST(fallback_depth, fallback_count - 1)
				),
				''
			);
			IF resolved_group IS NOT NULL THEN
				RETURN resolved_group;
			END IF;
		END IF;
	END IF;

	RETURN NULLIF(btrim(original_model_group), '');
END
$$;
--> statement-breakpoint
DROP INDEX IF EXISTS "daily_user_spend_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "LiteLLM_DailyUserSpend_user_id_date_api_key_model_custom_ll_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_user_spend_unique" ON "LiteLLM_DailyUserSpend" (
	"user_id",
	"date",
	"api_key",
	"model",
	"model_group",
	"custom_llm_provider",
	"mcp_namespaced_tool_name",
	"endpoint"
);
--> statement-breakpoint
DROP INDEX IF EXISTS "daily_team_spend_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "LiteLLM_DailyTeamSpend_team_id_date_api_key_model_custom_ll_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_team_spend_unique" ON "LiteLLM_DailyTeamSpend" (
	"team_id",
	"date",
	"api_key",
	"model",
	"model_group",
	"custom_llm_provider",
	"mcp_namespaced_tool_name",
	"endpoint"
);
--> statement-breakpoint
DROP INDEX IF EXISTS "daily_organization_spend_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "LiteLLM_DailyOrganizationSpend_organization_id_date_api_key_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_organization_spend_unique" ON "LiteLLM_DailyOrganizationSpend" (
	"organization_id",
	"date",
	"api_key",
	"model",
	"model_group",
	"custom_llm_provider",
	"mcp_namespaced_tool_name",
	"endpoint"
);
--> statement-breakpoint
DROP INDEX IF EXISTS "daily_tag_spend_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "LiteLLM_DailyTagSpend_tag_date_api_key_model_custom_llm_pro_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_tag_spend_unique" ON "LiteLLM_DailyTagSpend" (
	"tag",
	"date",
	"api_key",
	"model",
	"model_group",
	"custom_llm_provider",
	"mcp_namespaced_tool_name",
	"endpoint"
);
--> statement-breakpoint
DROP INDEX IF EXISTS "daily_agent_spend_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "LiteLLM_DailyAgentSpend_agent_id_date_api_key_model_custom__key";
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_agent_spend_unique" ON "LiteLLM_DailyAgentSpend" (
	"agent_id",
	"date",
	"api_key",
	"model",
	"model_group",
	"custom_llm_provider",
	"mcp_namespaced_tool_name",
	"endpoint"
);
--> statement-breakpoint
DROP INDEX IF EXISTS "daily_end_user_spend_unique";
--> statement-breakpoint
DROP INDEX IF EXISTS "LiteLLM_DailyEndUserSpend_end_user_id_date_api_key_model_cu_key";
--> statement-breakpoint
CREATE UNIQUE INDEX "daily_end_user_spend_unique" ON "LiteLLM_DailyEndUserSpend" (
	"end_user_id",
	"date",
	"api_key",
	"model",
	"model_group",
	"custom_llm_provider",
	"mcp_namespaced_tool_name",
	"endpoint"
);
--> statement-breakpoint
CREATE TEMP TABLE litellm_daily_user_model_group_source ON COMMIT DROP AS
SELECT
	"user" AS user_id,
	to_char("startTime", 'YYYY-MM-DD') AS date,
	api_key,
	model,
	COALESCE(model_group, '') AS original_model_group,
	COALESCE(litellm_resolved_model_group(metadata, model_group), model_group, '') AS resolved_model_group,
	COALESCE(custom_llm_provider, '') AS custom_llm_provider,
	COALESCE(mcp_namespaced_tool_name, '') AS mcp_namespaced_tool_name,
	COALESCE(split_part(proxy_server_request ->> 'url', '?', 1), '') AS endpoint,
	prompt_tokens::bigint AS prompt_tokens,
	completion_tokens::bigint AS completion_tokens,
	CASE
		WHEN COALESCE(metadata #>> '{usage_object,cache_read_input_tokens}', '') ~ '^[0-9]+$'
			THEN (metadata #>> '{usage_object,cache_read_input_tokens}')::bigint
		ELSE 0
	END AS cache_read_input_tokens,
	CASE
		WHEN COALESCE(metadata #>> '{usage_object,cache_creation_input_tokens}', '') ~ '^[0-9]+$'
			THEN (metadata #>> '{usage_object,cache_creation_input_tokens}')::bigint
		ELSE 0
	END AS cache_creation_input_tokens,
	spend,
	CASE WHEN COALESCE(status, 'success') = 'success' THEN 1::bigint ELSE 0::bigint END AS successful_requests,
	CASE WHEN COALESCE(status, 'success') = 'success' THEN 0::bigint ELSE 1::bigint END AS failed_requests
FROM "LiteLLM_SpendLogs"
WHERE NULLIF("user", '') IS NOT NULL;
--> statement-breakpoint
CREATE INDEX litellm_daily_user_model_group_source_key
ON litellm_daily_user_model_group_source (
	user_id,
	date,
	api_key,
	model,
	custom_llm_provider,
	mcp_namespaced_tool_name,
	endpoint
);
--> statement-breakpoint
CREATE TEMP TABLE litellm_affected_daily_user_keys ON COMMIT DROP AS
SELECT DISTINCT
	user_id,
	date,
	api_key,
	model,
	custom_llm_provider,
	mcp_namespaced_tool_name,
	endpoint
FROM litellm_daily_user_model_group_source
WHERE original_model_group IS DISTINCT FROM resolved_model_group;
--> statement-breakpoint
CREATE TEMP TABLE litellm_safe_daily_user_keys ON COMMIT DROP AS
WITH raw_totals AS (
	SELECT
		source.user_id,
		source.date,
		source.api_key,
		source.model,
		source.custom_llm_provider,
		source.mcp_namespaced_tool_name,
		source.endpoint,
		count(*)::bigint AS api_requests,
		sum(source.prompt_tokens)::bigint AS prompt_tokens,
		sum(source.completion_tokens)::bigint AS completion_tokens,
		sum(source.spend) AS spend
	FROM litellm_daily_user_model_group_source AS source
	INNER JOIN litellm_affected_daily_user_keys AS affected
		USING (user_id, date, api_key, model, custom_llm_provider, mcp_namespaced_tool_name, endpoint)
	GROUP BY 1, 2, 3, 4, 5, 6, 7
),
daily_totals AS (
	SELECT
		daily.user_id,
		daily.date,
		daily.api_key,
		COALESCE(daily.model, '') AS model,
		COALESCE(daily.custom_llm_provider, '') AS custom_llm_provider,
		COALESCE(daily.mcp_namespaced_tool_name, '') AS mcp_namespaced_tool_name,
		COALESCE(daily.endpoint, '') AS endpoint,
		sum(daily.api_requests)::bigint AS api_requests,
		sum(daily.prompt_tokens)::bigint AS prompt_tokens,
		sum(daily.completion_tokens)::bigint AS completion_tokens,
		sum(daily.spend) AS spend
	FROM "LiteLLM_DailyUserSpend" AS daily
	INNER JOIN litellm_affected_daily_user_keys AS affected
		ON affected.user_id = daily.user_id
		AND affected.date = daily.date
		AND affected.api_key = daily.api_key
		AND affected.model = COALESCE(daily.model, '')
		AND affected.custom_llm_provider = COALESCE(daily.custom_llm_provider, '')
		AND affected.mcp_namespaced_tool_name = COALESCE(daily.mcp_namespaced_tool_name, '')
		AND affected.endpoint = COALESCE(daily.endpoint, '')
	GROUP BY 1, 2, 3, 4, 5, 6, 7
)
SELECT raw_totals.*
FROM raw_totals
INNER JOIN daily_totals
	USING (user_id, date, api_key, model, custom_llm_provider, mcp_namespaced_tool_name, endpoint)
WHERE raw_totals.api_requests = daily_totals.api_requests
	AND raw_totals.prompt_tokens = daily_totals.prompt_tokens
	AND raw_totals.completion_tokens = daily_totals.completion_tokens
	AND abs(raw_totals.spend - daily_totals.spend) < 0.000000001;
--> statement-breakpoint
DELETE FROM "LiteLLM_DailyUserSpend" AS daily
USING litellm_safe_daily_user_keys AS safe
WHERE safe.user_id = daily.user_id
	AND safe.date = daily.date
	AND safe.api_key = daily.api_key
	AND safe.model = COALESCE(daily.model, '')
	AND safe.custom_llm_provider = COALESCE(daily.custom_llm_provider, '')
	AND safe.mcp_namespaced_tool_name = COALESCE(daily.mcp_namespaced_tool_name, '')
	AND safe.endpoint = COALESCE(daily.endpoint, '');
--> statement-breakpoint
INSERT INTO "LiteLLM_DailyUserSpend" (
	id,
	user_id,
	date,
	api_key,
	model,
	model_group,
	custom_llm_provider,
	mcp_namespaced_tool_name,
	endpoint,
	prompt_tokens,
	completion_tokens,
	cache_read_input_tokens,
	cache_creation_input_tokens,
	spend,
	api_requests,
	successful_requests,
	failed_requests,
	created_at,
	updated_at
)
SELECT
	gen_random_uuid()::text,
	source.user_id,
	source.date,
	source.api_key,
	source.model,
	source.resolved_model_group,
	source.custom_llm_provider,
	source.mcp_namespaced_tool_name,
	source.endpoint,
	sum(source.prompt_tokens)::bigint,
	sum(source.completion_tokens)::bigint,
	sum(source.cache_read_input_tokens)::bigint,
	sum(source.cache_creation_input_tokens)::bigint,
	sum(source.spend),
	count(*)::bigint,
	sum(source.successful_requests)::bigint,
	sum(source.failed_requests)::bigint,
	now(),
	now()
FROM litellm_daily_user_model_group_source AS source
INNER JOIN litellm_safe_daily_user_keys AS safe
	USING (user_id, date, api_key, model, custom_llm_provider, mcp_namespaced_tool_name, endpoint)
GROUP BY 2, 3, 4, 5, 6, 7, 8, 9;
--> statement-breakpoint
ANALYZE "LiteLLM_DailyUserSpend";
