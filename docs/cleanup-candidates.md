# 无用功能清理候选清单

> 调查日期 2026-11-08。范围：后端 `src/` + 本仓库 Dashboard `ui/litellm-dashboard/src/`。
> 本文只做调查与排序，**没有删除或修改任何代码**。每一项都需要你确认后才会动手。

## 一、判定方法

| 维度 | 做法 |
| --- | --- |
| 后端路由 | 扫描 `registerRoute(...)`、装饰器控制器（`@get/@post/...`）、`router.use`，共 **363 条**注册路由（359 条直扫 + 4 条 `for` 循环注册的 `/v1/chat/completions` 系列）。 |
| 前端调用 | 扫描 Dashboard 全部 `/xxx` 字面量与 `requestJson` 调用点，与后端路由做逐段匹配；被判「无调用」的再逐条子串复核。 |
| 页面可达性 | `PageRegistry.ts`（42 个页面）+ `NavigationData.ts`（24 个导航项）+ `src/shared/WebUiPaths.ts`（URL 别名），并展开 `import.meta.glob`。 |
| 生产流量 | 只读查询生产库 `LiteLLM_SpendLogs`：最近 30 天 `call_type` 仅 5 种 —— `amessages` 103312、`aresponses` 64592、`acompletion` 9464、`asearch` 1040、`aimage_generation` 433。2026-07 至今**从未出现** `embedding / completion / speech / transcription / moderation / rerank`。 |
| 生产数据 | 逐张统计候选表行数（见第七节）。 |

边界说明：`SpendLogs` 只记录产生费用的模型调用，`GET /v1/models`、健康检查、管理面接口不会有记录，这些按代码与前端引用判断，不按流量判断。

## 二、总览

| 类别 | 规模 | 风险 | 建议 |
| --- | --- | --- | --- |
| A 功能完全不存在 | 77 条占位路由 / 22 个文件（其中 74 条恒 503） | 低 | 整文件删除 |
| B 空壳与「假成功」 | 60+ 条路由 | 中 | 连同页面一起删（比 503 更危险：看起来成功） |
| C 页面上「能点但必然失败」 | 16 个页面 | 中 | 按页面整体决策 |
| D 有实现但无任何调用方 | 21 条路由 | 中高 | 需你确认是否有外部脚本/SDK |
| E 无读写的数据库表 | 31 张 | 低（涉及迁移） | 单独一批处理 |
| F 不可达代码模块 | 34 个 | 低 | 直接删 |
| G 不可达页面 | 4 个 | 低 | 直接删 |
| H 配置/构建产物 | 4 项 | 低 | 单独确认 |

## 三、A 类：功能完全不存在（handler 恒返回 503）

这些模块只有路由注册与占位实现（`notImpl()` 抛 503，或直接返回常量），没有任何业务逻辑。

