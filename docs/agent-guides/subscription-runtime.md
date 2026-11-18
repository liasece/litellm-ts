# 订阅运行时（进程内）

订阅 Provider 在 LiteLLM 进程内执行。代码位置：`src/subscriptions/native/`。

## 结构

- `accountStore.ts`：扫描、写入 `CLIPROXY_RUNTIME_ROOT/auths` 下的 auth JSON；ID 为 `sha256(source + "\0" + filename)` 前 16 位；支持 `.trash`、禁用、权重与文件锁。
- `scheduler.ts`：会话亲和 + priority 分层 + 平滑加权轮询；权重 0 暂停调度，账号列表来自 `accountStore`。
  冷却按失败归属分两级：408/429/5xx 记在「账号 + 上游模型」上（同账号其他模型不受影响），
  401/402/403 与额度耗尽记在账号上（换模型也不会好，整账号避开）；额度耗尽冷却 30 分钟。
- `bridge.ts`：解析 `litellm-subscription://<source>/<operation>`，选择账号、刷新凭据、按入口/上游协议翻译请求与响应；流式响应通过有状态 translator 转换。
- `providers/`：七家 Provider 适配器（Codex、Claude、Kimi、Antigravity、xAI、CommandCode、OpenCode Go），负责路由、上游 URL/头、协议特化、目录与额度。
- `protocol/`：chat / Anthropic Messages / Responses / Gemini 的请求、响应与 SSE 转换。跨协议转换不保证字段一一对应：Anthropic 的 `output_config.format` 没有名称，转成 Responses 时由编码器补默认 `text.format.name`（`structured_output`），否则上游按缺参拒绝（Codex 报 `Missing required parameter: 'text.format.name'`）。`strict` 在 Responses 里省略即视为严格模式，而严格模式要求每个对象节点把属性列全并显式 `additionalProperties: false`；调用方多不写 `strict`，所以编码器按 schema 形态判定：可满足就显式 `true`，否则发 `false` 并保留原 schema，避免宽松 schema 被上游以 `Invalid schema for response_format` 拒掉。这里不替调用方改写 schema（那会把可选字段变成必填，改掉语义），显式 `strict: true` 也照原样保留。另外 `user` 是 OpenAI 的字段，上限 64 字符：Anthropic 入口把 `device_id/account_uuid/session_id` 打包进 `metadata.user_id`，编码器会截断后才外发，并从其中的 `session_id` 取会话标识作 `prompt_cache_key`（`user_id` 指人不指会话，直接拿它做缓存键会让同一用户的并行会话互撞）。
- `SubscriptionRuntimeManager.ts`：设置、账号、OAuth、目录、额度、日志与管理 API 的后端；管理面展示账号 `status`/`last_error`/`refresh_failures` 与最近限流快照。初始化时注册 `SubscriptionDispatch` 处理器。
- `SubscriptionSpecialEndpoints.ts`：Responses compact、alpha search、xAI 视频/语音、Gemini generate/countTokens 等非标准路径；成功请求按 deployment 写入 SpendLogs。
- `SubscriptionResponsesWebSocket.ts`：`/v1/responses` 与 `/backend-api/codex/responses` 的 WebSocket 入口，把每轮 `response.create` 还原成 HTTP SSE，逐轮重新鉴权并记账；成功的轮次记 usage，失败的轮次记 `status=failure` 与上游错误（此前失败轮次不落日志）。

## 请求链路

1. 标准端点（`/v1/chat/completions`、`/v1/messages`、`/v1/responses`、图片）选择 deployment；Gemini 客户端通过 `/v1beta/models/<model>:generateContent` 或 `:streamGenerateContent` 进入同一桥接层，`GET /v1beta/models` 返回 Antigravity 目录；Gemini 请求也按 `acompletion` 记录 SpendLogs。
2. `SubscriptionProvider` 生成 `litellm-subscription://` 请求，不携带内部 key。
3. `ProviderRequestExecutor` 把请求交给已注册的运行时处理器。
4. `SubscriptionBridge` 选账号，`auth.ensureCredential` 刷新后重读 auth 文件，按 `route()` 选择上游协议；不同协议先转换。
5. 适配器 `build()` 生成上游 URL/头/体；401/403 刷新凭据后重试一次。
   账号级失败换下一个账号重试（最多 3 个账号、仅 chat/messages/responses/compact/alpha.search）：
   401/402/403/408/429/5xx 按状态码判定，另外 400 错误体命中「余额/额度耗尽」文案时也按账号级处理——
   CommandCode 用 400 invalid_request_error 表达余额不足，若当成请求错误会让整个订阅判失败、跳过同 Provider 的其他账号。
