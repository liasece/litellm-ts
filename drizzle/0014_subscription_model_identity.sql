-- Remove gateway names from model deployments. Only deployments are rewritten; public
-- model groups, IDs, account files, price tables and historical spend logs have other owners.
LOCK TABLE "LiteLLM_ProxyModelTable" IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TEMPORARY VIEW litellm_subscription_identity_plan AS
WITH public_providers(slug) AS (
    VALUES ('codex-subscription'), ('commandcode'), ('opencode-go'), ('kimi-subscription'),
           ('claude-subscription'), ('antigravity-subscription'), ('xai-subscription')
), catalog(provider, models) AS (
    -- Unambiguously owned built-in IDs from SDK v8.0.57. The four retired GPT IDs
    -- were registered by Codex in v7.2.138; the image IDs are Codex image routes.
    VALUES
    ('codex-subscription', ARRAY[
        'codex-auto-review', 'gpt-5.3-codex-spark', 'gpt-5.4',
        'gpt-5.4-mini', 'gpt-5.5', 'gpt-5.6-luna',
        'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-6-astra',
        'gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol',
        'gpt-6.1-terra', 'gpt-image-1.5', 'gpt-image-2',
        'gpt-image-2.5'
    ]::text[]),
    ('kimi-subscription', ARRAY[
        'kimi-k2', 'kimi-k2-thinking', 'kimi-k2.5',
        'kimi-k2.6', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed',
        'kimi-k2.8', 'kimi-k2.8-code', 'kimi-k3',
        'kimi-k3-256k', 'kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed'
    ]::text[]),
    ('claude-subscription', ARRAY[
        'claude-3-5-haiku-20241022', 'claude-3-7-sonnet-20250219', 'claude-fable-5',
        'claude-fable-5-1', 'claude-haiku-4-5-20251001', 'claude-haiku-5-5',
        'claude-opus-4-1-20250805', 'claude-opus-4-20250514', 'claude-opus-4-5-20251101',
        'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8',
        'claude-opus-5', 'claude-opus-5-5', 'claude-sonnet-4-20250514',
        'claude-sonnet-4-5-20250929', 'claude-sonnet-5', 'claude-sonnet-5-5'
    ]::text[]),
    ('antigravity-subscription', ARRAY[
        'claude-opus-4-6-thinking', 'claude-opus-5-5-high', 'claude-sonnet-5-5-high',
        'gemini-3.8-flash-high', 'gemini-4-argon-high', 'gpt-oss-120b-medium'
    ]::text[]),
    ('xai-subscription', ARRAY[
        'grok-3-mini', 'grok-3-mini-fast', 'grok-4.20-0309-non-reasoning',
        'grok-4.20-0309-reasoning', 'grok-4.20-multi-agent-0309', 'grok-4.3',
        'grok-4.5', 'grok-4.6', 'grok-4.7',
        'grok-4.7-build-fast', 'grok-build-0.1', 'grok-composer-2.5-fast',
        'grok-imagine-image', 'grok-imagine-image-2.0', 'grok-imagine-image-quality',
        'grok-imagine-video', 'grok-imagine-video-1.5', 'grok-imagine-video-1.5-lite'
    ]::text[])
), deployments AS (
    SELECT model_id, lower(trim(litellm_params->>'custom_llm_provider')) AS explicit,
           regexp_replace(trim(litellm_params->>'model'), '^(cliproxy/)+', '', 'i') AS model
      FROM "LiteLLM_ProxyModelTable"
     WHERE lower(trim(litellm_params->>'custom_llm_provider')) IN (SELECT slug FROM public_providers)
        OR lower(trim(litellm_params->>'custom_llm_provider')) = 'cliproxy'
        OR lower(trim(litellm_params->>'model')) LIKE 'cliproxy/%'
        OR (coalesce(trim(litellm_params->>'custom_llm_provider'), '') = ''
            AND strpos(litellm_params->>'model', '/') > 0
            AND lower(split_part(trim(litellm_params->>'model'), '/', 1)) IN (SELECT slug FROM public_providers))
), resolved AS (
    SELECT model_id, model, CASE
        WHEN explicit IN (SELECT slug FROM public_providers) THEN explicit
        WHEN coalesce(explicit, '') NOT IN ('', 'cliproxy') THEN NULL
        WHEN strpos(model, '/') > 0 AND lower(split_part(model, '/', 1)) IN (SELECT slug FROM public_providers)
            THEN lower(split_part(model, '/', 1))
        ELSE (SELECT provider FROM catalog WHERE model = ANY(models))
    END AS provider
    FROM deployments
)
SELECT model_id, provider, regexp_replace(model, '^(' || provider || '/)+', '', 'i') AS upstream
FROM resolved;
--> statement-breakpoint
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM litellm_subscription_identity_plan
                WHERE provider IS NULL OR coalesce(upstream, '') = '' OR upstream ~* '^(cliproxy|codex-subscription|commandcode|opencode-go|kimi-subscription|claude-subscription|antigravity-subscription|xai-subscription)/') THEN
        RAISE EXCEPTION 'Subscription migration requires an explicit account provider and upstream model for unidentified deployments';
    END IF;
