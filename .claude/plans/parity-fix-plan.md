# litellm-ts 与 Python 版功能对齐计划

基准：Python litellm（/root/var/src/github/litellm），线上 192.168.1.220:4000。
修复基准：TS 本地 127.0.0.1:18184（CONFIG_PATH=/root/var/tools/service/ai-out-service/LiteLLM/litellm_ts_config.yaml，DB=litellm_ts）。
对比脚本：/tmp/deep_compare.py、/tmp/compare_endpoints.sh。

## 批次 1：/v1/messages 端点重构（P0）

文件：src/proxy/AnthropicMessagesEndpoint.ts

- body.model 替换：转发上游前把 body.model 从客户端 model_name 替换为 deployment.litellm_params.model 剥离 provider 前缀（参照 AnthropicProvider.\_stripProviderPrefix）
- 接入 fallback：失败时按 Router fallback 链重试下一 deployment。实现方式：新增 helper，循环调用 litellmRouter.getAvailableDeployment + fallbackHandler.getNextFallback（参照 RouterExecution.executeWithFallback 的 fallback 派发逻辑 src/router/RouterExecution.ts:448-452），非流式与流式共用；仅对 5xx/429/连接错误 fallback，4xx 请求构造错误不 fallback（对齐 PY router.py async_function_with_fallbacks 行为：400 InvalidRequest 不触发 fallback，但 401/403/408/409/413/422/429/5xx 触发——参照 litellm/router.py 中 \_should_retry 逻辑；GLM 1211 是 400，PY 也 fallback，实际 PY 对 anthropic_messages 路由的 fallback 由 Router 统一处理，所有 provider 异常均可 fallback。采取：除 400 明确请求语法错误外均 fallback，与 Python 实测行为一致——Python 对 GLM 400 也 fallback 了）
- 冷却副作用：fallback 成功后原 deployment 计入冷却（复用 Router 现有冷却逻辑，不另造）
- 非流式响应 model 字段改写回原请求 model 名（Python 实测行为）
- count_tokens / files / batches 转发端点同样替换 model
- 测试：glm-4-7-anthropic（GLM 套餐已到期，直连必失败）请求 /v1/messages 应 fallback 到 deepseek-coder-anthropic 成功返回，响应 model == "glm-4-7-anthropic"；流式同理

## 批次 2：错误格式标准化（P0）

文件：src/middleware/ErrorHandler.ts、src/core/api/ApiError.ts、src/core/api/registerRoute.ts

- 全局错误响应改为 {error:{message,type,param,code}}（Python/FastAPI 风格），HTTP 状态码对齐语义（无可用部署=429，对齐 Python 实测）
- 移除 {success:false,message} 包装（检查所有 registerRoute 返回值与 ApiError 序列化）
- 保留 Python 错误 message 文本风格："No deployments available for selected model, Try again in {cooldown} seconds. Passed model={model}. ..."（参照实测）
- 测试：embeddings 无部署模型返回 429 + 标准 error 对象

## 批次 3：管理端点结构对齐（P0）

文件：src/management/KeyManagementEndpoint.ts、src/management/InternalUserEndpoint.ts、src/management/CustomerEndpoint.ts

- /key/generate 返回 Python 完整字段集（参照实测响应 50+ 字段：key_alias/duration/models/spend/max_budget/user_id/team_id/agent_id/max_parallel_requests/metadata/tpm_limit/rpm_limit/budget_duration/allowed_cache_controls/config/permissions/model_max_budget/model_rpm_limit/model_tpm_limit/guardrails/policies/prompts/blocked/aliases/object_permission/key/budget_id/tags/enforced_params/allowed_routes/allowed_passthrough_routes/allowed_vector_store_indexes/rpm_limit_type/tpm_limit_type/router_settings/access_group_ids/key_name/expires/token_id/organization_id/project_id/litellm_budget_table/token/created_by/updated_by/created_at/updated_at）
- /user/new：user*id 缺省时自动生成（Python: user*<uuid> 或 email 前缀，参照 litellm/proxy/management_endpoints/internal_user_endpoints.py）
- /customer/list：返回裸数组、字段 snake_case（对齐 Python 实测）
- /user/list：补 key_count、model_spend、model_max_budget、object_permission、organization_memberships 字段
- 测试：对 TS 18184 实测各端点，与 Python 响应结构 diff 为空（数据值除外）

