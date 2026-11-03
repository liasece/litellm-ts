# 内置 Provider 账户额度（DeepSeek / MiniMax）

Usage 页的 “Upstream account quota” 区段同时展示 CLIProxy 账户额度与本代理直连的
DeepSeek、MiniMax 账户额度。卡片数据来自 `GET /provider/quota`（仅 proxy admin），
密钥只在服务端解析，不会出现在响应或日志里。

## 数据来源

| Provider | 数据 | 接口 | 说明 |
| --- | --- | --- | --- |
| DeepSeek | 账户余额 | `GET /user/balance` | 官方接口，账户级，返回 CNY/USD 钱包与赠金/充值明细。官方没有按 Key、按模型或按天的用量 API，因此不展示“已用量”。 |
| MiniMax | 订阅窗口 | `GET {host}/v1/token_plan/remains` | 官方接口，用订阅 Key（M Plan / Token Plan）查询 5 小时与 7 天窗口，`*_remaining_percent` 是唯一可靠的百分比字段。 |
| MiniMax | 按量余额 | `GET {host}/account/query_balance` | 非公开接口，属于 best effort。字段可用时展示 `available_amount`；不可用时卡片仍标明这是按量 Key。 |

## Key 类型自动识别

MiniMax 的订阅 Key 与按量 API Key 是两套独立凭证，不能混用。服务端按以下顺序识别：

1. 先用配置的 Key 请求 `/v1/token_plan/remains`。返回窗口即判定为 `subscription`。
2. 再尝试 `/account/query_balance`。返回 `available_amount` 即判定为 `pay_as_you_go` 并展示余额。
3. 若余额接口拒绝该 Key（这是非公开接口的已知行为），改用 `GET /v1/models` 做一次鉴权探测：
   成功则仍然判定为 `pay_as_you_go`，卡片说明“按量 Key，但没有公开余额接口”。
4. 两者都失败时卡片显示 `Unrecognized key` 与具体原因，不影响其他账户卡片。

区域处理：优先使用账户配置的 `api_base` 主机，再依次尝试官方文档给出的
`www.minimaxi.com`、`www.minimax.io`、`api.minimaxi.com`、`api.minimax.io`。

## 账户聚合

- 从当前请求的 runtime deployment 快照读取模型，按 `provider + credential_name + api_base` 聚合；
  一个 Credential 服务多个模型组时只查询一次，模型名作为卡片副标题。
- Provider 判定与 `ProviderRegistry` 一致：先看 `custom_llm_provider`，再看模型名前缀。
- Credential 值覆盖 inline 参数，与 Router 执行期解析一致。
- 未配置 `api_key` 的 deployment 不产生卡片。

## 缓存与失败处理

- 结果在进程内缓存 60 秒，刷新按钮传 `?refresh=true` 绕过缓存。
- 单个账户失败只影响自己的卡片（`error` 字段），整个区段不会失败。
- DeepSeek 返回 `is_available=false` 时给出 `warning`，提示账户当前无法调用。

## 验证

```sh
npx jest src/providerusage src/proxy/ProviderQuotaEndpoints
```

覆盖：MiniMax 真实 payload 的窗口解析、无限额度不渲染 0% 进度条、订阅/按量识别、
非公开余额接口失败时的降级、区域主机顺序、DeepSeek 多币种余额、账户聚合、密钥不入库不入响应、缓存命中。