| 模块文件 | 路由数 | 路由 | 前端引用 |
| --- | --- | --- | --- |
| `src/proxy/AssistantsEndpoints.ts` | 8 | `/v1/assistants`、`/v1/assistants/:id`、`/v1/threads`、`/v1/threads/:id`、`/v1/threads/:id/messages`、`/v1/threads/:id/runs` | 无 |
| `src/proxy/FilesEndpoints.ts` | 5 | `/v1/files`、`/v1/files/:id`、`/v1/files/:id/content` | 无 |
| `src/proxy/BatchesEndpoints.ts` | 4 | `/v1/batches`、`/v1/batches/:id`、`/v1/batches/:id/cancel` | 无 |
| `src/proxy/FineTuningEndpoints.ts` | 4 | `/v1/fine_tuning/jobs`、`/:id`、`/:id/cancel` | 无 |
| `src/proxy/SCIMEndpoints.ts` | 4 | `/scim/v2/Users`、`/scim/v2/Groups` | 无 |
| `src/proxy/AnthropicSkillsEndpoints.ts` | 4 | `/anthropic/skills`、`/anthropic/skills/:id` | 无 |
| `src/proxy/OCRVideoContainerEndpoints.ts` | 4 | `/v1/ocr`、`/v1/video`、`/v1/video/retrieve`、`/v1/containers` | Playground 有容器文件入口 |
| `src/proxy/AgentEndpoints.ts` | 6 | `/v1/agents`（增删改查 5 条）、`/v1/agent/chat/completions` | **有**（AI Hub / Playground Agent 构建器） |
| `src/proxy/PolicyEndpoints.ts` | 3 | `/policy/new`、`/policy/update`（另 `/policy/list` 恒空） | **有**（Policies 页） |
| `src/proxy/ToolEndpoints.ts` | 2 | `/tool/new`、`/tool/delete` | 无 |
| `src/proxy/IpAllowlistEndpoints.ts` | 3 | `/get/allowed_ips`、`/add/allowed_ip`、`/delete/allowed_ip` | 无 |
| `src/proxy/GoogleEndpoints.ts` | 2 | `/vertex-ai/models/:id:predict`、`/google-ai-studio/models/:id:predict` | 无 |
| `src/proxy/RealtimeEndpoints.ts` | 2 | `/v1/realtime/sessions`、`/v1/realtime/transcriptions` | **有**（Playground） |
| `src/proxy/SSOEndpoints.ts` | 4 | `/sso/callback`、`/sso/key/generate`（503）、`/get/sso_settings`、`/update/sso_settings`（恒成功） | **有** |
| `src/proxy/ConfigOverridesEndpoints.ts` | 4 | `/config_overrides/hashicorp_vault`（GET/POST/PUT）、`/test_connection` | 无 |
| `src/proxy/ClaudeCodeMarketplaceEndpoints.ts` | 3 | `/claude-code/marketplace`（GET/POST）、`/claude-code/marketplace/:id` | **有** |
| `src/proxy/ComplianceEndpoints.ts` | 1 | `/compliance/check` | **有**（Playground 合规检查） |
| `src/proxy/RerankEndpoints.ts` | 1 | `/v1/rerank` | 无 |
| `src/proxy/UtilEndpoints.ts` | 1 | `/utils/token_counter` | 无 |
| `src/proxy/AnalyticsEndpoints.ts` | 1 | `/global/activity/cache_hits` | **有**（Caching 页） |
| `src/proxy/PromptEndpoints.ts` | 5 | `/prompts`、`/prompts/:id` | **有**（Prompts 页） |
| `src/proxy/VectorStoreEndpoints.ts` | 6 | `/v1/vector_stores`（GET/POST）、`/v1/vector_stores/:id`（POST/DELETE）、`/v1/vector_stores/:id/files`（GET/POST） | **有**（Vector Stores 页；页面还调用 `/vector_store/info`、`/vector_store/new`、`/vector_store/delete`，这三条后端根本不存在） |

**特别说明（F1）**：`FilesEndpoints.ts` 的 5 条 503 路由**永远不会被命中**——`proxyRouter` 里 `registerAnthropicMessagesRoutes` 先注册了真实可用的 `/v1/files*`（`src/proxy/AnthropicMessagesEndpoint.ts`），Express 先匹配先生效。这 5 条是纯粹的无效代码，删掉不会有任何行为变化。

**特别说明（F2）**：`AgentEndpoints.ts` 的 `/v1/agents` 在 `main.ts` 里被更早注册的 `WebUiSupportEndpoints` 的空数组实现**遮蔽**，实际返回 `[]` 而不是 503。两处都是假的，但删的时候要一起删才不会改变现状。

## 四、B 类：空壳与「假成功」（比 503 更危险）

### B1 假装写入成功（不落库、不报错）

