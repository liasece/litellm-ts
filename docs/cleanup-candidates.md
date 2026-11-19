# 无用功能清理记录

> 首轮调查 2026-11-08，同日按用户确认执行清理并发布生产；2026-11-17 在读路径收紧后做第二轮对象与
> 历史敏感字段清理。每个日期的小节记录当时的执行结果，末尾保留判定依据，供后续判断“某功能是否存在”
> 时复查。清理后仓库里不再保留纯占位路由、假成功页面和无读取入口的表/列。

## 2026-11-19 Dashboard 页面精简

按用户要求下线四个页面，删除只被它们使用的前端代码；后端管理端点保留，它们是公开管理 API 的一部分，
配置仓库与 API 调用方仍在用。

| 页面 | 删除内容 | 保留原因 |
| --- | --- | --- |
| Health Status（`models-health`） | 页面与 `ModelHealthComponent.vue`；模型列表的健康检查、徽标与重跑仍用 `ModelHealthStore` | 健康状态已在 All Models 列表内可见，独立表格只是同一批数据的重复视角 |
| MCP Server Activity（`usage-mcp`） | 页面与 `UsageActivity` 的 MCP 实例；`summary`/`detail` 的 `mcp_servers` 维度仍在用量响应里 | 该维度没有可用实体数据，页面长期是空表；Cost 页仍展示 MCP 花费 |
| Cost Tracking（`cost-tracking`） | `features/cost-tracking`（页面、计算器、折扣与保证金表单、store、逻辑测试） | 折扣、保证金与估算由 `/config/cost_discount_config`、`/config/cost_margin_config`、`/cost/estimate` 提供，配置由 API 管理 |
| Logging & Alerts（`logging-and-alerts`） | `features/logging-settings` 与页面 | 回调与告警配置由 `/get/config/callbacks` 提供，配置仓库与 API 调用方在用 |

旧地址不断链：`/ui/models/health` 与 `/ui/usage/mcp` 保留为路径别名，`?page=models-health|usage-mcp|cost-tracking|logging-and-alerts`
经 `retiredPageRedirects` 落到 All Models、Cost 或 Admin Settings；`?page=models&tab=health` 同样落到 All Models。

## 2026-11-17 无读取入口对象与历史敏感字段清理

这是 2026-11-08 清理的后续：SpendLog 读路径收紧后，历史认证头与内部 body 已经没有读取入口，原先
「只脱敏、不删原文」的临时状态可以收口。调查与执行边界如下，详细判定沿用文末的原则。

### 结构清理

| 对象 | 清理前 | 判定依据 |
| --- | --- | --- |
| 8 个视图：`DailyTagSpend`、`Last30d*`、`LiteLLM_VerificationTokenView`、`MonthlyGlobalSpend*` | 8 个，全部 0 字节 | TS 代码、Dashboard、脚本和文档都没有查询；全局聚合直接读 `LiteLLM_SpendLogs` 与 `LiteLLM_Daily*` 表 |
| `litellm_credential_e2e` schema | 59 张空表，约 1.9 MB | 旧测试 schema，不在 `search_path`，代码没有 schema 名引用 |
| `drizzle` schema | 1 张空 `__drizzle_migrations` | 当前迁移在 `public`；该 schema 没有运行时入口 |
| `LiteLLM_AgentsTable` | 0 行 | 只在 `SpendTracker` 里累加 `spend`，没有定义、列表或详情读取；`/v1/agents` 管理面已在 0011 删除，agent 日报仍由 `LiteLLM_DailyAgentSpend` 提供 |
| `LiteLLM_AgentsTable` 的 schema/代码引用 | 1 个 schema 文件、1 个导出、1 段 spend 更新 | 随表一起删除，避免代码继续写一个无人读取的表 |
| `public._prisma_migrations` | 162 行，约 104 kB | Python 迁移历史；TS 只使用 `public.__drizzle_migrations`，没有读取方 |
| `LiteLLM_SpendLogBlocks.first_seen` | 1 列 + 1 个索引 | 只有默认值和索引，没有读取；块共享生命周期由引用关系决定，不能按时间清理，保留该列只会增加写放大 |

迁移是 `drizzle/0020_cleanup_unused_objects.sql`，使用 `IF EXISTS`，并先在从生产 `public` schema
克隆的临时库上执行验证：8 个视图、`LiteLLM_AgentsTable`、`_prisma_migrations` 均消失，
`first_seen` 列不再存在。`public` 表从 34 张降到 32 张（`LiteLLM_AgentsTable` 与
`_prisma_migrations`），视图从 8 个降到 0 个。

### 历史敏感数据

`LiteLLM_SpendLogs` 中仍有历史认证头和 Responses 内部请求体；读侧已对它们脱敏/忽略，但原值仍占
TOAST。新增 [批处理脚本](../scripts/cleanup-spend-log-sensitive-data.cjs)，复用运行时
`prepareSpendLogProxyForStorage`，只改 `proxy_server_request`：

