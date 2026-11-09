# 无用功能清理记录

> 调查 2026-11-08，同日按用户确认执行清理并发布生产。本文上半部分是执行结果，末尾保留判定依据，
> 供后续判断“某功能是否存在”时复查。清理后仓库里不再保留纯占位路由、假成功页面和无读写的表。

## 一、执行摘要

| 范围 | 结果 |
| --- | --- |
| 后端占位路由 | 删除 25 个 `src/proxy/*Endpoints.ts` 桩模块、`WebUiSupportEndpoints` 中 29 条桩路由、4 个不可达模块 |
| 后端数据库 | 删除 33 张无读写表、1 个枚举，新增迁移 `drizzle/0011_drop_dead_tables.sql`；生产 `public` 表 70 → 37 |
| Dashboard | 删除 640 个前端文件（10 个功能目录、若干页面与调用），导航收敛为 4 组 |
| 保留 | 对外承诺的 inference 面、Search Tools、CLIProxy、Models、Keys、Logs、Access Control、Settings、Playground、Usage |
| 工作区 | 未 `git commit`、未 push |

判定原则：页面存在但后端恒 503、恒空、恒成功，或调用的接口根本不存在，都按“无用功能”处理并整页删除；
只保留有真实读写、有观测价值、或对外承诺过的入口。

## 二、后端删除

### 2.1 桩路由模块（25 个，整文件删除）

Assistants、Files、Batches、FineTuning、VectorStore、Rerank、Realtime、Agent、Google、MCP、SCIM、Prompt、
Policy、Tool、Compliance、AnthropicSkills、ClaudeCodeMarketplace、SSO、SpendIntegration、ConfigOverrides、
EmailEvents、IpAllowlist、OCRVideoContainer、Analytics、Alerting。

它们的共同特征是 `registerRoute` 之后恒抛 503 或返回常量。唯一例外是 `FilesEndpoints` 的 5 条 503 路由：
`AnthropicMessagesEndpoint` 先注册了真实可用的 `/v1/files*`，这 5 条永远不会命中，删除无行为变化。

### 2.2 其他后端删除

- `WebUiSupportEndpoints`：`/public/model_hub*`、`/public/agent_hub`、`/public/mcp_hub`、`/public/litellm_blog_posts`、
  `/claude-code/marketplace.json`、`/callbacks/configs`、`/project/list`、`/tag/list`、`/access_groups/list`、
  `/v1/access_group`、`/in_product_nudges`、`/budget/list`、`/budget/settings`、`/guardrails/*`、`/policies/*`、
  `/prompts/list`、`/vector_store/list`、`/v1/agents`、`/v1/mcp/server`、`/get|update/internal_user_settings`、
  `/public/agents/fields`、重复的 `/customer/list` 桩。
- `ModelsPageSupportEndpoints`：4 条纯转发路由。
- `UtilEndpoints`：只保留 `/utils/model_info`、`/utils/supported_openai_params`。
- 不可达代码：`src/auth/ModelAccessControl.ts`、`src/core/api/ProviderError.ts`、`src/core/api/responses.ts`、
  `src/core/utils/retry.ts`（含测试）。
- `src/shared/WebUiPaths.ts` 别名收缩到 15 条，移除 guardrails / policies / prompts / vector-stores / caching /
  mcp / model-hub / tag-management / claude-code-plugins / budgets / 旧 usage 等入口。
- `src/core/db/ProductionPreflight.ts` 是部署契约（脚本会校验该产物），已确认保留。

### 2.3 数据库

`drizzle/0011_drop_dead_tables.sql` 删除 33 张表（`CASCADE`）：

AccessGroup、AuditLog、CacheConfig、ClaudeCodePlugin、ConfigOverrides、CronJob、DailyGuardrailMetrics、
DailyPolicyMetrics、DeletedTeam、ErrorLogs、Guardrails、HealthCheck、InvitationLink、JWTKeyMapping、
ManagedFile / ManagedObject / ManagedVectorStore / ManagedVectorStoreFile / ManagedVectorStores、
MCPServer、MCPUserCredentials、Model、Policy、PolicyAttachment、Prompt、Skills、SpendLogGuardrailIndex、
SpendLogToolIndex、SSOConfig、Tag、Tool、UISettings、UserNotifications。

同时 `DROP TYPE "JobStatus"`（仅 `LiteLLM_CronJob` 使用）并删除 `src/db/schema/` 下 33 个 schema 文件、
`drizzle-schema.ts` 的 33 个导出与 `index.ts` 的 8 个再导出；`src/core/db/python-schema-baseline.json`
由 57 张表收缩到 24 张，与生产实际表集合一致。