## 批次 4：只读端点修复（P1）

文件：src/proxy/HealthEndpoint.ts、src/proxy/UtilEndpoints.ts、src/proxy/WebUiSupportEndpoints.ts、src/proxy/AnalyticsEndpoints.ts、src/spend/\*

- /health：返回 {healthy_endpoints, unhealthy_endpoints, healthy_count, unhealthy_count}（无模型检查时也返回该结构，参照 Python health_endpoints.py）
- /budget/settings：实现 GET（缺 budget_id 时 422，对齐 Python）
- /active/callbacks：实现 GET，返回当前 callbacks 清单
- /get/config/callbacks、/model/cost_map/source：master key 可访问（修权限判断）
- /config/list、/health/services：缺必填参数返回 422（对齐 Python FastAPI 校验语义与响应体 {detail:[{loc,msg,type}]}）
- /public/providers/fields：返回 provider 凭证字段清单（数据参照 Python litellm/proxy/common_utils/provider_config.py 或实测响应）
- /public/litellm_model_cost_map：打包 Python 的 model_prices_and_context_window.json（/root/var/src/github/litellm/model_prices_and_context_window.json）进 dist，端点返回全量
- 测试：/tmp/deep_compare.py 对应端点结构 diff 为空

## 批次 5：model info 字段补齐（P1）

文件：src/proxy/ModelsPageSupportEndpoints.ts、src/proxy/modelGroupBuilder.ts、src/proxy/ModelsEndpoint.ts

- /v2/model/info：model_info 补齐 Python 全字段（缺省 null），litellm_params 补 merge_reasoning_content_in_choices/use_in_pass_through/use_litellm_proxy
- /model*group/info：补 supports*_(reasoning/vision/url*context/function_calling/parallel_function_calling/web_search)、input_cost_per_token/output_cost_per_token、mode、max_input_tokens/max_output_tokens、tpm/rpm、is_public_model_group、health*_ 字段；supports\_\* 从 cost map 数据推导（对齐 Python 逻辑）
- 测试：deep_compare 结构 diff 为空

## 批次 6：spend 端点结构对齐（P1）

文件：src/spend/spendLogsEndpoints.ts、src/spend/globalSpendEndpoints.ts、src/spend/globalSpendAggregationEndpoints.ts

- /spend/tags：返回 [{individual_request_tag, log_count, total_spend}]（Python 实测）
- /global/spend/logs：只返回有数据日期 [{date, spend}]，不零填充整月
- 测试：结构 diff 为空

## 批次 7：响应细节（P2）

文件：src/providers/OpenAICompatProvider.ts（或响应构造处）、src/providers/AnthropicProvider.ts

- chat.completion id 加 chatcmpl- 前缀（非流式与流式 chunk 一致）
- message.provider_specific_fields（thinking_blocks/citations）补齐
- 测试：对比实测响应结构

## 批次 8：回归验证 + 部署

- make all（lint/typecheck/test/check-circular/check-drizzle-journal/check-format）全绿
- 全量重跑 /tmp/compare_endpoints.sh 与 /tmp/deep_compare.py，推理端点实测（chat/messages/embeddings 流式非流式）
- 管理端点生命周期实测（key generate/info/update/delete、user new/info、team、customer）
- 重新部署 litellm-ts 容器（/root/var/tools/service/ai-out-service 部署脚本，遵守 memory：litellm 禁止热更新，须重建镜像）后冒烟验证

## 不做（范围划定，经评估非功能差异或 enterprise 特性）

- key 字符串格式（sk-hex vs sk-base64url）：服务端生成的不透明随机串，客户端无依赖
- usage.completion_tokens_details.reasoning_tokens 数值口径：上游 provider 返回直透，PY text_tokens=-1 为 Python 侧已知怪异行为
- Python 524 路由中的 enterprise/pass-through 面（SCIM、CloudZero、Guardrails、HashiCorp Vault、pass_through_endpoint、a2a、MCP server 管理等）：TS 已有 stub 面，不在本次全量对齐范围