- 认证头：`authorization`、`proxy-authorization`、`api-key`、`x-api-key`、`x-goog-api-key`、
  `x-litellm-api-key`、`cookie`、`set-cookie`，包括 `upstream_request` / `upstream_response`；
- 内部字段：`body`、`upstream_request.body`、`upstream_response.body` 里的
  `__litellm_responses_body`；
- 脚本用 `SELECT ... FOR UPDATE SKIP LOCKED`、小批量短事务，幂等，可重复执行；`--write` 之前只统计。
  执行前只读统计为 52,128 行 `LiteLLM_SpendLogs` 命中，`LiteLLM_ActiveRequests` 为 0 行。

不清理 `LiteLLM_SpendLogBlocks`：块按内容跨行共享，当前没有已证明的孤儿块，也没有按时间删除的安全
依据；`LiteLLM_SpendLogs` 正文行仍然全部是列表/详情/会话读路径的数据源。

### 保留判定

`public` 其余表均有当前读取方，包括 image completion、privacy redaction、deprecated/deleted tokens、
spend reservations、end-user、team/organization memberships、search tools、credentials 等；
`LiteLLM_DailyAgentSpend` 虽然当前无 agent 定义表，但 `/agent/daily/activity` 仍有读取入口，保留。
视图、空测试 schema 和迁移历史没有外部契约，才进入本轮删除。

列级审计以 Drizzle schema 的列名为入口，扫描 `src/`（排除 schema 与测试）中的直接引用，再对零引用列回查原始 SQL/序列化器。
`first_seen` 同时满足“无直接引用、无间接读取、无兼容契约”，因此删除。`LiteLLM_ProjectTable` 的
`project_alias` / `model_rpm_limit` / `model_tpm_limit` 与 `LiteLLM_ObjectPermissionTable` 的
`blocked_tools` 目前也没有 TS 直接读取；但它们是 Python 对齐 schema 的一部分，生产数据分别为空
（ProjectTable 0 行、ObjectPermission 4 行且目标列为空）。本轮没有把它们当成“已证明可删”，因为
“TS 不读”不等于外部数据库契约不存在；若要继续删，应另立兼容性迁移并同步 Python 基线，而不是混在
本次按读路径确认的清理里。

### 部署与核验

2026-11-17 15:46 CST 标准部署完成：source commit `0e115b8`，镜像 `sha256:fd855f53…`，容器
`litellm-prod` healthy、`OOMKilled=false`、`RestartCount=0`；`/health/liveliness` 与
`/ui/?page=logs` 均 200。迁移表 21 条记录，`public` 表 32 张、视图 0 个；
`LiteLLM_AgentsTable`、`_prisma_migrations`、`litellm_credential_e2e`、`drizzle` schema 与
`LiteLLM_SpendLogBlocks.first_seen` 均已确认不存在；`LiteLLM_DailyAgentSpend` 与
`LiteLLM_SpendLogBlocks` 保留。

历史敏感字段清理分两段执行：首段提交 12,800 行后，把脚本改为按主键游标续扫，剩余 39,328 行完成；
两段合计 52,128 行。复查结果：`LiteLLM_SpendLogs` 中原始 Authorization 0 行、原始 x-api-key 0 行、
`__litellm_responses_body` 0 行，53,605 行的 Authorization 为 `[REDACTED]`；`LiteLLM_ActiveRequests`
剩余 0 行。带认证的 compact 详情抽样返回 200（16,815 B），不含内部 body 或明文 Authorization。
清理后 `n_dead_tup=0`，但表文件大小为 `LiteLLM_SpendLogs` 1,861 MB、`LiteLLM_SpendLogBlocks`
1,680 MB；没有执行 `VACUUM FULL`，不能把“逻辑值已删除”表述成“物理文件立即缩小”。

验证：`git diff --check`、`typecheck`、`test:types`、ESLint 通过；全量 Jest 2628/2629 通过，既有
`AnthropicMessagesEndpoint` 套件在全量运行时偶发 404，隔离连续重跑 3 次均 30/30 通过。未 `git commit`、
未 push；工作区其他修改保持原样。

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
2026-11-17 的 `0020` 又移除无读取入口的 `LiteLLM_AgentsTable`，Python 基线由 24 张进一步收缩到 23 张。

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
`/auth/session`、`/auth/logout`、`/team|organization|user|customer|tag|agent/daily/activity`、
`/provider/quota`、`/api-key-usage`、`/user/filter/ui`、`/builtin-capabilities`、`/config/routable_model/options`、
`/public/litellm_model_cost_map`、`/credentials`、`/cliproxy/*`（含 `/cliproxy/management/*` catch-all）。

### 曾确认“不存在”的前端调用（已随页面删除）

`/tag/distinct`、`/tag/summary`、`/tag/user-agent/*`、`/usage/ai/chat`、`/health/test_connection`、
`/sso/key/generate`（后端在 `DiscoveryEndpoints` 中硬编码 `sso_configured:false`、`auto_redirect_to_sso:false`）。
