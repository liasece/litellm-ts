# 请求脱敏（Privacy Redaction）

## 目的与边界

网关在**请求发往上游之前**把密钥、口令、邮箱、手机号、证件号、银行卡号等敏感值替换成确定性占位符，
在**响应写回客户端之前**再还原成原文。默认开启、默认直接替换；不提供「原文 / 脱敏后」对照视图，
也不保存原文。可观测数据只保留派生信息（处数、类型、8 位指纹、长度、前 3 个字符）。
生效范围可以按提供方、模型收窄，判定对象是**最终选中的 deployment**（详见「工作方式」与「配置」）。

这是**服务端网关**能力：请求仍然会到达上游供应商，只是其中的敏感值已被替换。真正的「不出本机」
需要在上游侧或客户端侧实现，不在本功能范围内。

覆盖的端点：`/v1/chat/completions`、`/v1/messages`（含 `count_tokens`）、`/v1/responses`（含
`input_tokens`、`compact`）、`/v1/completions`、`/v1/embeddings`。音频（`/v1/audio/*`）、图像
（`/v1/images/*`）、审核（`/v1/moderations`）**不脱敏**：这些端点的产物（音频、图片）无法还原成原文，
掩码只会让调用方拿到被改坏的产物。

Dashboard 的「观测 → Privacy」页展示统计与开关；所有展示位置（日志详情、会话时间线、JSON 视图、
Markdown、工具结果）都把占位符渲染成带虚线底色的 `.privacy-token` 样式，避免被误读为原文。

## 工作方式

1. `privacyMaskingMiddleware` 挂在 `proxyRouter` 与 `stubRouter` 的鉴权之后，逐请求建立占位符上下文、
   安装响应还原与统计钩子，并通过 `AsyncLocalStorage` 把上下文传给后续调度。
2. 请求体改写不在中间件里做，而是放在**真正发往上游之前的最后一层**：`Router._executeRequest` 已经
   完成 deployment 选择、重试与 fallback，原生透传路径（chat 流式、Anthropic 流式/非流式）和
   `EmbeddingsEndpoint` 也各自在同一位置调用。图片生成 / 编辑端点不处理。
3. 这一刻才读取生效范围，用**最终 deployment** 判定这一次是否脱敏：提供方匹配
   `custom_llm_provider` 与上游模型里的插件段（`cliproxy/opencode-go/x` → `opencode-go`），模型匹配
   模型组名与上游模型串。fallback 换到别的提供方时，按新的去向重新判定。
4. 按 provider 的响应协议选择 walker（chat / anthropic / responses / embeddings），只改写内容字段：
   `messages[].content`、`system`、`tools[].description`、`tool_use.input`、`tool_result`、
   `tool_calls[].function.arguments`、`instructions`、`input[]`、`prompt`、`input`（embeddings）。
   媒体块（image / audio / file / document / video）、`input_schema`、`metadata` 原样保留。
5. 占位符格式 `{{KIND_hash8}}`：`KIND` 为大写类型，`hash8` 是 `HMAC-SHA256(secret, kind + "\0" + value)`
   的 base32 前 8 位。同一个值在同一部署内始终得到同一个占位符，因此 prompt cache 前缀稳定；
   Anthropic 的 thinking 签名也不会因为占位符变化而失效。
6. 响应侧：`PrivacyResponseWriter` 包装 `res.write` / `res.end` / `res.json`，按内容类型选择
   SSE 逐帧还原、JSON 文档还原或纯文本还原。SSE 还原按内容流维护 carry buffer，只扣住「可能是
   占位符前缀」的尾部字符，跨帧拼接后还原，不会推迟普通文本。
7. 请求结束（`finish`）后异步写入统计，失败只记日志，不影响响应。

## 不会被改写的内容

- 带 `signature` 的 `thinking` 块与 `redacted_thinking`：签名覆盖了块内容，改动会导致上游校验失败。
- `encrypted_content`（Responses 的加密推理载荷）。
- 媒体与文件块、JSON Schema、模型名、工具名、ID 类字段。
- 结构化 UUID、commit hash、版本号、订单号等没有结构校验的候选值（规则做了排除与校验位检查）。

## 配置

配置存放在 `litellm_settings.privacy_masking`。页面「Privacy」把所有配置都做成了可编辑控件：
顶部的总开关与统计区间；设置弹窗里的「生效范围」（提供方 / 模型列表）；「过滤特性」里逐类的
替换 / 仅统计 / 关闭与「网关自身配置的凭据」开关；「策略与保留」里的全局处置、自定义词条、
白名单、脱敏失败时是否拒绝请求、统计保留天数。
也可以直接用 `PUT /privacy/settings` 写入同一份配置。保存后最多 2 秒生效（配置快照带 TTL，
写入时会主动失效本模块缓存，底层 `litellm_settings` 读取也有 2 秒 TTL）：

