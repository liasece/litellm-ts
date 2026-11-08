# LiteLLM 上游对齐记录

本文件是 LiteLLM TS 与原版 [BerriAI/litellm](https://github.com/BerriAI/litellm) 对齐调查的维护入口。差异只分两类：**当前 TS 也存在的 BUG**与**上游新增能力**。创建以来的调查已完成；本批按用户选择实施 F02/F03/F04/F05/F06/F07/F15/F16/F19 的建议增量。范围为现有 Provider、Router 和数据库可承载的常用能力；缺少前置子系统与未采用的扩展逐条留档。业务修改位于未提交工作区；2026-10-12 经审查、修复与标准发布后已部署，验证和剩余边界见发布记录。

BUG 的入表条件是：TS 已有实际执行的对应功能；TS 当前实现可以触发相同用户问题；有源码路径和可观察证据。缺少上游子系统、实现机制不同、已具备修复行为或仅凭猜测的风险均不进入 BUG 表。相同用户问题不要求 Python 与 TS 的函数结构完全一致，但必须写清触发范围。

功能新增以本次 171 条官方 Release 声明为范围，展开回补的原始功能 PR，并补入未标 feat 的新增 API、兼容能力及模型数据；按能力而非 PR 数作采用决定。完整逐条清单在 [upstream-features.md](upstream-features.md)，每行保留上游链接、合并日期、发布证据和添加建议。**模型数据更新、分步实现和 backport 不等于独立新功能**。未发布且未被这些发布线引用的 main 改动不在本次完整功能清单范围。

## 本次基准与范围

| 项目 | 基准 |
| --- | --- |
| 调查日期 | 2026-10-11，Asia/Shanghai |
| 扫描窗口 | **项目创建 2026-05-29 09:40:23 至 2026-10-11 17:54，Asia/Shanghai**；按 GitHub Release 的 published_at 筛选，记录 PR 实际合并时间 |
| 创建证据 | origin 对应 GitHub 仓库元数据 created_at=2026-05-29T01:40:23Z；根提交 `d5c8dbe4fec34fcfb7348c0f62b8cb0a4e3eaaac` 作者时间 2026-05-29T01:40:45Z，提交者时间 2026-06-06T04:39:11Z。package.json、src/main.ts 首次加入该提交；创建起点采用仓库创建时间 |
| 上游正式版 | [v1.104.2](https://github.com/BerriAI/litellm/releases/tag/v1.104.2)，2026-10-08 发布，commit `fc3920bf403124ad075bc04990f999f7e0612e12` |
| 上游预发布 | [v1.106.0-rc.1](https://github.com/BerriAI/litellm/releases/tag/v1.106.0-rc.1)，2026-10-11 发布；[v1.106.0-dev.3](https://github.com/BerriAI/litellm/releases/tag/v1.106.0-dev.3)，2026-10-10 北京时间发布 |
| 上游 main 参考点 | `2a01fe6e5ca2ed67472ca0ed2909e66811ff8d35`，commit 时间 2026-10-11T09:01:56Z；仅作下次定位参考，不代表其全部改动均完成评审 |
| TS 源码基准 | `ef0ca0e03b2485aea0b9308d7bc42d1d7113e830`，调查开始时工作区干净 |
| 覆盖方式 | 分页获取 200 条 Release，已越过创建日期；窗口内 **171 条发布，其中正式版 101 条**。发布说明列表提取并去重得到 6302 个 PR 项目。按鉴权、路由、协议、费用、日志和管理界面筛选，之前抽样 53 项主题，现已改为 9 项验证成立的 BUG 和 50 个新增能力组；逐条索引列 1420 个原始功能/数据 PR，60 个回补或纯工程条目单独审计；不是逐条验证所有 BUG PR |
| 本地 Python checkout | 停在 `df8fd09d4d`，2026-05-28；本次上游事实使用在线官方 Release、PR 与固定 tag 文件，没有更新这个 checkout |
| 验证边界 | 源码调查、回归测试、完整后端 Jest、类型检查、构建与 9 个隔离探针；详见下方实施验证记录。2026-10-12 已补充生产 API 与真实协议调用验证；未证明所有 Provider/协议等价 |

补查完整 PR 元数据后，原来的 6302 个引用中，6298 个可以解析为 PR，4 个不是 PR；其中 136 个在项目创建前合并，不能作为创建以来的新增功能，1 个合并时间超过固定截止点。窗口内直接解析出 6161 个已合并 PR，另按 backport 正文展开其原始功能。新增清单含 1143 个 feat 标注/正文确认条目、277 个其他标注的能力与数据新增，共 1420 个原始 PR，归入 50 个能力组。工程维护与回补重复 60 条保留审计来源，不计为新增功能。

项目 Git 中存在创建后的自身 feat/fix 开发，判断以当前 TS 源码为准。根提交作者时间与 GitHub 创建时间接近，6 月 6 日的 committer 时间不作为创建起点。初始 Python 精确 commit 未被证明，不能把所有创建后上游行为都视为 TS 缺失。

## 一、BUG 修复：当前待办与已对齐历史

入表判断采用调查基准中的真实复现，不把功能空缺计为 BUG。[隔离诊断探针](upstream-alignment/verify-bugs.cjs) 已改为断言当前状态；合成 Provider、内存 DB、loopback HTTP 不涉及真实供应商或生产。[本批探针结果](upstream-alignment/implementation-probes.json) 保存 7 项修复及 2 项保留问题的证据。

### 当前仍存在的 BUG（本批未选范围）

| ID / 原建议顺序 | 上游修复 | TS 对应功能 | 修复前证据（调查基准） | 原源码依据与边界 | 本批当前状态 |
| --- | --- | --- | --- | --- | --- |
| BUG-06 / 优先 | [#35423](https://github.com/BerriAI/litellm/pull/35423)；v1.96.0；混合 feature 与修复 | 客户端 optionalParams 透传、mock_testing_* 运行时派发 | 未配置开启开关，mock_testing_rate_limit_error=true 仍触发实际 RateLimitError，未在请求门禁返回 400 | [ChatCompletionsEndpoint.ts](../src/proxy/ChatCompletionsEndpoint.ts)、[Router.ts](../src/router/Router.ts)、[RouterMockTesting.ts](../src/router/RouterMockTesting.ts)。本探针确认该参数；其他受控参数需实施时覆盖。新增统一配置开关列于 F21，已有路径未门禁属于本 BUG | 仍存在，待 F21 单独实施：客户端 mock_testing_* 门禁不在这 9 个采用组。 |
| BUG-07 / 随后 | [#42097](https://github.com/BerriAI/litellm/pull/42097)；v1.104.0 | 已执行的预算鉴权 | spend=10、max_budget=10，现有 checkBudget 抛 HTTP 429；预算耗尽仍冒充限流错误，可能引发无效重试 | [AuthChecks.ts](../src/auth/AuthChecks.ts)。对齐 budget_exceeded 默认 422，兼容配置允许旧 429；真实 RPM/TPM 仍为 429。公共错误契约变更需覆盖其他主体与 reservation | 仍存在，待 F14/F21 单独实施：预算错误 422/兼容 429 的公共契约未改。 |

### 已修复历史（只对已验证路径标记）

| ID / 原建议顺序 | 上游修复 | TS 对应功能 | 修复前证据（调查基准） | 原源码依据与边界 | 本批当前状态 |
| --- | --- | --- | --- | --- | --- |
| BUG-08 / 优先 | [#31469](https://github.com/BerriAI/litellm/pull/31469)、[#31810](https://github.com/BerriAI/litellm/pull/31810)；v1.92.0 | Key 对象授权与 permissions 存储/编辑 | 使用真实 AuthorizationGuard 和 /key/update，自己的 internal_user Key 写 permissions 返回 HTTP 200，内存 DB 收到特权字段 | [AuthorizationGuard.ts](../src/auth/AuthorizationGuard.ts)、[KeyManagementEndpoint.ts](../src/management/KeyManagementEndpoint.ts)。对象可编辑不等于能写管理员专属字段；只确认字段写保护缺失，不声称所有写入权限都已用于执行。缺省保留，显式 {} / null 与非空值均需相同门禁 | 已修复：非管理员写 permissions 返回 403，DB 未写特权字段；字段缺省保留。 |
| BUG-05 / 优先 | [#32083](https://github.com/BerriAI/litellm/pull/32083)；v1.92.0 | Provider 错误、fallback 错误与 API 错误响应 | 合成供应商错误含当前 deployment 配置的占位 key，穿过 Router 和 API 映射器后仍包含完整值 | [RouterExecution.ts](../src/router/RouterExecution.ts)、[ErrorResponseMapper.ts](../src/core/api/ErrorResponseMapper.ts)、[CooldownMasking.ts](../src/router/CooldownMasking.ts)。确认字符串内凭据未脱敏；不声称 TS 支持上游同样的 inline fallback dict。保留模型/错误类型等诊断信息 | 已修复指定路径：配置秘密从公开错误文本和详细上游错误负载中移除，保留错误类别与代码。 |
| BUG-01 / 优先 | [#39859](https://github.com/BerriAI/litellm/pull/39859)；v1.101.0 | 流式请求与 least-busy 活跃计数 | 返回 stream 时尚未消费任何 chunk，activeRequests 已从 1 减为 0，长流被当作空闲 | [RouterExecution.ts](../src/router/RouterExecution.ts)、[RoutingStrategies.ts](../src/router/RoutingStrategies.ts)。计数绑定消费/关闭/错误/断开生命周期，恰好释放一次；未以此宣称当前 deployment max_parallel_requests 已完整执行 | 已修复：消费前 active=1；消费、取消或失败后恰好释放一次，增加部署并发拒绝。 |
| BUG-09 / 优先 | [#42283](https://github.com/BerriAI/litellm/pull/42283)；v1.104.0 | 普通 Router 的流式响应与多候选 fallback | 配置 primary → [fb1, fb2]；primary 失败后进入 fb1，fb1 在首个有效输出前失败，只访问 primary、fb1，没有访问 fb2 | [RouterStreamWrapper.ts](../src/router/RouterStreamWrapper.ts)、[RouterExecution.ts](../src/router/RouterExecution.ts)。本次复现普通 Router 路径，未推广为所有 Messages/CLIProxy 都同样失败。保存原组/已尝试集合；已输出有效内容后不能重放 | 已修复普通 Router、Chat 与能力流式路径：primary → fb1 → fb2，首有效输出前失败可继续；已下发答案内容后不重放。判据见 [StreamOutputVisibility.ts](../src/router/StreamOutputVisibility.ts)：包络块、思考增量（reasoning/thinking）与错误透传块都不算锁定候选，只有正文/拒绝/工具调用增量才真的终结 fallback 空间（生产 request b28e4807 首个可见增量前断流、request f2dd8cd7 思考增量之后断流，两次都因此没 fallback）。 |
| BUG-02 / 随后 | [#35483](https://github.com/BerriAI/litellm/pull/35483)；v1.96.0 | 全局、deployment 重试及请求参数透传 | deployment.num_retries=2，请求 num_retries=0，实际执行 3 次 | [RouterExecution.ts](../src/router/RouterExecution.ts)。请求 0 必须关闭重试，缺省才继承；完整 header/body/deployment/global 优先级需实施时验收。本次只证明 body override 失效 | 已修复：显式 num_retries=0 仅调用一次；缺省继承部署和异常类别策略。 |
| BUG-03 / 随后 | [#40202](https://github.com/BerriAI/litellm/pull/40202)；v1.102.0 | 流式 TTFT 与 latency-based routing | 实际首 chunk 晚 400ms，wrapper 提前返回的 TTFT 仍为 0；另向 Router 提供 100ms、10 输出 token，记录为 10ms | [RouterStreamWrapper.ts](../src/router/RouterStreamWrapper.ts)、[RouterExecution.ts](../src/router/RouterExecution.ts)。首 token 到达时更新真实 TTFT，流式不能除以输出 token；非流式耗时口径独立处理 | 已修复：延迟首 chunk 报告 400ms，提供 100ms/10 token 仍记录 100ms；增加最近 10 个样本的可选分位数。 |
| BUG-04 / 随后 | [#39663](https://github.com/BerriAI/litellm/pull/39663)；v1.101.0 | 上下文窗口调用前预检 | max_input_tokens=100，工具 schema 20106 字符，仍只估算消息为 11 token，Provider 被调用 | [Router.ts](../src/router/Router.ts)、[RouterExecution.ts](../src/router/RouterExecution.ts)。本探针确认 Chat tools 漏计；Anthropic system、多模态和 Responses 要分别验证，不能一次性宣称全部复现 | 已修复指定路径：工具 schema 参与本地 tokenizer 估算，超过窗口时 Provider 调用数为 0；多模态专有附件 token 成本未计入本地文本估算。 |

预算委派的“多窗口预算”部分未列为 BUG，因为 TS 尚无对应完整功能；本次权限探针没有把单值预算提升算作上游同一个修复。仅凭类型中的 request_timeout 或 namespace 声明，也不新增一条未验证 BUG。

## 二、功能增加：完整能力分组及建议

下表每组对应逐条索引中的同名 F-ID；“条目数”是原始功能/数据 PR，不是独立功能数量，也不表示 TS 缺失数量。已有通用路径、管理桩和缺少专用 Provider 在建议中分别处理。采用前应再定位所选条目的最终版本和当前 TS 行为。

| ID | 上游新增能力与变化范围 | 原始条目数 | 是否添加的建议 | TS 核对入口 |
| --- | --- | --- | --- | --- |
| F01 模型、价格与能力数据 | 持续新增模型、价格/缓存价/区域价、上下文/能力与停用日期；新增模型名不等于新增 Provider | 312 | 建议更新固定正式版离线数据；已有远程更新，逐项核对计算器支持 | [src/cost/ModelCostMapService.ts](../src/cost/ModelCostMapService.ts) |
| F02 模型发现与信息查询 | Anthropic/Codex 模型发现、service_tiers、display_name、可发现/健康过滤、未注册模型信息和公共模型 Hub | 14 | 建议添加客户端兼容与 /utils/model_info；过滤/公共 Hub 按需要 | [src/proxy/ModelsEndpoint.ts](../src/proxy/ModelsEndpoint.ts) |
| F03 Chat 与工具参数兼容 | 新模型 reasoning/effort、tool streaming、系统消息排序、cache breakpoint 和 provider 参数映射 | 13 | 建议对当前 Provider 逐项补齐；不认定通用透传已经覆盖全部 | [src/providers/OpenAICompatProvider.ts](../src/providers/OpenAICompatProvider.ts) |
| F04 Responses API 扩展 | Responses input_tokens、新的 supported_endpoints 原生 opt-in、Fireworks/Bedrock 原生 Responses 分发 | 4 | 建议先加 input_tokens 与原生兼容；持久化、后台和续接另定范围 | [src/proxy/ResponsesApiEndpoints.ts](../src/proxy/ResponsesApiEndpoints.ts) |
| F05 Claude Code、Codex、Cursor 网关 | Claude-shaped 模型 ID、gateway 协议、OAuth/刷新撤销、Cursor 模型后缀、coding-agent 发现 | 8 | 建议添加有实际客户端需求的协议；已有 CLIProxy 路径需复用 | [src/cliproxy/CliProxyNativeResponsesEndpoint.ts](../src/cliproxy/CliProxyNativeResponsesEndpoint.ts) |
| F06 SSE 心跳 | 全局及 deployment SSE keepalive，等待首 token/工具执行期间 ping | 2 | 建议添加到普通 Chat/Messages/Responses；CLIProxy 已有局部实现 | [src/proxy/ChatCompletionsEndpoint.ts](../src/proxy/ChatCompletionsEndpoint.ts) |
| F07 路由策略与参数 | 上下文 compact-to-fit、标签 required/deny、分组 priority、percentile TTFT、deployment cooldown/并发拒绝、模型额度发现 | 12 | 建议选择性添加；先修现有路由 BUG，再新增策略 | [src/router/RoutingStrategies.ts](../src/router/RoutingStrategies.ts) |
| F08 自动分类路由 | LLM/heuristic v2/hybrid/capability/Fuse/Jev/custom classifier，复杂度档位及虚拟 routing group | 13 | 按实际需求分期添加；当前没有完整 classifier 执行链 | [src/router/Router.ts](../src/router/Router.ts) |
| F09 自动路由调优与管理 | 语义关键词、自定义维度/提示词/档位、模态、上下文升级、会话/部署 affinity、reasoning/fast、测试与授权 | 64 | 随 F08 采用；默认会话 affinity 曾调整，不逐个叠加历史默认值 | [src/router/Router.ts](../src/router/Router.ts) |
| F10 Shadow evaluation | 盲评、反向/多 router、多 Key/Team/User/model-group、工具回合、费用与预算、流量影子分发 | 12 | 暂缓；需要真实自动路由评估目标、额外费用和隐私边界 | [src/router/Router.ts](../src/router/Router.ts) |
| F11 预算政策与窗口 | 多窗口独立账本、重置时间、rollover、团队/模型组共享预算、临时额度、预算耗尽节流 | 18 | 按预算需求添加；多窗口要完整账本/重置/并发/UI，不能只加字段 | [src/spend/SpendReservation.ts](../src/spend/SpendReservation.ts) |
| F12 限流与额度 | 输入/输出 TPM、标签/project 限流、输出预估、batch enqueued/TPD、Redis fail-closed | 12 | 建议按供应商额度需求添加；总 TPM/RPM 已有，独立桶和批次另实施 | [src/router/TPMRPMLimiter.ts](../src/router/TPMRPMLimiter.ts) |
| F13 Fallback 与拒绝策略 | Key budget_fallbacks、候选模型授权、safeguard refusal、默认策略和未知模型回退规则 | 6 | 建议先添加候选权限校验；预算/refusal 路由按需求 | [src/router/FallbackHandler.ts](../src/router/FallbackHandler.ts) |
| F14 新计费与成本诊断 | 未定价阻断、零费用分类计数、off-peak、按秒/PTU、分项成本、cache 成本预测与账单捕获率 | 15 | 建议添加未定价可选阻断和诊断；PTU/新价格模式按真实合同 | [src/cost/CostCalculator.ts](../src/cost/CostCalculator.ts) |
| F15 SpendLogs 内容控制 | metadata include/exclude、call/trace/session 关联、生命周期/router/预算/错误信息与日志脱敏 | 17 | 建议添加 metadata 控制与可诊断信息；保留账务上下文 | [src/spend/SpendTracker.ts](../src/spend/SpendTracker.ts) |
| F16 费用分析与 Usage API | caller-scoped 报表、按主体有界查询/搜索/导出、prompt-cache/auto-router savings 和模型/agent 聚合 | 12 | 建议添加有界查询与必要导出；自动路由 savings 随执行链 | [src/proxy/AnalyticsEndpoints.ts](../src/proxy/AnalyticsEndpoints.ts) |
| F17 指标、Tracing 与日志集成 | OTEL 语义/metrics、Prometheus labels/独立端口、Arize/Phoenix/Langfuse/NewRelic/Datadog/PointFive/Zerobus 等 | 61 | 按现有监控体系选择；不同时接入全部回调和存储 | [src/core/utils/logger.ts](../src/core/utils/logger.ts) |
| F18 告警与通知 | Teams/Slack、用户 spend 异常、成员预算百分比、邮件/SMTP/GCC High、自托管邮件配置 | 9 | 按告警渠道添加；先确定发送、脱敏、去重与失败处理 | [src/proxy/AlertingEndpoints.ts](../src/proxy/AlertingEndpoints.ts) |
| F19 Key、Team、User、Org 管理 | REST PATCH、bulk users/members、状态/过期/alias 搜索、软预算、service account、custom_key_policy | 24 | 建议添加常用查询与编辑协议；权限和预算委派必须同时验证 | [src/management/KeyManagementEndpoint.ts](../src/management/KeyManagementEndpoint.ts) |
| F20 企业身份与访问控制 | SSO/SAML/OIDC/SCIM、JWT team/key/agent 映射、end-user/resource 权限、claim 回退 | 16 | 按企业身份需求实施；SCIM/SSO 当前为桩，缺能力不报停用 BUG | [src/auth/UserApiKeyAuth.ts](../src/auth/UserApiKeyAuth.ts) |
| F21 登录与启动安全配置 | 密码策略/泄漏检测/修改/强制重置、失败登录限速、SSO-only、master key 检查、mock 门禁 | 10 | 建议添加实际登录和客户端测试参数门禁；外部泄漏检测按部署需求 | [src/proxy/LoginEndpoints.ts](../src/proxy/LoginEndpoints.ts) |
| F22 凭据、密文与 Secret Manager | display_name/不可变引用名、AES-GCM 版本迁移、OIDC workload federation、Vault/KMS/Conjur、FIPS | 15 | 建议加展示名；密文迁移/Secret Manager/联合身份需实际互操作需求 | [src/credentials/CredentialService.ts](../src/credentials/CredentialService.ts) |
| F23 MCP 执行与发现 | session 路由、工具发现/调用/search、catalog 分页、版本/能力、描述/schema 安全、转换和会话管理 | 35 | 按需求新建真实执行子系统；现有管理桩不足以移植补丁 | [src/proxy/MCPEndpoints.ts](../src/proxy/MCPEndpoints.ts) |
| F24 MCP OAuth 与身份委派 | OAuth M2M/OBO/ID-JAG、DCR bridge、PKCE/resource/introspection/RS256、跨实例刷新、client credentials | 45 | 随 MCP 执行添加；先定义 caller 与 upstream credential 边界 | [src/proxy/MCPEndpoints.ts](../src/proxy/MCPEndpoints.ts) |
| F25 MCP 权限、额度与接入安全 | Key/Team/access group/tool/client allowlist、RPM/concurrency、env/Extra Headers、stdio 默认禁用 | 15 | 启用 MCP 时必需；暂不给当前桩追加表面配置 | [src/proxy/MCPEndpoints.ts](../src/proxy/MCPEndpoints.ts) |
| F26 Guardrail 供应商集成 | Cisco AI Defense、Purview、Headroom/Compresr、Straiker、DeepKeep、Alice、Conduct、TypeSafe、Akto 等 | 24 | 按风险和供应商选择；先落地可用执行链 | [src/proxy/PolicyEndpoints.ts](../src/proxy/PolicyEndpoints.ts) |
| F27 Guardrail 与 Policy 执行能力 | logging_only input/output、并行/stream/后台 hooks、工具改写/PII/附件/vector chunk 扫描、优先级/fallback 策略 | 33 | 需先实现真实 hook，再按场景采用；管理 API 桩不算支持 | [src/proxy/PolicyEndpoints.ts](../src/proxy/PolicyEndpoints.ts) |
| F28 Web Search | TinyFish/Nimble/Bing/AgentCore、objective+multi-query、拦截配置、权限默认拒绝 | 10 | 按搜索需求添加；已有查询路由不代表所有上游执行 Provider | [src/proxy/SearchToolsEndpoints.ts](../src/proxy/SearchToolsEndpoints.ts) |
| F29 Vector Store、RAG、Skills | Valkey/MongoDB 搜索/sidecar、indexes、上传权限、语义 Agent Skills 与 well-known 注册 | 11 | 按需求新建；当前向量库和 Prompt 管理多为桩 | [src/proxy/VectorStoreEndpoints.ts](../src/proxy/VectorStoreEndpoints.ts) |
| F30 Agent、A2A 与 SDK 工具循环 | LangFlow/Watsonx/Foundry/Databricks/AgentCore、agent card/identity/permissions/kill switch、agent()/run_tool_loop | 14 | 暂缓；需要 Agent 产品与身份/费用执行契约 | [src/proxy/AgentEndpoints.ts](../src/proxy/AgentEndpoints.ts) |
| F31 代码执行与沙箱 | E2B/OpenSandbox、Chat/Responses code interpreter、按 session 复用 | 5 | 暂缓；引入隔离执行、费用与生命周期管理 | [src/proxy/OCRVideoContainerEndpoints.ts](../src/proxy/OCRVideoContainerEndpoints.ts) |
| F32 Files 与 Batches | managed files/类型与数量限制、跨团队隔离、provider 批处理、下载/取消、费用/退款/后台结算 | 18 | 按真实批量任务需求添加；先核对每个入口的执行实现 | [src/proxy/BatchesEndpoints.ts](../src/proxy/BatchesEndpoints.ts) |
| F33 Audio、Speech 与 Realtime | Chirp/Gemini/xAI/Meta/Mistral 音频、Deepgram WebSocket、Transcribe/Azure Speech、duration 计费 | 12 | 按供应商和语音需求添加；通用 Audio/Realtime 路由不等于专用适配 | [src/proxy/AudioEndpoint.ts](../src/proxy/AudioEndpoint.ts) |
| F34 Image、Video 与 OCR | Fal/Dashscope/Azure/Vertex 图像/编辑/视频、Mistral/Cohere/Textract/Reducto 等 OCR 原生格式 | 24 | 按需求增加专用 Provider；Image 已有部分，OCR/Video 多为桩 | [src/proxy/OCRVideoContainerEndpoints.ts](../src/proxy/OCRVideoContainerEndpoints.ts) |
| F35 新增 Provider 与专用兼容 | SCX/Cortecs/Reka/Prism/EdenAI/Sail/Nadir/Meta/Tencent/GDC 等及 Fireworks/Together 专用参数 | 28 | 通用 OpenAI-compatible 优先复用；专用鉴权/协议按需求添加 | [src/providers/ProviderRegistry.ts](../src/providers/ProviderRegistry.ts) |
| F36 云 Provider 原生能力 | Bedrock Converse/Mantle/native Responses、Azure/Vertex/Foundry、SigV4/STS/tags/区域/structured output | 32 | 有对应云需求再添加；TS 当前没有这些专用实现 | [src/providers/ProviderRegistry.ts](../src/providers/ProviderRegistry.ts) |
| F37 Caching | Valkey/Redis/Qdrant semantic cache、end-user scope、prompt caching 自动断点/Key 开关/预测 | 14 | 建议先添加 prompt caching；semantic backend 按命中场景和隔离需求 | [src/providers/AnthropicProvider.ts](../src/providers/AnthropicProvider.ts) |
| F38 Dashboard 管理能力 | Key/Team/Org/credential/路由/供应商配置、权限/预算字段、批量操作和服务端来源展示 | 88 | 按已实现后端逐项添加；不能只复制未工作的上游表单 | [src/management/ModelManagementEndpoint.ts](../src/management/ModelManagementEndpoint.ts) |
| F39 Dashboard Usage 与 Logs | 日志过滤/deep links/session/cache/batch、指标/导出/Guardrail monitor 与 savings | 44 | 建议添加常用过滤和链接；特殊分析依赖后端能力 | [src/proxy/AnalyticsEndpoints.ts](../src/proxy/AnalyticsEndpoints.ts) |
| F40 Dashboard Chat 与 Playground | 流/非流、headers、请求指标、聊天 Key/Usage、Decisions 表单/预设/示例 | 13 | 建议按调用需求补齐；Decisions 控件随 F44 | [src/proxy/ChatCompletionsEndpoint.ts](../src/proxy/ChatCompletionsEndpoint.ts) |
| F41 Dashboard 导航、主题与表格 | Cmd+K、URL 状态/页面路径、table 搜索/筛选/列/选择、主题/logo、Home 和关联导航 | 64 | 建议常用导航与 URL 状态；技术组件迁移按 TS UI 约束 | [src/proxy/DiscoveryEndpoints.ts](../src/proxy/DiscoveryEndpoints.ts) |
| F42 CLI 与开发者接入 | lite login/keychain/PKCE/configure、coding-agent 包装、模型同步、debug/report、VS Code extension | 26 | 按客户端接入需求添加；不复制 Python entrypoint 机制 | [src/main.ts](../src/main.ts) |
| F43 Lens、LiteAdmin 与 ROI 产品 | trace investigation/worker/datasets/feedback、Slack/LiteAdmin 助手、Moyai/ROI 产品 | 49 | 暂缓；新增运维分析产品和 ClickHouse/Rust/worker 依赖，集成式 ROI 已撤销 | [src/proxy/AnalyticsEndpoints.ts](../src/proxy/AnalyticsEndpoints.ts) |
| F44 Decisions 与 System One | /v1/decisions、/v1/systemone；OpenAI/TypeSafe/Microsoft-Decision-1/Databricks/hosted_vllm/Strands Decider | 9 | 有 decision 调用需求再添加；当前没有 API/Provider，不能只加 UI | [src/providers/ProviderRegistry.ts](../src/providers/ProviderRegistry.ts) |
| F45 Proxy 配置与 HTTP 运维能力 | response headers、root_path、reload/source/config sync、gzip/HTTP2、custom auth 检查、请求投影 | 18 | 建议选择有需求的小功能；已有 Express compression 等先排除重复实现 | [src/main.ts](../src/main.ts) |
| F46 健康、排空与容量控制 | /health/drain、worker admission、有界排队、健康保留/allowlist、过载行为 | 6 | 建议有界 drain/admission；需覆盖 SSE/断开/readiness，生产配置另授权 | [src/proxy/HealthEndpoint.ts](../src/proxy/HealthEndpoint.ts) |
| F47 数据库与账务基础设施 | SpendLogs partition/retention、lock/statement 时间、PgBouncer/Entra IAM/副本、sidecar spend 与账本写入 | 8 | 规模和数据库需求驱动；当前单事务账务，不复制 Python 异步批次机制 | [src/spend/SpendTracker.ts](../src/spend/SpendTracker.ts) |
| F48 部署与基础设施功能 | Helm/Terraform、独立 Redis/metrics/HPA、Quickstart Docker/Windows、一键 gateway+DB+UI | 29 | 参考运维目标；不直接复制到当前部署，不属于业务复刻 | [src/main.ts](../src/main.ts) |
| F49 Rust 核心、原生后端与 SDK 架构 | Rust OCR/router/realtime/tokenizer/secret/cache/tracing 与独立打包/开关 | 74 | 不建议整体复刻；TS/Node 先复用现有运行时，仅性能证据充分时引入原生依赖 | [src/main.ts](../src/main.ts) |
| F50 Interactions API | Vertex 原生 Interactions、background interaction 跨实例计费、queued 状态扩展 | 3 | 有 Google agent/interaction 需求再添加；当前无专用执行 Provider | [src/proxy/GoogleEndpoints.ts](../src/proxy/GoogleEndpoints.ts) |

重点采用建议是 F02 模型发现/信息查询、F04 input_tokens、F06 SSE 心跳、F13 fallback 权限、F14 未定价阻断/零费用诊断、F15 metadata 控制、F37 prompt caching 和 F41 常用导航。它们不等于本次全部授权实施的清单。自动路由、多窗口预算、MCP、Guardrails、Agent、沙箱和 Lens 等需明确范围再实施。

调查基准的内置价格 JSON 与 v1.104.2 固定 SHA 的比较：TS 3010 个顶层键，上游 4382 个；新增 1678 个键、共同键中 1240 个值变化、旧快照独有 306 个键。键包含元数据/别名，不是可调用模型数。ModelCostMapService 已能加载 main 远程价格；没有访问生产 effective source，因此未报告“线上价格过期”BUG。

## 本批实施结果（2026-10-11）

实现基准仍为 `ef0ca0e03b2485aea0b9308d7bc42d1d7113e830`，实现游标是该基准上的未提交工作区。发布扫描游标保持 2026-10-11 17:54 北京时间，不因实现完成而移到最新 main。逐条采用状态见 [功能索引](upstream-features.md) 中相应组的“本批实施状态”列；不能将组内所有 PR 标为完全对齐。

| 项目 | 已实现、可观察结果 | 保留的能力边界与原因 | 验证入口 |
| --- | --- | --- | --- |
| F02 模型发现 | Anthropic/Claude Code 列表形状、配置 display_name、Codex service_tiers；Key/Team 模型权限交集、discoverable=false；GET /utils/model_info 查询未注册模型 | 未采用健康过滤、公开 Hub、leaderboard、access_windows 与回调过滤；它们涉及独立公开入口、时间授权或 callback 执行契约。Anthropic 列表当前一次返回，无分页 | ModelsEndpoint.test.ts、UtilEndpoints.test.ts |
| F03 Chat 参数 | prompt_cache_retention；新 Claude adaptive thinking 与旧模型 effort 转换；支持 drop_params 的采样参数清理；透传有限的上游 usage.cost | 从固定 v1.104.2 数据选取 8 个当前 OpenAI/Anthropic 模型能力条目，非全量价格表同步；未新增 Gemini/AIML/W&B Provider。未生成上游未返回的成本，也未复刻 calculate_response_cost 选项 | UpstreamCompatibility.test.ts、ChatStreamingSpendLog.test.ts、ResponsesApiEndpoints.test.ts |
| F04 Responses | /v1/responses/input_tokens（另有 /responses/input_tokens 与 /openai/v1/responses/input_tokens）；OpenAI-compatible supported_endpoints 原生 opt-in；选中部署的地址/凭据固定，默认 store=false | token 计数是本地 cl100k 估算，覆盖 instructions/input/tools，不把图片/音频/文件 base64 当作正文计数，且不含供应商专有的附件 token 成本；不调用模型、不预占费用；stored conversation/previous_response_id/prompt 计数拒绝。Fireworks/Bedrock 专用协议鉴权与存储/后台/续接未新增 | ResponsesInputTokens.test.ts、UpstreamCompatibility.test.ts、UpstreamRoutingRegression.test.ts |
| F05 编程客户端 | Claude-shaped 模型 ID 可逆转换，调用前解析为已配置模型；Cursor thinking/fast 后缀与 Chat/Responses 分流；Codex UA 默认 drop_params；/v1/messages 原生 opt-in | 复用现有 CLIProxy；未新增 Copilot Provider、Claude OAuth 网关/刷新撤销、Claude 插件 zip 分发。它们需要专用身份或客户端插件子系统 | CodingClientModels.test.ts、UpstreamCompatibility.test.ts、CoreProxyAliasRoutes.test.ts |
| F06 SSE 心跳 | 全局与部署配置、默认禁止客户端覆盖、部署 0 强制关闭；Chat/Messages/Responses 在连接/工具等待期间 ping；结束/断开清理；心跳后错误以 SSE 终止 | CLIProxy 保留现有局部实现。选中部署之前仅一致策略可许可客户端覆盖；mixed pool 有禁用部署则保守关闭；未做生产负载均衡器验证 | SseKeepalive.test.ts、ChatStreamingSpendLog.test.ts、AnthropicMessagesEndpoint.test.ts、ResponsesApiEndpoints.test.ts |
| F07 路由 | 修复 BUG-01/02/03/04/09；required/deny/OR 标签与请求隔离；TTFT 分位数；部署 allowed_fails_policy/cooldown_time、并发满 429；ServiceUnavailable/NotFound/Default 重试继承；消费中取消中止上游 | 标签不继承 Key/Team，不开放 fail-open；未采用有损上下文 compact-to-fit、group priority、动态额度发现或 affinity header mapping，涉及新的路由/内容变更契约。并发计数为当前 Router 实例，不是跨进程信号量 | UpstreamRoutingRegression.test.ts、ProviderRequestExecutor.test.ts、Router 现有测试 |
| F15 日志内容 | DB/YAML metadata include/exclude，费用计算后才投影；强制保留 status/cold_storage_object_key；metadata.litellm_call_id、normalized_error；配置秘密在错误中的脱敏 | 不增 DB 列；未复制企业审计默认、Sentry、OTEL/span hooks 或 OAuth 标记；请求体/响应体存储仍依现有显式开关。normalized_error 使用 TS 可得的 error_class/error_type、error_code，不宣称与 Python 聚类字符串等价 | SpendMetadataFields.test.ts、SpendTracker.test.ts、redactConfiguredSecrets.test.ts |
| F16 Usage API | caller-scoped Key/User/Team/Org 按模型报表；主体 daily/activity 聚合/CSV；日期默认 30 天且最多 366 天；页大小最多 1000；Key 搜索在分页之前并保持权限约束 | 模型报表最多 1000 组，聚合原始日志最多 10000，超出返回错误并要求缩小区间，不静默截断。CSV 导出日期和费用/token/请求总量，非全部 Key 明细；没有新增 global rollup 表、cache leakage/model_top_keys、压缩/自动路由 savings | ScopedSpendReports.test.ts、UsageQuery.test.ts、WebUiSupportEndpoints.test.ts、SpendManagementEndpoint.test.ts |
| F19 管理 API | Team REST PATCH（metadata JSON merge patch）、Org REST PATCH（metadata 替换、预算同事务）；Key alias 更新/搜索/命名规则、状态/过期过滤；BUG-08 permissions 管理员门禁 | PATCH 仅 proxy_admin；不增加 team-admin 委派或 service-account 权限。bulk users/members、custom_key_policy、access-group 对象权限、删除 Key 的 /key/info 与完整 OpenAPI 发布未采用；常用字段外 strict schema 拒绝 | EntityPatchEndpoints.test.ts、KeyAliasPolicy.test.ts、KeyManagementEndpoint.test.ts、AuthorizationGuard.test.ts |

新增行为无需数据库迁移。仅新增数据和 API 的配置值示例（先在开发/测试配置中启用；这不是生产写入）：

```yaml
litellm_settings:
  sse_keepalive_ping_interval_seconds: 15
  enable_key_alias_format_validation: true
  key_alias_pattern: '[A-Za-z0-9_.-]+'
general_settings:
  spend_logs_metadata_fields:
    exclude: [proxy_server_request, usage_object]
router_settings:
  routing_strategy_args:
    ttft_percentile: 0.9
model_list:
  - model_name: my-model
    litellm_params:
      model: openai/provider-model
      supported_endpoints: ['/v1/responses', '/v1/messages'] # 仅真实支持这些协议的 endpoint
      keepalive_seconds: 10 # 0 强制关闭，负数亦视为关闭
      allow_client_keepalive_override: false
      max_parallel_requests: 4
      tags: [default, eu, fast]
    model_info:
      display_name: My Model
      discoverable: true
      service_tiers: [default, priority]
```

DB 配置覆盖 YAML 默认值，读取时保留显式 false/0；metadata 策略和 Key alias regex 在启动与保存时校验。metadata include 与 exclude 互斥，不影响计算费用或预算预占所需的源上下文。上面配置仅示范新增键，省略连接配置，不能直接当作可运行 deployment。

## 未进入 BUG 表的判定留档

以下用于防止下次重新把功能空缺或不同机制误报成 BUG，不构成待修复问题清单：

- 原 AUTH-01 / #42064：SCIM active 停用契约未实现，SCIMEndpoints 为桩；没有证明 TS 已有可操作的用户停用功能却继续放行。身份新增能力在 F20。
- 原 SPEND-01 / #45273：TS 为单个 PostgreSQL transaction，不是上游 Redis buffer/batch flush；没有复现同一个批次丢失问题。
- 原 COST-02 / #45472、HIST-03 / #31021/#35491：TS 自定义价走请求上下文且优先，没有上游 register_model 共享覆盖写路径；没有复现自定义价污染。
- 原 HIST-01 / #29273：动态部署存在，部署级 budget limiter 不存在；不能把“没有 limiter”报告成“已有 limiter 在动态模型失效”。
- 原 HIST-04 / #31119：存在 deployment 超时，但两层 router/request deadline 没有完整执行；本次未复现上游同一生命周期超时问题。
- 原 HIST-17 / #32536、HIST-19 / #37558、ROUTER-02 / #45393：namespace 已部分转换、流式部分费用已记账、CLIProxy 有独立原生 fallback；本次没有确认工具历史相邻关系、主动 disconnect 记账或跨加密边界失败，不报告。
- 原 RESP-01 / #45322：普通 previous_response_id/store/background 返回 501，不是已实现持久化续接后指令破坏工具相邻关系。不得把该修复重新归为“本期新增持久化功能”。
- 原 COST-01 / #42345 是新增零费用诊断能力，归 F14；未证明已定价请求在 TS 错误记成 0，不报告计费 BUG。
- 原 MCP-01 / #45401、LOG-02 / #45132、AUTH-03 / #44130：分别没有真实 MCP 执行转发、没有对应 Python regex、没有对应用户 memo 缓存；不报告上游同机制问题。
- 原 BUDGET-02 / #40322、AUTH-02 / #42036、STREAM-01 / #42323、ANTHROPIC-01 / #42152、CRED-02 / #42291、HEALTH-01 / #44982：此前源码与相关现有测试证明所列关键行为已有或机制不同；没有新的失败证据，不进入 BUG 表。
- HIST-09 / #32032 的 teamless denial 撤销已核对，不复制被撤销规则。功能索引另记 router_model_name、session_affinity 默认、UI 路径、ROI 和部分 release 分支 Usage 回退。

## 2026-10-12 发布前审查

用户授权 review 后部署，不包含 Git commit/push 或手工生产数据库写入。保持原工作区；本次针对上一批引入的兼容与流式生命周期回归进行修复。以下新增回归在修复前失败，修复后已包含在完整发布前测试中：

| 审查问题 | 修复与证据 |
| --- | --- |
| 未启用命名规则仍拒绝旧 Key alias | 未配置 naming policy 时保留显示名；启用后执行完整 regex。KeyAliasPolicy.test.ts 覆盖带斜杠/连续点/中文的旧 alias |
| 递归流式 fallback 重复尝试失败候选 | 全链共享已尝试模型集合，并限制候选次数；a/b/c 全部在输出前失败时仅调用 a/b/c 各一次 |
| 取消时 fallback 尚未收到响应头，无法及时中止 | 在整个流式链共享 AbortController，取消连接与读流，不继续重试其他模型；真实 AbortSignal mock 验证只访问 a/b |
| 路由 metadata.tags 被转发至供应商 | Chat/Responses/native Messages 只消费路由 tags，保留其他 metadata 和原请求；无 tags 的请求保留完整部署池，避免新默认过滤改变旧流量 |
| base64 附件被误算为文本 token | 二进制 image/audio/file/document blocks 不送入正文 tokenizer；文本及完整工具 schema 仍计数。输入估算不含供应商专有附件 token 成本，不能用于精确计费 |
| Claude 模型目录返回未编码的非 canonical 别名 | 仅 canonical claude-* ID 原样返回；其他逻辑名编码后可反向解析。3 个回归在修复前失败，覆盖 anthropic 后缀和含 claude 的自定义 alias |
| Codex drop_params 泄露到 CLIProxy 原生协议 | 线上同模型/输入 A/B：普通 UA Responses 200、Codex UA 400 Unsupported drop_params；native Responses/Chat/Messages 在发送前剔除这个网关控制参数，保留其他原生字段。3 个回归在修复前失败 |

发布前核验：后端 typecheck/build 与全量 Jest **1504 个通过、28 个跳过**（116 套件通过、3 套件跳过）；改动源文件 ESLint、9 个隔离探针与 git diff --check 通过。回归测试先证明上述问题可复现，修复后再执行完整后端检查。

全仓既有 **220 个 lint 错误**保留。Dashboard 源码、测试与锁文件均与 HEAD 相同；lint/TypeScript 通过，补充全量 Vitest **3812 通过、5 个基线失败（4 个文件）**。失败涉及重复元素查询、pageDescriptions 缺项、日志过滤调用次数、session mock；未改断言或放宽规则。本次未编辑 UI，前端修改专属门禁不适用，补充测试作为现有基线留档；标准部署脚本的 Next.js production build 已成功。

### 生产发布与核验（2026-10-12）

| 项目 | 结果与证据 |
| --- | --- |
| 发布方式 | 通过 JL3 既有标准入口 `/root/var/tools/service/ai-out-service/restart-litellm.sh`；文件为 0644，使用 Bash 调用原入口。FORCE_FULL_BUILD=1；标准后端/前端构建、镜像完整性与数据库预检均成功后切换。没有手工数据库写入、新迁移或配置变更 |
| 首轮后追加修复 | 首轮生产核验暴露 Claude 别名 ID 与 Codex drop_params 两项问题；补回归并修复，再通过同一标准入口重新发布。最终以第二轮结果为准 |
| 实现基准 | HEAD `ef0ca0e03b2485aea0b9308d7bc42d1d7113e830` + 未提交工作区。378 个 src/构建输入文件的 SHA256 摘要 `3544cd49ab2f1acb9062d1289c1b52db0e0d57beaf41ec47e2979fc7c7c88894`；发布期间源码摘要一致 |
| 最终生产镜像 | `sha256:217812005c68c5e232716d6b37acc84a467c9d1132e710a3b2ca9a69a8f210d1`；litellm-prod 启动于 2026-10-12 10:01:57（Asia/Shanghai）。标准健康检查 6 秒通过；running/healthy，重启 0，OOM=false |
| 真实 Provider 调用 | gpt-6-luna 的 Codex UA Chat、Responses 非流式均 200 并有 usage；Responses SSE 有 ping 与 completed/incomplete 终态，无 error；glm-5-turbo-anthropic 经 Claude 编码 ID 反向解析后，Messages SSE 200，有 message_start/message_stop，无 error。合成测试请求只要求 Reply OK，不使用用户业务内容 |
| 发现与估算 API | OpenAI 模型目录及 Claude 原生目录 200；Claude ID 全部符合 claude 命名；model_info 与 Responses input_tokens 200，字段形状有效 |
| 日志与 Usage API | spend/logs/ui、key/spend/report、team/daily/activity/aggregated、team/daily/activity/export 均 200，分别验证分页、数组、results 与 CSV 形状 |
| 管理 API | key/list status/expiry 筛选、config/list general_settings 查询均 200。生产只做查询，管理写入和事务失败回滚以开发回归验证，不以只读 smoke 冒充生产写入验证 |
| 公网入口 | `https://litellm.gamefantasy.com/health/liveliness` 与 `/ui/?page=logs` 均 200 |
| 发布证据 | JL3 受限日志 `/tmp/litellm-ts-deploy-20261012-second.log`（0600）；开发检查日志位于容器 `/tmp/litellm-upstream-review-20261011/final2-*.log`。日志原文包含运维上下文，不复制到此记录 |

已有模型配置中的 gpt-5.4-mini 不在当前 CLIProxy 实际模型目录中，调用返回 unknown provider；没有修改既有配置或新增其上游支持。本次真实调用选用目录中存在的 gpt-6-luna，不把过期别名可用性算作通过。所有 Provider、生产管理写入、真实慢流超过心跳间隔与实际 fallback 故障切换没有逐一生产验证；相应已实现路径有合成回归，仍须按后续具体场景验证。BUG-06/07 和未选功能的状态保持原记录。

没有 Git commit/push；原始发布前镜像保留。若恢复需要使用已确认的旧镜像及原配置/数据，按部署 Skill 的恢复流程执行；本次未执行回退。

## 验证、实施与恢复边界

修复探针验证当前正确结果，并明确保留 BUG-06/07 的旧行为。新增回归测试覆盖用户可观察的调用、流式生命周期、费用日志、模型发现、权限及事务失败回滚；前端未修改；本批开发验证不包含全部真实 Provider、生产数据与负载均衡行为，后补生产 smoke 的具体范围以发布记录为准。

本批验证（开发容器，2026-10-11）：

| 检查 | 结果与限制 |
| --- | --- |
| `npm run typecheck` | 通过；末次协议 transport 字段过滤后已重跑 |
| `npm test` | 115 个套件通过，3 个跳过；1491 个测试通过，28 个跳过；跳过项不算验证完成 |
| 末次 Provider 协议检查 | 原生 Responses transport 参数清理后，额外重跑 UpstreamCompatibility、ResponsesApiEndpoints、AnthropicMessagesEndpoint，全部通过 |
| `npm run build` | 后端 production build 通过；前端未改、未构建 |
| 修改源文件 ESLint | 独立检查通过；没有放宽配置 |
| `npm run lint` | **未通过：220 个既有错误**。错误全部位于 12 个与 HEAD 内容相同、本批未改的文件；不是本批新增失败 |
| 隔离诊断 | `node --check` 及 9 项探针全部通过：7 项修复结果、2 项保留问题；结果 JSON 已保存 |
| `git diff --check` | 通过；106 行所选功能表结构检查通过 |

全仓 lint 的基线文件：CliProxyResponsesExecution.ts、ProtocolErrorResponse.ts、SchemaPreflight.ts、CostCalculator.ts、ModelManagementEndpoint.ts、CliProxyProvider.ts、ModelsPageSupportEndpoints.ts、modelGroupBuilder.ts、FallbackHandler.ts、ModelOverrides.ts、ReasoningEffortOverride.ts、sessionTimeline.ts。已以 `git diff --exit-code HEAD -- <path>` 核对均未修改。它们的规则错误保留，不能把本批交付描述成全仓所有门禁绿灯。

2026-10-11 的开发命令在既有开发容器 `/root/var/src/jtllab/litellm-ts` 执行，当时未提交、未推送、未部署。2026-10-12 用户授权 review 后部署，已完成上述发布；仍未提交或推送。没有数据库迁移；若后续撤销源码，需要只移除本批修改，保留其他工作区内容及既有配置数据。

## 2026-11-03 流式 fallback 判据修正

生产 request f2dd8cd7（`commandcode/deepseek/deepseek-v4.1-flash`，upstream `terminated`）在思考增量已经下发之后断流，仍然没有 fallback。原因同上一批：`RouterExecution` 用的「已产出 chunk」判据仍然过粗，把 reasoning 增量也当成答案。

修正后按「客户端是否已经拿到答案内容」判定，实现在 [StreamOutputVisibility.ts](../src/router/StreamOutputVisibility.ts)，由普通 Router、Chat 与 Responses 能力流式三处共用：

| 类别 | 是否锁定候选 | 理由 |
| --- | --- | --- |
| 包络块（role delta、finish_reason/usage 收尾、`response.created` 等） | 否 | 对客户端没有信息量 |
| 思考增量（reasoning_content / thinking / `response.reasoning_text.*`） | 否 | 是模型的中间过程；换候选后「思考 → 答案」仍自洽 |
| 正文、拒绝文本、工具调用增量 | 是 | 已下发，重放会出现两段互相矛盾的答案或半截工具 JSON |
| 上游错误透传块 | 否 | 不是模型产出 |

新增回归在修复前失败、修复后通过：Router 层验证 primary 在思考增量后断流时仍切到 b（`UpstreamRoutingRegression.test.ts`），Responses 层验证同场景下客户端最终拿到 `response.completed` 与 fallback 的答案（`ResponsesApiEndpoints.test.ts`）。

## 2026-11-08 Cost Tracking 设置端点补全

Dashboard 的 `/ui/?page=cost-tracking` 一打开就提示读取折扣/保证金配置失败。根因不是前端：Python 有、TS 从未实现的三个端点缺失，请求落进静态资源兜底后返回 HTML 404，前端 `response.json()` 解析失败。

| 端点 | 语义 |
| --- | --- |
| `GET` / `PATCH /config/cost_discount_config` | 折扣配置（provider → 0~1 的比例），存入 `litellm_settings.cost_discount_config` |
| `GET` / `PATCH /config/cost_margin_config` | 保证金配置（provider 或 `global` → 比例，或 `{percentage, fixed_amount}`），存入 `litellm_settings.cost_margin_config` |
| `POST /cost/estimate` | 只读估算：按 `/model_group/info` 同源价格与当前折扣/保证金算出单次、日、月成本 |

计费口径对齐 Python `cost_calculator.py`：base token 成本 → 折扣（`cost *= 1 - d`）→ 保证金（provider 键优先，否则 `global`；percentage 作用于折后金额，fixed_amount 直接相加）。读取的配置是「DB 覆盖 + yaml 默认」的有效值，写入只改 DB 对应键并立即刷新进程内快照（TTL 60s 兜底）。

影响：默认空配置时计费完全不变。一旦配置，实际落账 `spend`、预算 reservation 上界、`/spend/calculate` 与 `usage.cost`（即 `x-litellm-response-cost` 响应头）使用同一函数，预算判断与实际扣费不会互相矛盾；`cost_breakdown` 只在发生调整时补 `original_cost`、`discount_percent`、`margin_percent` 等键。历史 spend 日志不会回溯重算。

验证：`CostTrackingConfig` 14 项、端点 8 项、`SpendTracker`（含 reservation 与落账口径）回归通过；2026-11-08 部署后线上 GET 返回 `200 {values:{}}`、`/cost/estimate` 给出真实价格（glm-4-7-anthropic 100 万输入 + 50 万输出 = $1.75/请求、$52.50/月）、未知模型返回 `404 Could not find pricing for model ...`，页面无错误提示，预算计算器可用。保存失败路径也在线上验证过：给本部署没有的 provider 保存折扣返回 `400` 并原样提示可用 provider 列表，前端回读服务端状态后不保留未生效的行，数据库未被写入。

恢复边界：清空方式是 PATCH 空对象或删除 `litellm_settings` 中的对应键，无需迁移；回滚代码需重新部署。provider 取值只接受本部署 `LlmProviders` 里的真实 provider（外加 `global`），WebUI 的下拉来自上游全量目录，选到本部署没有的 provider 会得到 400 并列出可用值，而不是静默无效。

## 后续维护规则

1. 先读本文件，核实当前 TS commit/工作区，再读取对应源码和上游最终 PR/固定版本。不得覆盖用户未提交改动。
2. 从本次固定截止点往前重叠至少 7 天扫描；核对 published_at 与 mergedAt，展开 backport，排除项目创建前条目，记录 dev/rc 与稳定线差异。发布游标和实现游标分别维护。
3. 新 BUG 只有“对应执行能力已存在 + 当前可触发相同问题 + 源码/行为证据”三个条件同时成立才入表。未验证风险留在调查材料，不加入用户 BUG 报告；缺少子系统不叫 BUG。
4. 新功能进入 F-ID 能力组和逐条索引。原始功能与回补关联，不重复累计功能数；工程维护不当作功能。建议明确添加/条件添加/暂缓/不添加，不能把已有行为写成待复刻。
5. 已实施后记录 TS commit、验证日期/命令、实际覆盖路径和剩余边界；只对验证成立的范围标记对齐。修复后的 BUG 移到已对齐历史，未部署单独注明。
6. 已撤销或改变默认行为时覆盖原建议并保留出处，不机械搬运每条历史 feat/fix。下次根据新证据更新表，不重复创建事实文件。
7. [旧 parity 计划](../.claude/plans/parity-fix-plan.md) 是历史上下文，不作为当前完成状态或生产授权；本记录是唯一对齐维护入口，源码与执行结果是行为事实源。

## 批次日志

| 日期 | 调查范围 | 当前结果 | 业务实施 / 部署 |
| --- | --- | --- | --- |
| 2026-10-11 首轮 | 最近 30 天，后扩展到项目创建以来 | 原 53 个抽样主题；旧表混合 BUG、空缺能力与待验证风险，已由本批次两类报告替代 | 无 / 未部署 |
| 2026-10-11 分类复核 | 固定 171 条发布窗口、完整功能标注及非 feat 新增契约，展开回补源；当前 TS 实现 | 9 个 BUG 隔离探针确认；50 个新增能力组，1420 个原始 PR 逐条建议；60 个工程/回补审计；已排除未验证风险与无对应功能的上游修复 | 无 / 未部署 |
| 2026-10-11 建议实施 | 用户选择 F02/F03/F04/F05/F06/F07/F15/F16/F19；现有 Provider/Router/DB 范围 | 9 组建议增量；7 个确认 BUG 修复，2 个未选 BUG 保留；逐条实施状态见功能索引 | 未提交工作区 / 未部署 |
| 2026-10-12 审查与部署 | 对本批兼容、流式生命周期与生产协议进行审查 | 修复 7 项本批回归；1504 后端测试通过；生产 API 与 4 条真实调用路径通过；保留已有 lint/UI 基线与上游过期别名限制 | 未提交工作区 / 已部署（最终镜像见发布记录） |
| 2026-11-08 Cost Tracking | Dashboard cost-tracking 页面报错，定位为 Python 有、TS 缺失的三个端点 | 实现折扣/保证金配置读写与 `/cost/estimate`，折扣→保证金口径接入落账、预算 reservation、`/spend/calculate` 与响应头；provider 校验限定本部署真实值 | 未提交工作区 / 已部署并线上核验 |