| 端点 | 实际行为 | 影响页面 |
| --- | --- | --- |
| `POST /v1/mcp/server` | 把请求体原样回显（仅打码凭据），**不写库** | MCP Servers |
| `PUT /v1/mcp/server` | 同上 | MCP Servers |
| `DELETE /v1/mcp/server/:id` | 恒返回 `{deleted:true}` | MCP Servers |
| `POST /v1/mcp/server/register` | 回显 + `approval_status: "pending_review"` | MCP Servers |
| `POST /v1/mcp/server/:id/oauth-user-credential` | 回显 `has_user_credential: true` | MCP Servers / Playground |
| `DELETE /v1/mcp/server/:id/oauth-user-credential` | 恒 `{deleted:true}` | 同上 |
| `POST /v1/mcp/server/test/tools/list` | 恒「Found 0 tools」 | MCP Servers |
| `PATCH /update/internal_user_settings` | 恒 `{success:true}` | 用户设置 |
| `PATCH /update/sso_settings` | 恒 `{status:"ok"}` | SSO 设置 |
| `/cloudzero/*`（settings/init/export、spend-integration vantage & cloudzero） | 恒返回固定 JSON | Logging & Alerts |
| `/email/event_settings`（GET/PATCH/POST reset） | 恒 `{settings: []}` | Logging & Alerts |
| `/alerting/settings` | 恒 `[]` | Logging & Alerts |

整份 `src/proxy/MCPEndpoints.ts`（21 条路由）几乎没有一条是真的：列表恒空、写入回显、健康恒空、submission 恒零。这是目前**最容易被误认为「功能正常」**的一块。

### B2 恒返回空列表的兼容面

`src/proxy/WebUiSupportEndpoints.ts` 第 1620–1750 行集中了一批「为了前端不报错」的空实现：

`/project/list`、`/tag/list`、`/access_groups/list`、`/v1/access_group`、`/budget/list`、`/in_product_nudges`、`/callbacks/configs`、`/guardrails/list`、`/v2/guardrails/list`、`/policies/list`、`/policy/templates`、`/policies/attachments/list`、`/guardrails/submissions`、`/guardrails/usage/overview`、`/guardrails/ui/add_guardrail_settings`、`/guardrails/ui/provider_specific_params`、`/v1/agents`、`/prompts/list`、`/vector_store/list`、`/v1/mcp/server`、`/v1/mcp/server/health`、`/v1/mcp/access_groups`、`/mcp/servers`、`/mcp/tools`、`/mcp/connections`、`/get/mcp_semantic_filter_settings`、`/public/model_hub`、`/public/model_hub/info`、`/public/agent_hub`、`/public/mcp_hub`、`/public/litellm_blog_posts`、`/search_tools/ui/available_providers`、`/config/pass_through_endpoint`、`/health/license`、`/v2/user/info`、`/get/internal_user_settings`。

其中 `/health/license`、`/v2/user/info` 是**有意**的自托管简化（前端靠它决定菜单与许可门禁），建议保留；其余大多是「页面已死，只是让页面不报错」。

## 五、C 类：用户能点、但必然失败的页面

按页面整体判断，不要只删单个接口。