END $$;
--> statement-breakpoint
WITH normalized AS (
    SELECT target.model_id, (target.litellm_params - ARRAY['subscription_transport', 'api_base', 'api_key', 'credential_name', 'litellm_credential_name'])
        || jsonb_build_object('model', plan.upstream, 'custom_llm_provider', plan.provider)
        || CASE WHEN target.litellm_params ? 'litellm_model_name'
                THEN jsonb_build_object('litellm_model_name', plan.upstream) ELSE '{}'::jsonb END AS params,
    CASE WHEN jsonb_typeof(target.model_info) = 'object' THEN
        target.model_info || (
            SELECT coalesce(jsonb_object_agg(field, regexp_replace(target.model_info->>field, '^((cliproxy|' || plan.provider || ')/)+', '', 'i')), '{}'::jsonb)
            FROM unnest(ARRAY['key', 'base_model']) AS field
            WHERE (target.model_info->>field) ~* ('^((cliproxy|' || plan.provider || ')/)')
        ) || CASE WHEN lower(target.model_info->>'litellm_provider') = 'cliproxy'
                  THEN jsonb_build_object('litellm_provider', plan.provider) ELSE '{}'::jsonb END
        ELSE target.model_info END AS info
    FROM "LiteLLM_ProxyModelTable" AS target
    JOIN litellm_subscription_identity_plan AS plan ON target.model_id = plan.model_id
)
UPDATE "LiteLLM_ProxyModelTable" AS target
SET litellm_params = normalized.params, model_info = normalized.info
FROM normalized
WHERE target.model_id = normalized.model_id
  AND (target.litellm_params, target.model_info) IS DISTINCT FROM (normalized.params, normalized.info);
--> statement-breakpoint
UPDATE "LiteLLM_ProxyModelTable" SET litellm_params = litellm_params - 'subscription_transport'
WHERE litellm_params ? 'subscription_transport';
--> statement-breakpoint
-- Expand the old subscription-wide rate into explicit providers. Existing per-source
-- overrides (including zero) win. Other settings and historical charges are untouched.
WITH policies AS (
    SELECT field, param_value->field AS rates FROM "LiteLLM_Config"
    CROSS JOIN unnest(ARRAY['cost_discount_config', 'cost_margin_config']) AS field
    WHERE param_name = 'litellm_settings' AND jsonb_typeof(param_value->field) = 'object'
      AND (param_value->field) ? 'cliproxy'
), replacement AS (
    SELECT jsonb_object_agg(field, (
        SELECT jsonb_object_agg(source, rates->'cliproxy')
        FROM unnest(ARRAY['codex-subscription','commandcode','opencode-go','kimi-subscription','claude-subscription','antigravity-subscription','xai-subscription']) AS source
    ) || (rates - 'cliproxy')) AS settings FROM policies
)
UPDATE "LiteLLM_Config" SET param_value = param_value || replacement.settings
FROM replacement WHERE param_name = 'litellm_settings' AND replacement.settings IS NOT NULL;
--> statement-breakpoint
DROP VIEW litellm_subscription_identity_plan;
--> statement-breakpoint
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"LiteLLM_ProxyModelTable"'::regclass AND conname = 'subscription_model_identity') THEN
ALTER TABLE "LiteLLM_ProxyModelTable" ADD CONSTRAINT "subscription_model_identity" CHECK (
    lower(trim(litellm_params->>'custom_llm_provider')) IS DISTINCT FROM 'cliproxy'
    AND coalesce(trim(litellm_params->>'model'), '') !~* '^cliproxy/'
    AND NOT (litellm_params ? 'subscription_transport')
    AND (coalesce(trim(litellm_params->>'custom_llm_provider'), '') <> ''
         OR lower(trim(litellm_params->>'model')) !~ '^(codex-subscription|commandcode|opencode-go|kimi-subscription|claude-subscription|antigravity-subscription|xai-subscription)/')
    AND (lower(trim(litellm_params->>'custom_llm_provider')) NOT IN
             ('codex-subscription','commandcode','opencode-go','kimi-subscription','claude-subscription','antigravity-subscription','xai-subscription')
         OR (coalesce(trim(litellm_params->>'model'), '') <> ''
             AND lower(trim(litellm_params->>'model')) !~ '^(codex-subscription|commandcode|opencode-go|kimi-subscription|claude-subscription|antigravity-subscription|xai-subscription)/'))
);
END IF;
END $$;