6. 上游 JSON/SSE 经适配器钩子与协议 translator 回到入口协议；Codex 的 SSE 可能不带 `Content-Type`，桥接层以流式计划和入口流式请求共同判定，不能只依赖响应头。`ProviderRequestExecutor` 之外的重试、fallback、冷却、spend 仍由 Router/端点负责。
7. Codex auth 文件带 `use_siwc` 时，非 Codex 客户端使用嵌套 `siwc` token（`chatgpt.tokens.use.direct`），Codex 客户端固定外层 token；两层分别刷新并共用同文件锁。
8. 模型目录：Codex 先用静态快照（`src/data/subscription-models.json`）与内置图片模型，再用账号 token 调 `GET {base}/models?client_version=…` 补入上游刚发布的模型（10 分钟缓存，`catalog/codexCatalog.ts`）；拉取失败只回退静态快照。CommandCode / OpenCode Go 同样走上游 `/models`（`catalog/dynamicCatalog.ts`），其余来源仍只有静态快照。加新模型时先看这里：静态文件是某一时刻的快照，不该靠手改 JSON 追新模型。

## 账号与持久化

- 保留旧 auth 文件格式与目录，回滚旧镜像仍能读取。
- CommandCode 托管账号仍在 `config_yaml.plugins.managed-accounts.commandcode`，运行时投影成 auth 文件；OpenCode key 在 `SubscriptionAccountKeys`，同样投影。
- 账号身份优先取邮箱：OAuth 账号由登录流程写 auth 文件 `email`，CommandCode 由额度里的 `whoami` 提供。OpenCode Go 只按 API key 识别订阅，`/usage` 没有身份字段，所以账号表的 Account 列允许登记展示邮箱（写 auth 文件 `email`，清空即删除），账号表和额度卡片据此显示；这是展示线索，不发送给上游，也不猜测归属。
- 删除账号进 `.trash`；恢复接受 `.trash/<ts>-<name>` 或原文件名。
- 不要把 token、API key 或完整上游请求体写进日志。

## 排查

- `/subscriptions/status`、`/subscriptions/accounts`、`/subscriptions/logs`、`/subscriptions/models`、`/subscriptions/oauth/*` 是当前管理面；`/cliproxy/*` 保留兼容。
- 请求报「订阅运行时尚未初始化」：容器 warmUp 未完成或初始化失败。
- 请求报「没有可用的 <source> 订阅账号」：auth 目录无该来源账号，或全部 disabled。
- 上游 401 反复出现：检查账号 refresh_token 与 auth 文件 `expired`/`timestamp`；`invalid_grant` 一类终态错误会自动禁用账号并在账号表显示 `disabled (invalid grant)`，重新启用会清除状态。
- 请求返回 429「所有账号都在冷却中」：文案里带「该模型（<model>）」「最近失败：HTTP 429: <上游摘要>」，
  先按摘要判断是限流、余额还是鉴权；再看账号表的 Rate limit 状态与上游 `Retry-After`，不要并发重复刷新。
  只有全部模型都被挡时才是账号级冷却（凭证或额度），单个模型冷却不影响同账号其他模型。
- 请求 429 且日志里只有「No deployments available」：Logs 详情的 **Cooldown cause** 区块来自
  `error_information.cooldown_context`，列出触发冷却的 deployment、上游状态码、错误原文、冷却时长与起点。
  这类请求在预检阶段就被拦下，日志里本来不会有自己的上游交换，只能靠这条记录回溯。
- Responses WebSocket 失败轮次现在会写一条 failure SpendLog 并带上上游错误；
  改造前这个入口只记成功，上游 429 在 Logs 上完全不可见。
- 上游报余额/额度不足（如「insufficient credits」）：运行时会先换账号重试，并把该账号冷却 30 分钟，
  日志出现「订阅账号额度耗尽，切换账号重试」即表示请求本来会失败、被换账号救回来了；
  冷却到期后仍会再试一次，长期余额见底的账号应及时补额度或禁用，而不是靠冷却兜底。