| 页面 | 入口 | 现状 | 前端体量 |
| --- | --- | --- | --- |
| **MCP Servers** | 导航 | 列表恒空；新建/编辑/删除全部假成功；连通性测试恒 0 工具 | tools 模块 |
| **Tag Management** | 导航 | `/tag/list` 恒空，`/tag/new`、`/tag/update`、`/tag/delete`、`/tag/info` 全部 404 | tools 模块 |
| **Projects** | 导航 | `/project/list` 恒空，`/project/new`、`/project/update`、`/project/delete`、`/project/info` 全部 404 | access-control 模块 |
| **Budgets** | 导航 | `/budget/list` 恒空，`/budget/new`、`/budget/update`、`/budget/delete` 全部 404 | access-control 模块 |
| **Access Groups** | 导航 | `/v1/access_group` 恒空，增删改全部 404 | access-control 模块 |
| **AI Hub** | 导航 | `/public/*_hub` 恒空；`/model_group/make_public`、`/v1/agents/make_public`、`/v1/mcp/make_public`、`/model_hub/update_useful_links` 全部 404 | model-hub 36 文件 / 4025 行 |
| **Cost Tracking** | 导航 | `/cost/estimate`、`/config/cost_discount_config`、`/config/cost_margin_config` 全部 404 | cost-tracking |
| **Claude Code Plugins** | 导航 | 列表可读（DB 真实），注册/市场接口 503 | tools 模块 |
| **Logging & Alerts** | 导航 | CloudZero 删除/dry-run 404，`/config/callback/delete` 404，告警与邮件事件恒空 | logging-settings |
| **Admin Settings** | 导航 | `PATCH /update/ui_settings` 404（页面可见性、UI 偏好存不下来）；主题设置是真的 | admin-settings |
| **Guardrails** | `/ui/guardrails` | 列表恒空、创建 404、监控概览恒 0 | guardrails 87 文件 / 7893 行 |
| **Policies** | `/ui/policies` | 同上，模板/附件/解析/测试接口全部不存在 | policies 54 文件 / 4456 行 |
| **Prompts** | `/ui/prompts` | `/prompts*` 全 503 | prompts 26 文件 / 2349 行 |
| **Vector Stores** | `/ui/tools/vector-stores` | `/v1/vector_stores`、`/vector_store/info` 等全 503 | tools 模块 |
| **Caching** | `/ui/experimental/caching` | `/cache/settings`、`/cache/settings/test`、`/cache/ping` 404；`/global/activity/cache_hits` 503 | cache 11 文件 / 725 行 |
| **Playground（部分能力）** | 导航 → Playground | MCP 工具调用 `/mcp-rest/tools/*`、A2A `/a2a/*`、图像编辑 `/images/edits`、用户凭据 `/v1/mcp/user-credentials` 全部 404；对话、图像生成、对比等主链路正常 | playground 96 文件 / 9491 行 |

其余零散 404（点了才有反应，不影响页面打开）：
`/user/filter/ui`、`/key/{id}/regenerate`、`/key/service-account/generate`、`/key/bulk_update`、`/key/{id}/reset_spend`、`/team/daily/activity`、`/policy/info/{id}`、`/organization/member_update`、`/user/bulk_update`、`/invitation/new`、`/get/default_team_settings`、`/update/default_team_settings`、`/health/test_connection`、`/v1/tool/list`、`/v1/tool/policy/*`、`/guardrails/apply_guardrail`、`/guardrails/test_custom_code`、`/guardrails/validate_blocked_words_file`、`/guardrails/usage/logs`、`/policies/resolve`、`/policies/test-pipeline`、`/policies/attachments/estimate-impact`、`/policy/templates/{enrich,suggest,test,enrich/stream}`、`/prompts/{id}/info`、`/prompts/{id}/versions`、`/prompts/test`、`/utils/dotprompt_json_converter`、`/onboarding/get_token`、`/onboarding/claim_token`、`/v3/login/exchange`、`/audit`、`/config/callback/delete`、`/v1/mcp/server/oauth/session`、`/v1/mcp/server/discover`、`/openapi-registry`、`/v1/mcp/server/submissions`、`/v1/mcp/server/{id}/approve|reject`、`/update/mcp_semantic_filter_settings`、`/v1/search/tools` 相关的 UI 发现接口。

## 六、D 类：有实现、但没有任何调用方（需你确认）

这些是**真实代码**，只是仓库里没人调用。可能被外部脚本、SDK 或运维使用，删之前需要你确认。

