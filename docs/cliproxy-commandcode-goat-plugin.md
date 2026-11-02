# CLIProxy 托管的 CommandCode GOAT 插件

LiteLLM TS 托管的 CLIProxyAPI 运行时内置 [commandcode-go-cliproxyapi](https://github.com/mczhoucn/commandcode-go-cliproxyapi)
插件（0.1.3），用于接入 **CommandCode GOAT / Pro / Max** 订阅。

> CommandCode Go 套餐不在支持范围：Go 使用官方 CLI 的私有协议，没有 Provider API 权限；
> 本插件只走 CommandCode 的 OpenAI 兼容 Provider API。

## 上游与模型

- 上游：@@BThttps://api.commandcode.ai/provider/v1@@BT
- 默认路由：OpenAI Chat Completions（@@BT/chat/completions@@BT）；Claude 模型可走 @@BT/messages@@BT，
  部分模型支持 @@BT/responses@@BT，可用 @@BTroute-overrides@@BT 固定。
- 模型目录来自 @@BTGET {base-url}/models@@BT，客户端模型 ID 形如：
  - @@BTcommandcode/deepseek/deepseek-v4.1-flash@@BT
  - @@BTcommandcode/z-ai/glm-5.3-flash@@BT
  - @@BTcommandcode/moonshotai/kimi-k3@@BT

## 账户（API key）

密钥写在 LiteLLM 管理的 CLIProxy 配置里，不需要额外的 key 文件：

~~~yaml
plugins:
  managed-accounts:
    commandcode:
      api-key: "cc_xxx"
      label: "GOAT"      # 可选，默认 CommandCode
~~~

保存后管理器会：

1. 从投影给 CPA 的配置中移除 @@BTmanaged-accounts@@BT，密钥不会进入 CPA 的 config.yaml；
2. 在 @@BTCLIPROXY_RUNTIME_ROOT/auths/@@BT 写入 @@BTcommandcode-managed-<摘要>.json@@BT（权限 600）；
3. 换 key 时删除旧的托管 auth 文件，删除该段时一并清理。

手工放置 @@BTtype: commandcode@@BT 的 auth 文件仍然兼容，但不再需要；插件自带的
Management Center 账户页在托管模式下不暴露。

## 启用方式

插件库已打进运行时镜像的 @@BT/opt/cliproxy/plugins@@BT。管理器在以下条件同时满足时把
@@BTplugins.configs.commandcode-go-cliproxyapi@@BT 注入 CPA 配置：

1. 当前 CLIProxyAPI ≥ 8.0.0 且运行的是插件版二进制；
2. 镜像里存在 @@BTcommandcode-go-cliproxyapi.so@@BT。

托管字段只包含 @@BTenabled@@BT、@@BTbase-url@@BT、@@BTmodel-prefix@@BT；用户在同一插件 id 下写的字段优先。

## 额度

LiteLLM 的账户额度查询对 @@BTprovider = commandcode@@BT 走插件的管理接口：

- @@BTPOST /v0/management/plugins/commandcode-go-cliproxyapi/quota-usage@@BT，body @@BT{"key_id":"<auth_index>"}@@BT

插件返回计划（GOAT/Pro/Max）、计划额度、剩余 credits、5 小时/周/月窗口；LiteLLM 归一化成
统一的额度卡片。CommandCode 的额度接口需要有效 key，账户失效会显示插件返回的错误。

## 模型放行

CPA 的 @@BT/v1/models@@BT 能看到全部 @@BTcommandcode/*@@BT，但 LiteLLM 只会路由已经加入模型配置的
模型。使用前在模型管理里添加对应模型（例如 @@BTcommandcode/deepseek/deepseek-v4.1-flash@@BT）。

## 验证

1. 容器日志出现 @@BTplugin loaded plugin_id=commandcode-go-cliproxyapi@@BT 与 @@BTplugin registered@@BT；
2. @@BTGET /v1/models@@BT 含 @@BTcommandcode/@@BT 前缀（需要至少一个启用账户，目录才会发现）；
3. 账户 @@BTauth_index@@BT 的额度接口返回 plan/credits/窗口；
4. 通过 LiteLLM 调用 @@BTcommandcode/...@@BT 返回 200。
