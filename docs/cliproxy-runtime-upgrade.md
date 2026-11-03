# CLIProxy 升级/重启前的降级与排空

托管 CLIProxy 的升级、回滚、配置应用与手动重启都会重启 `cli-proxy-api` 子进程。直接重启会把
正在写的 SSE 连接掐断：2026-11-03 03:53:44 升到 8.0.52 时，7 条在途请求同时以 `terminated`
失败，客户端只看到截断的响应。

因此重启路径固定为四步（实现在 `src/cliproxy/CliProxyDrainGate.ts`，由
`CliProxyRuntimeManager._restartProcess()` 调用）：

1. **降级**：`beginCliProxyDrain()` 之后，`Router.getAvailableDeployment()` 不再选中
   CLIProxy deployment。新请求按既有 fallback 链落到非 CLIProxy 候选（例如
   `commandcode/deepseek/deepseek-v4.1-flash` → `deepseek-v4-flash`）。
   组内只有 CLIProxy deployment 时返回「无可用部署」，由 Router 继续走 fallback。
2. **排空**：`awaitCliProxyIdle()` 等待在途请求归零。在途数由两部分相加：
   - Router 侧：`Router.getActiveRequestCount()`，按 `custom_llm_provider`/模型前缀识别
     CLIProxy deployment，容器启动时注入给运行时管理器。
   - 直连端点侧：原生 passthrough 与原生 Responses/Messages 端点自己记的计数
     （`trackCliProxyRequest()`），这些端点不经过 Router。
3. **升级**：切换 `current` 软链、重新投影 `config.yaml`、重启进程。
4. **恢复**：无论升级成功还是失败，`finally` 都会 `endCliProxyDrain()`，新请求重新进入
   CLIProxy。升级失败不会把运行时永久留在降级态。

## 超时与降级语义

排空有上限，默认 120 秒（与线上单条流常见的 60~120 秒生成时长对齐），可用环境变量 `CLIPROXY_DRAIN_TIMEOUT_SECONDS` 调整（`0` 表示不等待）：

- 进程本来就不在运行（崩溃重启）时跳过等待，避免拖慢恢复。
- 超时后记录剩余在途数并继续重启。被截断的流由 Router 的流式 fallback 兜底
  （见 `src/router/StreamOutputVisibility.ts`：只有已下发答案内容才不重放，包络与思考阶段
  断流都会切换候选）。

## 可观察状态

- `GET /cliproxy/status` 新增 `draining` 与 `in_flight_requests` 两个字段。
- CLIProxy 日志会出现三段：`进入降级`、`排空完成/排空超时`、`已退出降级`。

## 影响与回滚边界

- 影响：升级窗口内 CLIProxy 模型的请求会短暂切到 fallback 候选；没有 fallback 的模型组会
  返回「无可用部署」。直连端点（Codex/Claude Code 等）在降级期间明确返回 503，而不是被截断。
- 回滚：改动只涉及降级闸门、选择时的过滤与重启包装；回滚这些文件即恢复「直接重启」的行为，
  不涉及 CPA 二进制、配置结构或数据库迁移。
