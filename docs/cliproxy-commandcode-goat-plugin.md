# CLIProxy 托管的 CommandCode GOAT 插件

LiteLLM TS 托管的 CLIProxyAPI 运行时内置 [commandcode-go-cliproxyapi](https://github.com/mczhoucn/commandcode-go-cliproxyapi)
插件（0.1.3），用于接入 **CommandCode GOAT / Pro / Max** 订阅。

> CommandCode Go 套餐不在支持范围：Go 使用官方 CLI 的私有协议，没有 Provider API 权限；
> 本插件只走 CommandCode 的 OpenAI 兼容 Provider API。

## 上游与模型

- 上游：`https://api.commandcode.ai/provider/v1`
- 默认路由：OpenAI Chat Completions（`/chat/completions`）；Claude 模型可走 `/messages`，
  部分模型支持 `/responses`，可用 `route-overrides` 固定。
- 模型目录来自 `GET {base-url}/models`，客户端模型 ID 形如：
  - `commandcode/deepseek/deepseek-v4.1-flash`
  - `commandcode/z-ai/glm-5.3-flash`
  - `commandcode/moonshotai/kimi-k3`

## 账户（API key）

密钥写在 LiteLLM 管理的 CLIProxy 配置里，不需要额外的 key 文件。支持一个或多个账号：

~~~yaml
plugins:
  managed-accounts:
    commandcode:
      - api-key: "cc_xxx"
        label: "GOAT"      # 可选，默认 CommandCode
      - api-key: "cc_yyy"
        label: "GOAT-2"
~~~

旧版单对象写法仍然兼容：

~~~yaml
plugins:
  managed-accounts:
    commandcode:
      api-key: "cc_xxx"
      label: "GOAT"
~~~

保存后管理器会：

1. 从投影给 CPA 的配置中移除 `managed-accounts`，密钥不会进入 CPA 的 config.yaml；
2. 为每个账号在 `CLIPROXY_RUNTIME_ROOT/auths/` 写入 `commandcode-managed-<key摘要>.json`（权限 600）；
3. 换 key 或删除账号时清理不再使用的托管 auth 文件。

也可以在 Dashboard 的 **OAuth accounts** 页签里直接添加/编辑/删除 CommandCode 账号：
添加时填 label 和 API key；编辑可改 label 或轮换 key（key 留空表示不修改）。
页面写入的就是上面这段配置，因此两种方式等价。

手工放置 `type: commandcode` 的 auth 文件仍然兼容，但不再需要；插件自带的
Management Center 账户页在托管模式下不暴露。

## 启用方式

插件库已打进运行时镜像的 `/opt/cliproxy/plugins`。管理器在以下条件同时满足时把
`plugins.configs.commandcode-go-cliproxyapi` 注入 CPA 配置：

1. 当前 CLIProxyAPI ≥ 8.0.0 且运行的是插件版二进制；
2. 镜像里存在 `commandcode-go-cliproxyapi.so`。

托管字段只包含 `enabled`、`base-url`、`model-prefix`；用户在同一插件 id 下写的字段优先。

## 额度

LiteLLM 的账户额度查询对 `provider = commandcode` 走插件的管理接口：

- `POST /v0/management/plugins/commandcode-go-cliproxyapi/quota-usage`，body `{"key_id":"<auth_index>"}`

插件返回计划（GOAT/Pro/Max）、计划额度、剩余 credits、5 小时/周/月窗口；LiteLLM 归一化成
统一的额度卡片。CommandCode 的额度接口需要有效 key，账户失效会显示插件返回的错误。

## 模型放行

CPA 的 `/v1/models` 能看到全部 `commandcode/*`，但 LiteLLM 只会路由已经加入模型配置的
模型。使用前在模型管理里添加对应模型（例如 `commandcode/deepseek/deepseek-v4.1-flash`）。

## 验证

1. 容器日志出现 `plugin loaded plugin_id=commandcode-go-cliproxyapi` 与 `plugin registered`；
2. `GET /v1/models` 含 `commandcode/` 前缀（需要至少一个启用账户，目录才会发现）；
3. 账户 `auth_index` 的额度接口返回 plan/credits/窗口；
4. 通过 LiteLLM 调用 `commandcode/...` 返回 200。