```yaml
privacy_masking:
  enabled: true                 # 总开关，默认 true
  action: mask                  # mask（替换）| warn（只统计）
  kinds:                        # 按类型覆盖：mask | warn | block | off
    EMAIL: mask
    USER: off
  custom_words:                 # 额外需要脱敏的词条
    - 蓝鲸计划
    - value: 内部项目代号
      kind: CUSTOM
  never_mask:                   # 永不脱敏的字面值
    - support@liasece.com
  rules:                        # 用户规则：前缀或正则二选一，命中后按 kind 替换
    - kind: TICKET
      prefix: ACME-
    - kind: ORG_ID
      regex: org_[a-z0-9]{12}
  shape: false                  # 凭据类换成长度与字符类别相同的假值，而不是占位符
  providers: [opencode]         # 生效提供方；空表示所有提供方（包含匹配，忽略大小写）
  models: []                    # 生效模型；空表示所有模型（包含匹配，忽略大小写）
  mask_configured_secrets: true # 同时脱敏部署配置里的 api_key 等凭据
  fail_closed: true             # 脱敏自身出错时拒绝请求（503），而不是放行原文
  retention_days: 30            # 观测数据保留天数
```

生效范围说明：

- 两个列表都为空时对所有流量生效；只填一个时按该维度过滤；两个都填时取交集。
- 匹配是大小写不敏感的「包含」匹配，列表项里的 `*` 只是占位符，匹配前会去掉。例如
  `providers: [opencode]` 命中 `opencode-go/deepseek-v4.1-flash`，`models: [opencode-go/*]` 同理。
- 提供方的候选标识是 `custom_llm_provider` 与上游模型串的第二段（插件/子提供方段）；模型的候选
  标识是模型组名与上游模型串。因此写成 `cliproxy` 会命中该提供方下的全部模型，写成具体模型名则只
  命中对应模型组。
- 保存后同样最多 2 秒生效；判定发生在路由之后，所以客户端最初请求的模型名不会决定是否脱敏。

补充开关：

- 密钥权限 `permissions.pii === false`：该密钥的请求完全跳过脱敏。
- 请求头 `x-litellm-no-pii: true`：单请求跳过脱敏。
- 环境变量 `PRIVACY_REDACTION_SECRET`：占位符派生密钥；未设置时依次回退到 `LITELLM_SALT_KEY`、
  `LITELLM_MASTER_KEY`。更换密钥会让旧占位符无法还原，**不要在生产环境随意更换**。
- 环境变量 `PRIVACY_EXTRA_SECRETS`：额外需要精确匹配脱敏的凭据（逗号分隔）。

## 类型

`API_KEY`、`SECRET`、`JWT`、`PEM`、`PASSWORD`、`BEARER`、`EMAIL`、`PHONE`、`CN_ID`、`BANK_CARD`、
`SSN`、`IBAN`、`USER`（家目录用户名）、`CUSTOM`（自定义词条），以及用户规则声明的任意类型名
（大写字母开头，最多 24 个字符，例如 `TICKET`、`ORG_ID`）。自定义类型与内置类型一样可以单独设置处置，
也出现在统计的类型分布里。

规则对结构性候选做校验：银行卡走 Luhn、身份证走 GB 11643 校验位、IBAN 走 mod-97、SSN 排除
`000`/`666`/`9xx` 段；手机号要求语境词或 `+86` 前缀；邮箱放过 `example.com` 等示例域；
URL 内嵌密码优先于邮箱规则。

## 统计模型

两张表（迁移 `drizzle/0012_privacy_redaction.sql`）：

- `LiteLLM_PrivacyRedactionEvents`：请求级一行，`request_id` 与 SpendLog 共用，可从日志详情跳转；
  记录客户端、提供方、模型、类型分布、处数、值数、处置、耗时、未还原数量。
- `LiteLLM_PrivacyRedactionValues`：值级一行，只存 `kind`、`value_hash`（8 位 base32）、`value_length`、
  `hint`（前 3 个字符）、出现次数；不存原文，也无法从哈希反推。

接口：`GET /privacy/overview`、`GET /privacy/requests`、`GET /privacy/values`、
`GET/PUT /privacy/settings`，全部要求 management 鉴权（读允许只读管理员，写只允许 proxy admin）。

客户端归因来自请求头（`claude-cli/`、`codex`、`antigravity`、`pi` 等 UA / `x-app`）；提供方与模型来自
**实际执行脱敏的那个 deployment**（CLIProxy 托管的模型统一为 `cliproxy`）。只有真正脱敏过的请求才
写统计，未落在生效范围内的请求不会出现在这里。

## 失败模式

- 脱敏抛错且 `fail_closed: true`：在调度点返回 503，不把原文发给上游。
- 某类配置为 `block` 且命中：在调度点返回 400（`type: privacy_blocked`，带命中的类型列表），
  不重试、不换 fallback 提供方重发；统计记为 `action: block`。
- 上游改写占位符、或客户端在占位符补齐前断开：该处占位符无法还原，保持原样返回并在
  「未还原占位符」计数；页面用告警条说明。
- 客户端拿到的是原文（还原只发生在网关写回的最后一层）；网关自身日志、SpendLog、会话记录、
  Dashboard 展示的是占位符。
