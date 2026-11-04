# commandcode-go-cliproxyapi（本仓库 fork）

本目录是 [mczhoucn/commandcode-go-cliproxyapi](https://github.com/mczhoucn/commandcode-go-cliproxyapi)
的 fork，用于 LiteLLM TS 托管的 CLIProxyAPI 运行时。**上游发布物不再使用**：镜像由本目录源码
现场编译（见根目录 `Dockerfile.runtime` 的 `commandcode-plugin-build` 阶段）。

## 为什么 fork

上游 0.1.3 对 Responses 的 `namespace` 工具直接报错：

```text
unsupported tool type "namespace"; only function tools translate to /v1/chat/completions
```

Codex / MCP 客户端会把工具声明成分组形态（`{type:namespace, name:mcp__node_repl, tools:[...]}`）。
上游 `/v1/chat/completions` 的转换器只接受 `function`，因此这类请求整条 500。

修复分两层，缺一不可：

1. **路由**（根因）：默认路由改为 responses。上游只有 responses 能原样承载 namespace 与
   web_search；chat 端点两者都不接受——见下面的路由表。
2. **拍平兜底**：当模型被显式覆盖回 chat 时，namespace 拍平成 `<namespace>__<name>`
   （与 LiteLLM 侧同名规则），并在响应中还原，而不是直接报错。

## 本 fork 的修改

| 位置 | 修改 |
| --- | --- |
| `internal/adapter/shared/shared.go` | 新增 `FlattenResponsesTools` / `NamespacedToolName` / `RestoreToolIdentity` / `ToolNames`；`RespTool` 支持嵌套 `tools`；`RespItem` 与输出装配器支持 `namespace` |
| `internal/catalog/catalog.go` | `DefaultRoute` 改为 responses；新增 `routeFor`/`isClaudeID`（Claude 走 /messages） |
| `internal/adapter/chatcompletions/request.go` | `responsesToChat` 改走拍平内核，并回传 名字→namespace 索引（仅在显式覆盖到 chat 时使用） |
| `internal/adapter/chatcompletions/convert.go` | Responses 目标在写回时用索引还原 `name` + `namespace` |
| `internal/adapter/chatcompletions/stream.go` | 流式 `response.output_item.*` 同步还原 identity |
| `internal/adapter/responses/stream.go` | Responses 目标的 function_call 事件带上还原后的 namespace |
| `internal/plugin/executor.go` | 把索引从请求侧传到响应侧（非流式与流式两条路径） |

设计要点：

- **拍平规则与 LiteLLM 一致**（`<namespace>__<name>`，分隔符 `__`），两侧对同一工具的线名一致，
  回程才能无损还原。
- 名字超过 64 字符时用稳定哈希后缀截断，避免两个不同工具撞成同一个名字。
- 默认 responses 路由下 namespace 与 `web_search` 都原样转发，不再报错；只有显式覆盖到
  chat 的模型才走拍平，而 `web_search` 这类 chat 无法表达的类型仍按 FR-009 报错。
- 普通函数工具不会凭空多出 `namespace` 字段。

## 上游路由：默认 Responses

上游实测结论（/provider/v1）：

| 端点 | 非 Claude 模型 | Claude 模型 |
| --- | --- | --- |
| /responses | **200，原样接受 namespace 与 web_search** | 400，要求走 /messages |
| /chat/completions | 200，但**不接受** namespace / web_search | — |
| /messages | 400，要求走 chat | 200 |

因此 DefaultRoute 由 chat-completions 改为 **responses**：只有 responses 能无损承载
Codex/MCP 客户端声明的原生工具形态。Claude 模型由 routeFor 保持走 /messages，
因为上游在 /responses 上明确拒绝它们。

这解释了本 fork 的两个阶段：最早只在 chat 侧拍平 namespace——上表说明拍平是必要但不充分的，
chat 端点根本无法表达 web_search；改走 responses 后两类工具都能原样转发，不再需要拍平。

## 构建

镜像内构建（推荐，与生产 ABI 一致）：

```sh
docker build --target commandcode-plugin-build -f Dockerfile.runtime -t cc-plugin .
```

本地构建需要 Go 1.26+ 与 glibc 环境（插件经 cgo/dlopen 加载，musl 会崩溃）：

```sh
CGO_ENABLED=1 GOOS=linux GOARCH=amd64 \
  go build -trimpath -buildmode=c-shared -ldflags "-s -w" \
  -o commandcode-go-cliproxyapi.so .
```

产物文件名必须是 `commandcode-go-cliproxyapi.so`——CLIProxyAPI 按 `<插件id>.so` 发现插件。

## 验证

```sh
go test ./internal/...
```

回归用例在 `internal/adapter/chatcompletions/namespace_test.go` 与
`namespace_stream_test.go`：覆盖拍平、还原、普通工具不受影响、超长名去重、以及嵌套仍含非法类型
时依然报错。生产故障的实际形态是**流式**请求，流式用例单独钉住。

## 与上游同步

上游新版本不要直接覆盖本目录。先比对 `CHANGELOG.md`，把上游改动合进来，确认本文档表格里的
修改仍然存在（尤其 `shared.go` 的工具内核与 executor 的索引传递），再跑一遍 `go test ./internal/...`。
