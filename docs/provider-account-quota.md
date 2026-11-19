# 内置 Provider 账户额度（DeepSeek / MiniMax）

Usage → “Upstream Account Quota” 页面（`/ui/usage/quota`，仅管理员）同时展示 CLIProxy 账户额度与本代理直连的
DeepSeek、MiniMax 账户额度：按上游供应商分组，一行一个账号，列为 Account / Type / Quota windows /
Balances / Updated，与模型列表的分组带同一形态，账号多时纵向滚动即可逐行对照。数据来自
`GET /provider/quota`（仅 proxy admin）与 `/subscriptions/accounts/*/quota`，密钥只在服务端解析，
不会出现在响应或日志里。

## 数据来源

| Provider | 数据 | 接口 | 说明 |
| --- | --- | --- | --- |
| DeepSeek | 账户余额 | `GET /user/balance` | 官方接口，账户级，返回 CNY/USD 钱包与赠金/充值明细。官方没有按 Key、按模型或按天的用量 API，因此不展示“已用量”。 |
| MiniMax | 订阅窗口 | `GET {host}/v1/token_plan/remains` | 官方接口，用订阅 Key（M Plan / Token Plan）查询 5 小时与 7 天窗口，`*_remaining_percent` 是唯一可靠的百分比字段。 |
| MiniMax | 按量余额 | `GET {host}/account/query_balance` | 非公开接口，属于 best effort。字段可用时展示 `available_amount`；不可用时该行仍标明这是按量 Key。 |

## Key 类型自动识别

MiniMax 的订阅 Key 与按量 API Key 是两套独立凭证，不能混用。服务端按以下顺序识别：

1. 先用配置的 Key 请求 `/v1/token_plan/remains`。返回窗口即判定为 `subscription`。
2. 再尝试 `/account/query_balance`。返回 `available_amount` 即判定为 `pay_as_you_go` 并展示余额。
3. 若余额接口拒绝该 Key（这是非公开接口的已知行为），改用 `GET /v1/models` 做一次鉴权探测：
   成功则仍然判定为 `pay_as_you_go`，该行说明“按量 Key，但没有公开余额接口”。
4. 两者都失败时该行 Type 显示 `Unrecognized key`，具体原因写在该行 Account 单元格，不影响其他账号行。

区域处理：优先使用账户配置的 `api_base` 主机，再依次尝试官方文档给出的
`www.minimaxi.com`、`www.minimax.io`、`api.minimaxi.com`、`api.minimax.io`。

## 账户聚合

- 从当前请求的 runtime deployment 快照读取模型，按 `provider + credential_name + api_base` 聚合；
  一个 Credential 服务多个模型组时只查询一次，模型名作为该账号行的副标题。
- Provider 判定与 `ProviderRegistry` 一致：先看 `custom_llm_provider`，再看模型名前缀。
- Credential 值覆盖 inline 参数，与 Router 执行期解析一致。
- 未配置 `api_key` 的 deployment 不产生账号行。

## 缓存与失败处理

- 结果在进程内缓存 60 秒，刷新按钮传 `?refresh=true` 绕过缓存。
- 账号名后面带一个状态点，表示这一行额度的紧迫程度：某个窗口真正用完（剩余取整为 0%）才是
  红点；没耗尽但还有窗口不高于 33% 是黄点；全部高于 33% 才是绿点。低但没有用完的窗口不算红——
  18%/14% 这种是黄点，红只留给真的耗尽。判断只看已有数值，按量付费 key 这类没有窗口的行不画点。
  点用比进度条更亮的同色系颜色加外圈光晕，并带呼吸动画（红最快、绿最慢，`prefers-reduced-motion`
  下停用）。
- 前端把上一次成功的快照（账号、内置 key、各账号额度）写在浏览器 `localStorage` 的
  `upstreamAccountQuotaCache` 里：打开页面先铺缓存，同时后台请求真实额度；成功后整体覆盖并重写快照。
  刷新过程不额外加提示条，只让 Refresh 按钮进入加载态；数值取自何时由各行 Updated 列说明。
- 页面开着时自动轮询（`UPSTREAM_QUOTA_POLL_INTERVAL_MS`，5 分钟）：订阅账号的额度查询每次都
  穿透到上游，所以按分钟级而不是日志页的秒级；标签页隐藏时暂停，切回来立即补一次。轮询与手动
  刷新共用同一条加载路径（不叠加请求、不闪空表格），调度器在
  `ui/litellm-dashboard/src/features/platform/logic/RefreshSchedulerLogic.ts`，日志页也用它。
- 缓存只承担“先显示”，不替代请求结果：账号列表、内置 key、单个账号额度各自失败时都保留上一次
  的数值，同时把真实错误写到对应位置（页面顶部提示或该行 Account 单元格），行上的 Updated 仍是
  该数值的实际取数时间。
- 快照超过 24 小时、版本字段不符或 JSON 损坏时整条丢弃，宁可等真实请求也不展示失真数字；
  一轮刷新全部失败时不重写快照，避免把旧数据的时间戳刷新成“刚刚”。
- DeepSeek 返回 `is_available=false` 时给出 `warning`，提示账户当前无法调用。

## 验证

```sh
npx jest src/providerusage src/proxy/ProviderQuotaEndpoints
```

覆盖：MiniMax 真实 payload 的窗口解析、无限额度不渲染 0% 进度条、订阅/按量识别、
非公开余额接口失败时的降级、区域主机顺序、DeepSeek 多币种余额、账户聚合、密钥不入库不入响应、缓存命中。
