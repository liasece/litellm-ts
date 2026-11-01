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

## 启用方式

插件库已打进运行时镜像的 `/opt/cliproxy/plugins`。管理器在以下条件同时满足时把
`plugins.configs.commandcode-go-cliproxyapi` 注入 CPA 配置：

1. 当前 CLIProxyAPI ≥ 8.0.0 且运行的是插件版二进制；
2. 镜像里存在 `commandcode-go-cliproxyapi.so`。

托管字段只包含 `enabled`、`base-url`、`model-prefix`；用户在同一插件 id 下写的字段优先。
插件不读取配置里的 `api-keys`，密钥只来自 CPA auth 文件。

## 账户（API key）

把账户写成 CPA auth 文件，放在 `CLIPROXY_RUNTIME_ROOT/auths/`（生产宿主
`/root/var/tools/service/ai-out-service/CLIProxyAPI/auths/`），权限 600：

~~~json
{
  "type": "commandcode",
  "api_key": "cc_xxx",
  "label": "GOAT"
}
~~~

CPA 的文件监听会加载它，插件会在下一个目录刷新周期把模型挂到 `commandcode/` 前缀下。
插件自带的账户页面（Management Center → CommandCode）依赖 CPA 控制面板，本仓库托管模式
不暴露该页面，因此用 auth 文件维护账户。

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
