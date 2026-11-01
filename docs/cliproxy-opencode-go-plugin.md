# CLIProxy 托管的 OpenCode Go 插件

LiteLLM TS 托管的 CLIProxyAPI 运行时内置 OpenCode Go 插件（opencode-go-cliproxyapi 0.2.2），
用于把 OpenCode Go / Go Plus 订阅变成 OpenAI / Anthropic / Responses 兼容的上游，并在账户页展示额度窗口。

## 前提

- 运行时镜像必须是 glibc 发行版。官方 CLIProxyAPI 插件构建依赖 glibc（动态链接 libc），
  Alpine/musl 无法加载；因此运行时阶段使用 node:22-bookworm-slim，Alpine 只保留构建阶段。
- CLIProxyAPI 版本 ≥ 8.0.0。低于该版本不会注入插件配置（插件 ABI 需要 v8）。
  新装实例的 bootstrap 已升到 8.0.47；已有实例保留卷里的版本，在 CLIProxy 页面升级后生效。

## 配置 API key

插件默认从环境变量读取密钥（推荐，密钥不落数据库）：

~~~bash
OPENCODE_GO_API_KEY=oc_sk_xxx
~~~

key 在 OpenCode Console 的 Account → Personal API keys 创建。容器重建时保留该环境变量即可。

也可以在 LiteLLM 的 CLIProxy 配置页覆盖（会写入数据库中的 config_yaml）：

~~~yaml
plugins:
  configs:
    opencode-go-cliproxyapi:
      api-keys:
        - value: "oc_sk_xxx"
          name: "Personal"
~~~

托管边界会自动补齐 enabled、dir、base-url、model-prefix；同 id 下的用户字段优先，
因此上面只需要写 api-keys。不要把 plugins.dir 指到别处，否则会被覆盖。

## 模型命名

客户端看到的模型带前缀，例如：

- opencode-go/glm-5.3
- opencode-go/kimi-k3.1-pro
- opencode-go/claude-haiku-5-5
- opencode-go/gpt-6-luna

升级或目录变化后以 /v1/models 返回为准。

## 额度

账户额度查询会优先走 CLIProxy 的通用插件额度接口：

- GET /v0/management/quota/providers
- POST /v0/management/quota/fetch  body: {"auth_index":"..."}

插件把 OpenCode 的 /v1/usage 归一化成 rolling（5 小时）、weekly、monthly 三个窗口，
LiteLLM 映射成 5 小时 / 周 / 月 三个展示窗口。注意这是账号级百分比，
OpenCode 的月额度本身是按模型定义的金额，精确到单个模型的剩余金额仍以 OpenCode Console 为准。

## 验证

1. 升级到 ≥ 8.0.0 并重启后，CLIProxy 日志应出现：
   - plugin loaded plugin_id=opencode-go-cliproxyapi
   - plugin registered ... version=0.2.2
2. GET /v1/models 返回带 opencode-go/ 前缀的模型。
3. 账户页能拉到额度窗口；若提示查询失败，先确认 key 是否有效、账户是否 Go/Go Plus 订阅。

## 回滚

回滚到 < 8.0.0 时投影会自动去掉 plugins 配置，插件不会被加载；镜像本身仍可运行旧版本二进制。
若需要彻底移除插件，回滚镜像到切换前的版本即可。
