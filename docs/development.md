# LiteLLM TS 开发文档

这份文档回答「代码怎么组织、逻辑从哪进、加一个功能要改哪里、怎么验证」。当你要改代码、判断改动落点、或者解释某个分层为什么存在时看它。产品意图看[产品文档](product.md)，生产环境与发布排障看[运维文档](operations.md)。

## 定位与边界

覆盖：目录职责、请求链路、关键入口、扩展套路、编码与验证规范、技术选型理由、架构演进历史。

不覆盖：某个功能该不该做（产品），生产拓扑与发布授权（运维与 Skill），上游对齐的逐条状态（[上游对齐记录](upstream-alignment.md)）。

## 运行形态与技术选型

单进程 Node.js 服务，Express 4 承载全部 HTTP 与 WebSocket，PostgreSQL 是唯一持久化。确切版本以 `package.json`、锁文件和 `package.json#engines` 为准，本文不固化补丁版本。

- **TypeScript + strict**（`tsconfig.json`）：上游 Python 版的行为要靠类型和检查守住，`noUncheckedIndexedAccess` 与 `noImplicitOverride` 都开着。
- **Express 4**：中间件顺序即语义，且 SSE 逐帧写出、zstd 解压、逐字节透传都要直接操作原始 `req`/`res`；`res.write` 的语义最直接，换框架要重新验证整条链的时序。
- **pg + drizzle-orm**：迁移文件与 Python 版基线共存（`drizzle/0000_python_litellm_baseline.sql` 字节不可改），自有迁移从 `0001` 起，`src/core/db/python-schema-baseline.json` 记录与上游一致的表集合。
- **Vue 3 + Vite 的 Dashboard**：2026-11-08 完成从 React/Next 的迁移，视觉与交互按旧版复刻。当前运行时不得引入 React、Next、TanStack Query 或第二套组件设计，理由与验收记录见 [Vue 重写记录](frontend-vue-migration.md)。
- **不引入第二套状态库**：前端用原生响应式 store，按功能分 `api / data / logic / stores / render / ui`。
- 被评估但未采用的选项：后端改 Go（2026-11-12 用户询问性能收益，语料中没有采纳决定，现状仍是 Node/TS）；把 post-upstream 放进 `worker_threads`（同日提问，未见落地记录，见[待确认](#已知缺口与待确认)）。重写之前请先确认没有更新的一致决定。

## 目录职责

| 路径 | 职责 |
| --- | --- |
| `src/main.ts` | 进程入口：加载配置、创建容器、装配中间件与路由、启动监听、优雅退出 |
| `src/container.ts` | 服务容器：按依赖顺序建 Database / Credential / Router / 订阅运行时，并暴露幂等 `warmUp()` |
| `src/core/config/` | YAML 加载与校验、DB 配置覆盖（`DbConfigProvider`）、每请求运行时快照（`DatabaseRuntimeConfigService`） |
| `src/core/db/` | 连接池、启动重试、迁移与 `ProductionPreflight`（部署契约产物） |
| `src/core/api/` | 路由注册、错误映射（含流式错误码分类 `ClientErrorCode` 与 `Retry-After` 下发）、请求到达打点、响应头与脱敏辅助 |
| `src/auth/` | 虚拟密钥、JWT、WebUI 会话、对象授权（`AuthorizationGuard`）、仓库层缓存 |
| `src/router/` | 路由决策：部署选择、重试策略、冷却、fallback、流式包装、标签路由、限流 |
| `src/providers/` | 各上游 Provider 适配器与 `ProviderRegistry`（前缀解析、动态构造、订阅分发） |
| `src/subscriptions/native/` | 进程内订阅运行时：账号仓库、调度器、协议桥、七家 Provider 适配器、目录与额度 |
| `src/proxy/` | 对外 HTTP 端点：Chat / Messages / Responses / Embeddings / Images / Audio / Files / Search / 登录 / 发现 |
| `src/management/` | 管理面：Key、Team、User、Organization、Customer、Model |
| `src/spend/` | 在途登记、结算队列、块存储、日志查询与会话时间线、WebSocket 推送 |
| `src/cost/` | 价格快照、费用计算、折扣与保证金、成本追踪 |
| `src/capabilities/` | 内置能力：视觉、Web Search & Fetch、图片生成及其审计 |
| `src/privacy/` | 请求脱敏与响应还原（占位符、SSE 重写、统计） |
| `src/observability/` | 指标目录、HTTP/DB/进程采集、Prometheus 输出、慢请求日志 |
| `src/repositories/` | 表访问边界：配置、模型部署、凭据、表级缓存的唯一入口 |
| `src/ui/` | 后端静态托管 Dashboard 产物与 SPA 回退 |
| `src/shared/` | 前后端共用：页面路径、模型族、Alias、速度计算 |
| `ui/litellm-dashboard/` | Vue Dashboard；`ui/litellm-dashboard-react-reference/` 是旧 React 实现的只读对照，被 gitignore 且只在 JL3 存在，不进镜像 |
| `drizzle/` | 迁移 SQL 与 `meta/_journal.json` |
| `scripts/` | 迁移 journal 校验、SpendLog 回填等一次性脚本 |
| `tests/` | 跨模块集成、Provider 与补丁回归；单元测试与被测文件同目录 |
| `.agents/skills/` | 生产运维与提交两个专用工作流 |

## 请求链路

**启动**（`src/main.ts` → `src/container.ts`）：

1. 加载 YAML（`CONFIG_PATH` 或工作目录 `config.yaml`），端口与连接串可被 `APP_PORT`、`DATABASE_URL`、`LITELLM_MASTER_KEY` 覆盖。
2. `createServiceContainer()` 只做关键路径：数据库接管与迁移 → DB 配置覆盖 → 凭据装载 → Router 构造 → 订阅运行时构造（执行处理器此时注册）。
3. `listen()` 之后才 `void container.warmUp()`：远端价格快照与订阅设置投影并行执行，失败只降级对应能力。启动链上的取舍与瓶颈证据见[启动链路记录](startup.md)（其中 CLIProxy 子进程部分已过期，见[已知缺口](#已知缺口与待确认)）。

**中间件顺序**（`src/main.ts#_assemblyExpress`，顺序即语义）：

`requestArrivalMiddleware`（记账口径的请求到达时刻）→ `httpMetricsMiddleware` → `zstdRequestDecompress` → `express.json({limit: 200mb})` → `markBodyParsed` → `accessLogFilter` → `upstreamExchangeScope`（上游交换旁路作用域，日志层据此读上下游详情）。

监听与观测端点、公开路由（登录、发现、`/` 跳转）之后注册 WebUI 静态资源，再注册鉴权 API 路由，最后是 `errorHandler`。

**推理链**（`_registerCoreProxyRoutes` 的 `proxyRouter`）：

`codingClientModelMiddleware` → `container.authMiddleware` → `webUiCsrfProtection` → `authorizationGuard.middleware("inference")` → `privacyMaskingMiddleware` → `runtimeConfigService.middleware(router)` → 请求级路由参数 → `sseKeepaliveMiddleware` → 具体端点。

脱敏挂在鉴权之后、端点之前，但真正的请求体改写发生在 Router 选完 deployment、即将发往上游的最后一层（`Router._executeRequest`），因为判定对象是最终去向（见[隐私脱敏](privacy-redaction.md)）。

**路由与记账**：`DatabaseRuntimeConfigService` 每请求建立一致快照 → `Router` 选 deployment、执行 retry / cooldown / fallback（`RouterExecution`、`FallbackHandler`、`CooldownManager`）→ `ProviderRequestExecutor` → Provider `build()` 出上游请求体 → 上游响应经协议 translator 回到入口协议。流式 fallback 的判据是「客户端是否已拿到答案内容」，实现见 `src/router/StreamOutputVisibility.ts`：包络块、思考增量与错误透传不算「已给出答案」，正文、拒绝文本与工具调用增量才算。

**记账与日志**：在途登记 `src/spend/ActiveRequestJournal.ts`，结算走 `SpendSettlementQueue`，最终落 `LiteLLM_SpendLogs`；重复正文按内容寻址进 `LiteLLM_SpendLogBlocks`（`src/spend/SpendLogBlocks.ts`），读侧在 DTO 层统一组装，业务代码不应直接碰 `_litellm_ref_*` 键。日志行的 `metadata.user_api_key_alias` 是虚拟密钥的真实别名；主密钥没有 token 行可查，读侧由 `src/spend/spendLogKeyIdentity.ts` 按 `api_key == hash(主密钥)` 补成 `Master Key`，属展示补充、不回写库。

**Messages 的内置工具**：`src/proxy/AnthropicCapabilityStream.ts` 把多轮上游调用组织成一条公开的 Messages 流。
文本和思考可以直接下发；混合工具轮里的调用要等能力循环确定哪些交给客户端，避免客户端执行已由网关接管的工具。
若使用生成图片扩展，首帧前已就绪的图片在 `message_start.message.generated_images`；
已发出文字或思考后才生成的图片在 `message_delta.delta.generated_images`，同一批图片只交付一次。

## 关键逻辑入口

| 想改的东西 | 从这里进 |
| --- | --- |
| 新增上游供应商 | `src/types/provider.ts` 的 `LlmProviders`、`src/providers/ProviderRegistry.ts`（`DEFAULT_API_BASES`、`PREFIX_TO_PROVIDER`、`createProvider`）、新增 `src/providers/XxxProvider.ts`、`src/data/provider_create_fields.json`、前端 `features/providers/data/ProviderCatalogData.ts` |
| 订阅 Provider 行为 | `src/subscriptions/native/`（`bridge.ts` 协议、`scheduler.ts` 选号、`providers/` 上游特化、`quota/` 额度）、[订阅运行时专题](agent-guides/subscription-runtime.md) |
| 新增对外端点 | `src/proxy/XxxEndpoint.ts`，在 `src/main.ts` 对应 `_register*Routes` 里注册；若是页面路径同时改 `src/shared/WebUiPaths.ts` |
| 路由策略 / 重试 / 冷却 | `src/router/RouterExecution.ts`、`RouterRetryPolicy.ts`、`RouterExecutionBackoff.ts`、`CooldownManager.ts`、`RoutingStrategies.ts` |
| 费用与价格 | `src/cost/CostCalculator.ts`、`ModelCostMapService.ts`、`CostTrackingConfig.ts` |
| 日志字段与查询 | `src/spend/SpendMetadataFields.ts`、`SpendManagementEndpoint.ts`、`src/db/schema/spendLogs.ts` + 新迁移 |
| 实时推送 | `src/spend/logStreamWebSocket.ts`（日志列表）、`logUpdatesWebSocket.ts`、`sessionTimelineWebSocket.ts`；契约见 `AGENTS.md` 的实时通知一节 |
| 内置能力 | `src/capabilities/BuiltinCapabilityRunner.ts`、`BuiltinCapabilitiesConfig.ts`、各自的 `*Capability.ts` |
| 脱敏 | `src/privacy/PrivacyMiddleware.ts`、`PrivacyDispatch.ts`、`SseRewriter.ts` |
| 观测指标 | `src/observability/MetricCatalog.ts`、`HttpMetrics.ts`、`DatabaseMetrics.ts`、`RuntimeMetrics.ts`；指标语义见[观测性专题](observability.md) |
| Dashboard 页面 | `ui/litellm-dashboard/src/features/<name>/{api,data,logic,stores,render,ui}` + `features/application/data/PageRegistry.ts`、`NavigationData.ts` |

## 新增一个功能应改哪里

- **新供应商**：枚举 → Registry 三个映射 → Provider 实现（上游 URL、头、协议、错误分类）→ 创建字段与前端目录 → 至少一个真实请求形状的回归。普通 OpenAI 兼容供应商优先复用 `OpenAICompatProvider`，不要复制一份。
- **新推理端点**：端点文件 + `main.ts` 注册 + 鉴权/授权/脱敏位置说明 + 是否记账（`SpendLogs.call_type`）+ 前端路径（若可达）+ 契约测试。
- **新数据库表**：`drizzle/00NN_*.sql` + 在 `drizzle/meta/_journal.json` 注册 + `src/db/schema/` 定义与 `index.ts` 导出 + `python-schema-baseline.json` + 一个拥有该表的 repository。只增不改：已注册的迁移文件不可改字节，否则触发 `MIGRATION_ARTIFACT_MISMATCH`。
- **新 Dashboard 页面**：功能目录按 `api/data/logic/stores/render/ui` 分层 → 注册到 `PageRegistry` 与 `NavigationData` → 路径进 `src/shared/WebUiPaths.ts` → 手机端 320/390 不产生页面级横向滚动。没有后端支撑的页面不要建，参考[清理记录](cleanup-candidates.md)的判定原则。
- **新日志字段或筛选**：先确认是否要进表（加列 + 索引 + 回填脚本），再改 DTO 与 UI；筛选列有专门的物化列与覆盖索引迁移（`0016`～`0018`），不要用函数包住列导致索引失效。

## 规范与最佳实践

- **表边界**：`LiteLLM_Config`、`LiteLLM_ProxyModelTable`、`LiteLLM_CredentialsTable` 只允许 `src/repositories/` 下拥有它的 repository 与 schema 定义出现表名，由 `src/repositories/TableBoundary.test.ts` 扫描源码强制。新增热表时照此扩展边界，而不是让业务代码直接查。
- **运行时配置不缓存长 TTL**：配置改动必须下一个请求就生效，缓存只能放在 repository 层并自行失效。这是产品级约束，理由见[产品文档](product.md#设计理念与取舍)，不是可以拿来换性能的取舍点。
- **错误分类**：自身逻辑错误才记 `error` + 堆栈；上游 4xx/5xx 属于业务分支，按「能 fallback 就 fallback，否则原样透传」处理，不能算成服务端错误率或触发无意义冷却。这条来自用户对日志语义的要求，见[产品文档](product.md#设计理念与取舍)。
- **订阅模型命名**：`custom_llm_provider` 用订阅 slug，`model` 是原始上游模型 ID，新数据不要带 `cliproxy/`、`codex-subscription/` 一类运输前缀；历史日志的旧名只做只读兼容。
- **迁移纪律**：`0000` 基线不变，清理类改动用一个新迁移完成；`make check-drizzle-journal` 会拦未注册的迁移文件。
- **前端**：组件只装配，派生值用 computed 或纯函数；与网络、计时器、订阅、图表实例相关的生命周期要显式销毁；不得用 `as any`、`@ts-ignore`、放宽 tsconfig 或关闭 ESLint 规则掩盖问题。具体契约见 `ui/litellm-dashboard/AGENTS.md`。
- **测试质量**：只测可观察行为、业务契约、重要分支和明确回归风险；不写复述静态配置或实现细节的断言。判据与反例见 `AGENTS.md` 的测试质量一节，不要在这里另建一套标准。
- **注释**：解释前因后果与约束，不复述代码在做什么。历史原因不确定时写「待确认」，不要编。

## 验证与门禁

命令以当前 `package.json` 与子目录 `package.json` 为准，本文只给选择方法。

后端：`npm run typecheck`、`npm run test:types`（测试文件的类型检查，Jest 走 `isolatedModules` 不做类型检查）、`npm test`、`npm run lint`、`npm run build`（只在需要 `dist` 产物时跑，发布构建由 JL3 构建容器执行）。全量门禁是 `make ci`：lint、typecheck、test、`check-circular`（madge 循环导入）、`check-drizzle-journal`、`check-format`。

前端：在 `ui/litellm-dashboard` 下 `npm run typecheck`（vue-tsc）、`npm test`（Vitest）、`npm run lint`（`--max-warnings=0`）、`npm run format:check`、`npm run build`，浏览器语义改动再加 `npm run test:components`（Playwright）。CI 的 `frontend` 与 `components` 两个 job 覆盖同一组检查（`.github/workflows/ci.yml`）。

每个改动至少跑 `git diff --check`，加上能覆盖受影响行为的最小充分检查；高风险、跨模块或发布前的改动扩大到完整相关测试与 production build。已知基线失败必须与本次回归分开说明，不放宽门禁绕过。

## 常见改错方式

- 在业务代码里直接写三张热表的表名 → `TableBoundary.test.ts` 失败；正解是给 repository 加方法。
- 给运行时配置加进程内长缓存「提性能」 → 配置改动延迟生效，违背产品级正确性要求。
- 把上游超时、配额、鉴权失败记成服务端 `error` 或塞进 cooldown → 污染错误率与路由，正确做法是分类后决定 fallback 或透传。
- 新增迁移但不登记 `_journal.json` → CI 的 `check-drizzle-journal` 失败，生产预检也会拒绝。
- 为了让日志「短一点」重新加回字段截断 → 内容寻址块跨副本命不中，去重收益归零。
- 在 Dashboard 里前端聚合 session 或自己算费用 → 与后端口径分叉，用户已明确否定这种做法。
- 把 `_litellm_ref_*` 占位当业务字段读 → 读侧尚未组装；应先经 DTO 组装层。
- 新端点忘记挂 `authorizationGuard("inference")` 或脱敏中间件 → 越权或敏感值直发上游。
- 用 React/Next 组件、第二套状态库或第二套设计补齐页面 → 违反前端契约。

## 开发历史

| 日期 | 变化 | 为什么 | 来源 |
| --- | --- | --- | --- |
| 2026-05-29 | TypeScript 重写，Express + pg + drizzle 分层成形 | 需要能自己改协议与面板的实现 | git `d5c8dbe` |
| 2026-06-06 | 引入 Web 管理面板 | 账号与日志需要图形化 | git `34bca29` |
| 2026-07-23 | 运行时配置改为 DB-only，删除进程内配置缓存 | 配置改动要立刻生效 | git `0795930` |
| 2026-07-27 | 日志列表改为按开始时间混合在途与已结算两张表 | 用户要求进行中的请求也出现在列表里 | 语料 2026-07-27T07:06 |
| 2026-08-05～08-10 | 内置能力依次引入（视觉 → 搜索 → 生图），最初在请求链内代理执行 | 客户端无法自己装能力，只能由网关注入 | 语料 2026-08-05 `codex:019fd013`、08-06 `codex:019fd4d3`、08-10 `codex:019fea43` |
| 2026-11-02 | 内置能力重构为旁路中间件，不再侵入主流式链路 | 旧实现多次影响流式与日志，用户要求「从架构层面彻底做成旁路系统」 | 语料 2026-11-02T08:53 |
| 2026-10-11～12 | 上游对齐批落地 9 组能力：模型发现、Chat 参数、Responses input_tokens、编程客户端、SSE 心跳、路由与限流、日志内容、Usage API、管理 API | 与上游行为对齐并修掉确认过的 BUG | [上游对齐记录](upstream-alignment.md#本批实施结果2026-10-11) |
| 2026-11-03 | 流式 fallback 判据改为「客户端是否已拿到答案内容」 | 旧实现会在已输出部分内容后仍切模型，产生自相矛盾的响应 | [上游对齐记录](upstream-alignment.md#2026-11-03-流式-fallback-判据修正) |
| 2026-11-08 | Dashboard 从 React/Next 迁移到 Vue 3 + Vite，同日删除桩接口与无读写表 | 前端维护成本；迁移与清理一次完成，避免长期并存 | [Vue 迁移记录](frontend-vue-migration.md)、[清理记录](cleanup-candidates.md) |
| 2026-11-09 | SpendLog 改内容寻址块存储 | 364 GB 中 99.4% 是重复对话快照 | [上游对齐记录](upstream-alignment.md) |
| 2026-11-09～10 | 订阅执行从 CLIProxy Go 子进程改为 `src/subscriptions/native/` 进程内实现 | 少一层子进程与配置投影，账号与调度只有一个状态 | `AGENTS.md`、语料 2026-11-10T13:30 |
| 2026-11-10～12 | 在途行正文改内容寻址、记账事务锁顺序调整、结算异步化与结算队列 | 每请求二十多条语句与行锁争用拖慢首字 | [上游对齐记录](upstream-alignment.md#2026-11-10-在途行正文内容寻址与记账事务锁顺序) |
| 2026-11-13 | 前端手机端排版收敛，日志表回退为桌面表格 + 横向滚动 | 手机可读但不牺牲该页信息密度 | [Vue 迁移记录](frontend-vue-migration.md) |
| 2026-11-15 | 日志表启用 opt-in 虚拟滚动，适配 Dashboard 内层滚动容器 | 1000 行全量挂载约 6.7 万 DOM；只保留视口附近行，保留 URL/筛选/深链接 | [性能调查与实施记录](investigations/logs-page-size-1000-performance.html) |

## 已知缺口与待确认

- `docs/startup.md` 中「内置 CLIProxy 子进程的 install/project/spawn/健康检查」整段已过期：对应模块（`CliProxyRuntimeManager`、`CliProxyModelCatalog`、`CliProxyStartupGate`）已不存在。其中「哪些工作必须阻塞到监听之前」的划分仍然有效，已在本文件的请求链路一节保留。是否重写该专题待确认。
- `docs/vite8-test-chain-evaluation.md` 是 Next.js 时期针对 Vitest 测试链的版本评估，结论已被 Vue 迁移后的工具链取代；当前版本看该文顶部状态说明与 `ui/litellm-dashboard/package.json`。
- 前端 provider 目录含 Ollama / Ollama Chat，后端 `ProviderRegistry.createProvider` 没有对应分支，未知 provider 直接抛错。是要走 OpenAI 兼容路径接入，还是从目录移除，待产品确认。
- post-upstream 是否迁到 `worker_threads`：2026-11-12 提出，语料无采纳或实施记录。

## 这份文档不写什么

- 产品定位、用户诉求与能力取舍 → [产品文档](product.md)。
- 生产拓扑、外部服务、发布回滚与故障排查 → [运维文档](operations.md) 与 `$deploy-litellm-ts`。
- 授权与协作规则 → `AGENTS.md` 与[公司共同工作约定](/Users/jansen/src/liasece/OPC/organization/shared-guidance.md)，本文不复制。
- 指标语义与排查顺序 → [观测性专题](observability.md)。