| 端点 / 模块 | 说明 |
| --- | --- |
| `/v1/embeddings`、`/embeddings`、`/engines/*/embeddings`、`/openai/deployments/*/embeddings` | 真实实现，但生产 30 天 0 次 `embedding` 调用，历史上也从未出现 |
| `/v1/completions`、`/completions`（legacy） | 真实实现，生产从未调用 |
| `/v1/moderations` | 真实实现，生产从未调用 |
| `/v1/audio/speech`、`/v1/audio/transcriptions`（+非 v1 别名） | 真实实现（走 Router），生产从未调用 |
| `/v1/files*`（`AnthropicMessagesEndpoint.ts` 内的真实实现） | 真实实现，仓库内 0 调用；`CallType` 里也没有 files 类型，生产无从统计 |
| `/customer/*`（new/update/delete/block/unblock/info 共 6 条） | 真实 DB CRUD；Dashboard 只调用 `/customer/list`，其余 6 条无任何调用方 |
| `/spend/keys`、`/spend/users`、`/spend/tags`、`/spend/calculate`、`/spend/logs`、`/spend/logs/v2` | 只有旧 Usage 页的部分入口在用，其余无调用 |
| `/global/spend`、`/global/spend/providers`、`/global/spend/report` | 仅旧 Usage 页使用，与新的 Usage 页重复 |
| `/utils/model_info`、`/utils/supported_openai_params` | 无调用 |
| `/cursor/chat/completions` | 无调用（CLI 客户端走 `/v1/chat/completions`） |
| `/v1/mcp/server/oauth-user-credential/status` | 无调用 |

判断依据：生产 `call_type` 历史 + 前端全量字面量扫描。**如果这些是给外部客户端的公共 API，即使没人用也应保留**——这需要你确认对外承诺范围。

## 七、E 类：定义了但从不读写的数据库表（31 张）

`src/db/schema/*.ts` 是 Python 版 Prisma schema 的镜像，其中 31 张表在运行时代码里**没有任何引用**（标识符与表名字符串都搜过）：

`LiteLLM_AuditLog`、`LiteLLM_CacheConfig`、`LiteLLM_ConfigOverrides`、`LiteLLM_CronJob`、`LiteLLM_DailyGuardrailMetrics`、`LiteLLM_DailyPolicyMetrics`、`LiteLLM_DeletedTeamTable`、`LiteLLM_ErrorLogs`、`LiteLLM_GuardrailsTable`、`LiteLLM_HealthCheckTable`、`LiteLLM_InvitationLink`、`LiteLLM_JWTKeyMapping`、`LiteLLM_ManagedFileTable`、`LiteLLM_ManagedObjectTable`、`LiteLLM_ManagedVectorStoreIndexTable`、`LiteLLM_ManagedVectorStoresTable`、`LiteLLM_ManagedVectorStoreTable`、`LiteLLM_MCPServerTable`、`LiteLLM_MCPUserCredentials`、`LiteLLM_ModelTable`、`LiteLLM_PolicyTable`、`LiteLLM_PolicyAttachmentTable`、`LiteLLM_PromptTable`、`LiteLLM_SkillsTable`、`LiteLLM_SpendLogGuardrailIndex`、`LiteLLM_SpendLogToolIndex`、`LiteLLM_SSOConfig`、`LiteLLM_TagTable`、`LiteLLM_ToolTable`、`LiteLLM_UISettings`、`LiteLLM_UserNotifications`。

生产库行数（只读统计）：

| 表 | 行数 | 最后写入 | 结论 |
| --- | --- | --- | --- |
| `LiteLLM_SpendLogToolIndex` | 1,268,794 | 2026-07-23（近 30 天 0 行） | Python 时代遗留数据，可清 |
| `LiteLLM_ToolTable` | 272 | 2026-07-20 | 遗留数据，可清 |
| `LiteLLM_HealthCheckTable` | 192 | 2026-06-23 | 遗留数据，可清 |
| `LiteLLM_DeletedTeamTable` | 2 | — | 可清 |
| 其余 27 张 | 0 | — | 空表 |

另有 2 张曾被误判、实际**在用**，已从清单剔除：`LiteLLM_BuiltinCapabilityImages`（3003 行，今天仍在写，见 `src/capabilities/VisionImageStore.ts`）、`LiteLLM_DeletedVerificationToken`（11 行，`KeyManagementEndpoint.ts` 使用）。删表会牵动 `drizzle` 迁移历史和 `SchemaPreflight` 基线，建议单独一批、只删 drizzle 定义与对应迁移文件的方式处理。

## 八、F 类：不可达代码

从 `src/main.ts` 出发的 import 图里抓不到、也没有任何动态引用：

