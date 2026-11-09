# 请求脱敏（Privacy Redaction）

## 目的与边界

网关在**请求发往上游之前**把密钥、口令、邮箱、手机号、证件号、银行卡号等敏感值替换成确定性占位符，
在**响应写回客户端之前**再还原成原文。默认开启、默认直接替换；不提供「原文 / 脱敏后」对照视图，
也不保存原文。可观测数据只保留派生信息（处数、类型、8 位指纹、长度、前 3 个字符）。

这是**服务端网关**能力：请求仍然会到达上游供应商，只是其中的敏感值已被替换。真正的「不出本机」
需要在上游侧或客户端侧实现，不在本功能范围内。

Dashboard 的「观测 → Privacy」页展示统计与开关；所有展示位置（日志详情、会话时间线、JSON 视图、
Markdown、工具结果）都把占位符渲染成带虚线底色的 `.privacy-token` 样式，避免被误读为原文。

## 工作方式

1. `privacyMaskingMiddleware` 挂在 `proxyRouter` 与 `stubRouter` 的鉴权之后，逐请求执行。
2. 读取 `litellm_settings.privacy_masking`（2 秒 TTL 缓存），决定是否启用、按类型处置。
3. 按路径识别协议（chat / completions / anthropic / responses / embeddings），只改写内容字段：
   `messages[].content`、`system`、`tools[].description`、`tool_use.input`、`tool_result`、
   `tool_calls[].function.arguments`、`instructions`、`input[]`、`prompt`、`input`（embeddings）。
   媒体块（image / audio / file / document / video）、`input_schema`、`metadata` 原样保留。
4. 占位符格式 `{{KIND_hash8}}`：`KIND` 为大写类型，`hash8` 是 `HMAC-SHA256(secret, kind + "\0" + value)`
   的 base32 前 8 位。同一个值在同一部署内始终得到同一个占位符，因此 prompt cache 前缀稳定；
   Anthropic 的 thinking 签名也不会因为占位符变化而失效。
5. 响应侧：`PrivacyResponseWriter` 包装 `res.write` / `res.end` / `res.json`，按内容类型选择
   SSE 逐帧还原、JSON 文档还原或纯文本还原。SSE 还原按内容流维护 carry buffer，只扣住「可能是
   占位符前缀」的尾部字符，跨帧拼接后还原，不会推迟普通文本。
6. 请求结束（`finish`）后异步写入统计，失败只记日志，不影响响应。

## 不会被改写的内容

- 带 `signature` 的 `thinking` 块与 `redacted_thinking`：签名覆盖了块内容，改动会导致上游校验失败。
- `encrypted_content`（Responses 的加密推理载荷）。
- 媒体与文件块、JSON Schema、模型名、工具名、ID 类字段。
- 结构化 UUID、commit hash、版本号、订单号等没有结构校验的候选值（规则做了排除与校验位检查）。

## 配置

配置存放在 `litellm_settings.privacy_masking`，可通过「Privacy」页开关或 `PUT /privacy/settings` 写入：

```yaml
privacy_masking:
  enabled: true                 # 总开关，默认 true
  action: mask                  # mask（替换）| warn（只统计）
  kinds:                        # 按类型覆盖：mask | warn | off
    EMAIL: mask
    USER: off
  custom_words:                 # 额外需要脱敏的词条
    - 蓝鲸计划
    - value: 内部项目代号
      kind: CUSTOM
  never_mask:                   # 永不脱敏的字面值
    - support@liasece.com
  mask_configured_secrets: true # 同时脱敏部署配置里的 api_key 等凭据
  fail_closed: true             # 脱敏自身出错时拒绝请求（503），而不是放行原文
  retention_days: 30            # 观测数据保留天数
```

补充开关：

- 密钥权限 `permissions.pii === false`：该密钥的请求完全跳过脱敏。
- 请求头 `x-litellm-no-pii: true`：单请求跳过脱敏。
- 环境变量 `PRIVACY_REDACTION_SECRET`：占位符派生密钥；未设置时依次回退到 `LITELLM_SALT_KEY`、
  `LITELLM_MASTER_KEY`。更换密钥会让旧占位符无法还原，**不要在生产环境随意更换**。
- 环境变量 `PRIVACY_EXTRA_SECRETS`：额外需要精确匹配脱敏的凭据（逗号分隔）。

## 类型

`API_KEY`、`SECRET`、`JWT`、`PEM`、`PASSWORD`、`BEARER`、`EMAIL`、`PHONE`、`CN_ID`、`BANK_CARD`、
`SSN`、`IBAN`、`USER`（家目录用户名）、`CUSTOM`（自定义词条）。

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

客户端归因来自请求头（`claude-cli/`、`codex`、`antigravity`、`pi` 等 UA / `x-app`）；提供方来自
解析后的 `custom_llm_provider`（CLIProxy 托管的模型统一为 `cliproxy`）。

## 失败模式

- 脱敏抛错且 `fail_closed: true`：返回 503，不把原文发给上游。
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