- 上游响应里的占位符若被模型改写（例如插入空格），无法还原，属预期限制。

## 排查

1. 页面「已替换」为 0 且请求确实包含敏感值：确认总开关、密钥 `permissions.pii`、请求头，以及
   `kinds` 是否把对应类型设成 `off`。
2. 客户端收到 `{{...}}` 原样文本：查看「未还原占位符」计数；确认客户端没有自行截断或改写流。
3. 想临时定位问题：用同一条请求头 `x-request-id` 在 Logs 页按 request_id 查 SpendLog，
   `privacy_masking` 的占位符在请求/响应正文里可见，配合本页的处数与类型即可定位。

## 处置动作

| 动作 | 行为 |
| --- | --- |
| `mask` | 替换为占位符（`shape` 开启时凭据类换成同形态假值），客户端拿到原文 |
| `warn` | 只统计不替换，原文照常上行 |
| `block` | 照常替换，同时**拒绝整条请求**（HTTP 400，`error.type = privacy_blocked`，`kinds` 列出命中类型） |
| `off` | 完全不识别、不计数 |

`block` 适合「这类值一旦出现就不该让它走」的场景（例如生产密钥）：请求不会到达上游，统计里
`action` 记为 `block`，日志里有一行 `privacy_blocked` 告警。全局处置只有 `mask` 与 `warn`，
「拒绝请求」按类型单独设置。

## 用户规则与同形态假值

- **用户规则**：`rules` 最多 50 条，每条只有 `prefix`（≤64 字符）或 `regex`（≤200 字符，保存时校验
  可编译）之一。前缀规则从该前缀开始向后吃掉连续的 token 字符（`A-Za-z0-9._~+/=:-`，最多 128 字符），
  适合 `ACME-` 这类流水号；正则规则取第一组捕获（没有分组时取整个匹配）。规则的优先级低于配置凭据、
  高于内置规则，命中值按 `kind` 的类型处置执行。
- **同形态假值**（`shape`）：开启后 `API_KEY`、`SECRET`、`JWT`、`BEARER` 不再写成占位符，而是按
  原值逐字符替换：字母保持大小写、数字保持数字、分隔符原样，长度不变。适用于上游或下游会校验值格式
  的位置（占位符在那里会被判成格式错误）。假值由 HMAC 派生，同一个值在同一部署里始终相同；它只在
  本次请求的内存里映射回原文，和占位符一样不落库。

## 与 magpie 的差异

参考实现 [yetone/magpie](https://github.com/yetone/magpie)（Go：本地网关 + 菜单栏应用）。对照其
`internal/redact`、`internal/pii`、`internal/maskrec`、`internal/settings`：

| 能力 | magpie | 本实现 |
| --- | --- | --- |
| 检测方式 | 规则 + 可选本地模型（AstrLink Guard 39MB int8；OpenAI Privacy Filter 1.6GB q8，经 pf-serve 在 GPU/CPU 上运行，按需下载并校验 sha256） | 仅规则：正则 + 校验位 + 语境词 + 配置凭据精确匹配 |
| 类型 | 内置证件/银行卡/邮箱等，另有模型类别（PERSON、ADDRESS 等）与用户规则自定义 kind | 14 类固定 kind + `CUSTOM` |
| 处置 | `mask` / `warn` / `block`（既替换又拒绝请求） | `mask` / `warn` / `block` / `off` |
| 占位符 | `{{KIND_8位base32}}`，HMAC 键落盘，进程内值表上限 20 万条 | 同格式，HMAC 键取环境变量，值表按请求隔离 |
| 用户规则 | 前缀或正则 + 自定义 kind，保存时校验可编译、能命中 | 前缀或正则 + 自定义 kind，保存时校验可编译（不校验能否命中） |
| 形态伪装 | `RedactShape`：把 key 换成同形态的假 key，避免上游格式校验失败 | `shape`：同长度同字符类别的假值，覆盖密钥与令牌四类 |
| 白名单 | 最多 200 条、每条 ≤256 字符 | 同（`never_mask`）；另外用户规则最多 50 条 |
| 词条匹配 | 可选择区分大小写、整词匹配 | 不分大小写、按子串 |
| 原文回看 | 内存保留最近 100 个请求原文，页面可回看 | 不保留（产品决定） |
| 观测存储 | 按天 zstd 文件，30 天 / 100MB | Postgres 两张表，默认保留 30 天 |
| 覆盖面 | 本机全部 agent 流量 | 上列五个端点；音频、图像、审核不脱敏 |

已知差异带来的实际影响：

- **无语境的 PII 会漏**：姓名、地址、自由文本里的口令需要本地模型才能识别，当前实现没有。
- **跨请求还原**：magpie 的进程内值表能在后续请求里还原近期的占位符；本实现只还原同一请求，
  客户端把占位符带到别的请求里会算作「未还原」。
- **上游强校验**：开启 `shape` 后凭据类用同形态假值；邮箱、证件号等仍用占位符。