`0000` 基线迁移保持字节不变（已注册哈希不可改，否则 `MIGRATION_ARTIFACT_MISMATCH`），清理全部通过 `0011` 完成。

## 三、Dashboard 删除

- 整目录删除：`features/guardrails`（106 文件）、`features/policies`（69）、`features/prompts`（33）、
  `features/cache`（15）、`features/model-hub`（44）、`features/usage/legacy`、`features/tools` 的桩页面
  （135 → 14，只留 Search Tools）、`claude-code-nudge`。
- 页面：MCP Servers、Projects、Budgets、Access Groups、Invitations、CSV 批量用户、云账单（CloudZero）、
  Spend Integration、Email Events、Alerting、Pass-through、模型连接测试、Audit Logs、Compliance、
  Page Visibility、UI Settings、Onboarding、MCP OAuth callback、旧 Usage。
- 页面注册与导航：`PageRegistry` 去掉 19 个页面并新增 `isRegisteredPage`；未注册页面统一回落到
  Virtual Keys，不再抛错。`NavigationData` 收敛为 AI GATEWAY / OBSERVABILITY / ACCESS CONTROL / SETTINGS
  四组，首屏可见 11 项，其余在折叠分组内。`NavigationLogic` 新增 `usage`、`old-usage` → `new_usage` 的旧链接重定向。
- 保留页面的死调用清理：Keys 的 Agents/Vector Stores/MCP 字段、Models 的 Guardrails/Vector Store 字段与
  Pass-through、Logs 的 Audit/Compliance、Logging 的 CloudZero/Spend Integration/Email Events/Alerting、
  Admin 的 Page Visibility/UI Settings、Playground 的 Guardrails/Policies/Vector Store 选择器与
  `/v1/agents`、`/vector_store/list` 目录加载、Usage 的旧 User-Agent/Ask-AI 面板。

## 四、保留清单（页面与后端能力一致）

| 面 | 保留内容 |
| --- | --- |
| 对外 inference 承诺 | `/v1/completions`、`/v1/embeddings`、`/v1/moderations`、`/v1/audio/*`、`/v1/files*`（Anthropic Files 转发，真实上游透传）、`/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/search`、`/v1/images/*` |
| Dashboard | Virtual Keys、Playground、Models + Endpoints、Search Tools、Usage（新页）、Logs、Speed、Teams、Users、Organizations、Router Settings、CLIProxy、Logging & Alerts、Admin Settings、Cost Tracking、API Reference、Builtin Capabilities |
| 其他 | Search Tools 真实端点、CLIProxy 全量（含 `/cliproxy/management/*` passthrough）、`/spend/logs/*`、`/team|user|organization|customer|tag|agent` 管理面、`/credentials`、`/provider/quota`、`/key/regenerate` |

Usage 页保留 global / customer / tag / agent 四个真实维度（`/…/daily/activity` 均存在），实体选择器在
`/customer/list`、`/tag/list`、`/v1/agents` 删除后自动隐藏，不再有“下拉必空”的假可用控件。

## 五、验证

本地门禁（开发容器 `cc-server-dc`，源码经 Samba 共享）：

| 门禁 | 结果 |
| --- | --- |
| `git diff --check` | 通过 |
| 后端 `npm run typecheck` / `npm run lint` / `npm run build` | 通过（`dist/core/db/ProductionPreflight.js` 存在） |
| 后端 `npm test` | 152 suites / 1960 passed，31 skipped |
| 前端 `npm run typecheck`（vue-tsc） | 0 error |
| 前端 `npm run lint`（`--max-warnings=0`） | 0 problem |
| 前端 `npm run format:check` | 通过 |
| 前端 `npm test`（vitest） | 81 files / 318 passed |
| 前端 `npm run build` | 通过（记录 build provenance） |

生产发布与线上核验（2026-11-08）：

- 标准入口 `restart-litellm.sh`：镜像构建 → 只读预检（`migrationState: managed`）→ 切换容器 → 健康检查 6s。
- `litellm-prod` 运行中、`RestartCount=0`、`OOMKilled=false`；`/health/liveliness` 200，`/ui/?page=logs` 200。
- 迁移 `0011` 已应用：`public.__drizzle_migrations` 12 条、`public` 表 70 → 37（33 张目标表）、`public` 下
  `JobStatus` 枚举已消失；抽查 Guardrails/Model/Tool/HealthCheck/AuditLog/AccessGroup/Policy/Prompt/SSOConfig/
  Tag/UISettings/CacheConfig/ErrorLogs/MCPServer 等 14 张表均不存在。