- `src/auth/ModelAccessControl.ts`（内含 `TODO: 从 LiteLLM_AccessGroupTable 查询…`）
- `src/core/api/ProviderError.ts`
- `src/core/api/responses.ts`
- `src/core/db/ProductionPreflight.ts`
- `src/core/utils/retry.ts`
- `src/router/RouterTestDelegates.ts`、`src/router/RouterTestHelpers.ts`
- `src/db/schema/drizzle-schema.ts` 及其聚合的 24 个 schema 模块（入口文件无引用）

前端侧仅 2 个孤儿文件（1115 个 .ts/.vue 里）：

- `src/features/content/support/PrismTypes.d.ts`
- `src/features/logs/data/LogsColumnPreferencesData.ts`

另有一个导出死代码：`src/features/application/data/PageRegistry.ts` 的 `pageImplementationStatus()` 无调用方。

## 九、G 类：注册了但没有任何入口的页面

`PageRegistry` 有 42 个页面，导航 24 项，URL 别名里没有它们，也没有任何组件引用：

| page key | 组件 |
| --- | --- |
| `agents` | `features/tools/ui/AgentsPageComponent.vue` |
| `tool-policies` | `features/guardrails/ui/ToolPoliciesPageComponent.vue` |
| `guardrails-monitor` | `features/guardrails/ui/GuardrailsMonitorPageComponent.vue` |
| `pass-through-settings` | `features/settings/ui/PassThroughSettingsPageComponent.vue` |

（`pass-through-settings` 的别名 `experimental/pass_through_settings` 只在 `pathPages` 之外的常量里出现过，实际路由不到。）

## 十、H 类：仓库里的其他死重量

| 项 | 规模 | 说明 |
| --- | --- | --- |
| `ui/litellm-dashboard-react-reference/` | 1.6 GB / 73,316 个文件 | 旧 React 后台，未跟踪且被 `.gitignore` 忽略，只作参考 |
| `.artifacts/` | 124 MB | 构建/测试产物，已被忽略 |
| `ui/out/`、`dist/` | 22 MB + 7.6 MB | 构建产物 |
| `config` 里的 `litellmSettings.cacheModelConfig` | — | `src/core/config/` 之外 0 引用 |

## 十一、建议的处理顺序

1. **第一批（零风险，先做）**：A 类的 22 个纯桩文件 + F 类不可达模块 + G 类不可达页面。删完 `npm run typecheck` 与相关测试应全绿，行为零变化。
2. **第二批（需要一起删前端）**：C 类里「整页皆假」的 6 个导航页（MCP Servers、Tag Management、Projects、Budgets、Access Groups、AI Hub）——删接口的同时删页面、导航项和 `PageRegistry` 条目，否则用户仍能点到。
3. **第三批（要你判断产品意图）**：Guardrails / Policies / Prompts / Vector Stores / Caching 这 5 个「有完整 UI 但没有后端」的模块（合计约 300 个前端文件、1.5 万行）。是补后端，还是删前端？
4. **第四批（对外承诺）**：D 类里有实现无调用的公共 API（embeddings / completions / moderations / audio / files）。若不做兼容承诺，可删；若外部客户可能用，保留。
5. **第五批（数据层）**：31 张死表 + 对应 drizzle 迁移，单独一轮，先在预发验证 `SchemaPreflight`。

## 十二、需要你确认的问题

1. 上面的「假成功」接口（MCP Servers、邮件/告警/CloudZero 设置）现在有没有真实用户在用？如果有人在页面上配置过，删之前要告知。
2. Guardrails / Policies / Prompts / Vector Stores / Caching：**近期打算补后端**，还是直接删前端？
3. `/v1/embeddings`、`/v1/completions`、`/v1/moderations`、`/v1/audio/*`、`/v1/files` 这几条 OpenAI 兼容接口，是否需要继续对外承诺？
4. 旧 Usage 页（`/ui/usage`）与新的 Usage 页重复，是否保留？
5. 数据库表这一批，是否允许我连迁移一起清理（会改 `drizzle/` 目录）？