- 已删除的 19 条接口抽样全部 404（`/guardrails/list`、`/policies/list`、`/v1/agents`、`/vector_store/list`、
  `/prompts/list`、`/v1/mcp/server`、`/email/event_settings`、`/alerting/settings`、`/cloudzero/*`、
  `/public/model_hub/info`、`/callbacks/configs`、`/budget/list`、`/tag/list`、`/project/list`、
  `/access_groups/list`、`/in_product_nudges`、`/model/info/test_connection` 等）。
- 保留接口抽样 200：`/health/liveliness`、`/get/config/callbacks`、`/get/ui_settings`、`/sso/get/ui_settings`、
  `/config/routable_model/options`、`/public/litellm_model_cost_map`、`/search_tools/list`、`/provider/quota`、
  `/v1/models`；`/v1/completions`、`/v1/embeddings`、`/v1/audio/*` 返回 400（路由存在、请求体缺参），
  `/v1/moderations` 返回 200。
- 真实浏览器（已登录）逐页加载 16 个保留页面与 `?page=usage`：无 console 异常、无 4xx/5xx 业务请求；首屏导航恰为 11 项；
  `?page=usage` 渲染新 Usage 页；`?page=guardrails|policies|mcp-servers|prompts` 回落到 Virtual Keys。

已知且不在本次范围的现象：

- OpenAI 风格 `/v1/files`（无 `anthropic-version`）由原来的 503 桩变为 404；Anthropic Files 转发保留，
  其上游返回码原样透传。这是删除 503 桩的直接结果，两条路径此前都无法工作。
- `/cliproxy/update/check` 在页面预取时返回 502：该端点依赖 GitHub 发布查询，与本次清理无关，CLIProxy
  代码未改动。
- 为核验页面渲染使用了一次生产管理会话（登录、逐页访问、退出尝试），凭证未出现在任何输出中；该会话
  按默认 7 天有效期自动过期。

## 六、判定依据（调查阶段保留）

| 维度 | 做法 |
| --- | --- |
| 后端路由 | 扫描 `registerRoute(...)`、装饰器控制器（`@get/@post/...`）、`router.use`，共 363 条注册路由（359 条直扫 + 4 条 `for` 循环注册的 `/v1/chat/completions` 系列）。 |
| 前端调用 | 扫描 Dashboard 全部 `/xxx` 字面量与 `requestJson` 调用点，与后端路由逐段匹配；被判“无调用”的再逐条子串复核。 |
| 页面可达性 | `PageRegistry.ts`、`NavigationData.ts`、`src/shared/WebUiPaths.ts`，并展开 `import.meta.glob`。 |
| 生产流量 | 只读查询生产库 `LiteLLM_SpendLogs`：最近 30 天 `call_type` 仅 5 种 —— `amessages` 103312、`aresponses` 64592、`acompletion` 9464、`asearch` 1040、`aimage_generation` 433；2026-07 至今从未出现 `embedding / completion / speech / transcription / moderation / rerank`。流量只用于判断“是否有人用”，不作为删除依据。 |

`SpendLogs` 只记录产生费用的模型调用，`GET /v1/models`、健康检查、管理面接口不会有记录，这些按代码与
前端引用判断。

### 曾确认“无调用”但必须保留的实现

`/search_tools/*`、`/spend/logs/session/timeline`（含 `/stream` WS）、`/key/regenerate`、`/v3/login`、
`/auth/session`、`/auth/logout`、`/config/yaml_diff*`、`/team|organization|user|customer|tag|agent/daily/activity`、
`/provider/quota`、`/api-key-usage`、`/user/filter/ui`、`/builtin-capabilities`、`/config/routable_model/options`、
`/public/litellm_model_cost_map`、`/credentials`、`/cliproxy/*`（含 `/cliproxy/management/*` catch-all）。

### 曾确认“不存在”的前端调用（已随页面删除）

`/tag/distinct`、`/tag/summary`、`/tag/user-agent/*`、`/usage/ai/chat`、`/health/test_connection`、
`/sso/key/generate`（后端在 `DiscoveryEndpoints` 中硬编码 `sso_configured:false`、`auto_redirect_to_sso:false`）。
