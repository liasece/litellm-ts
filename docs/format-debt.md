# TypeScript 格式债清单

`make ci` 与 `make ci-full` 都会执行 `npx prettier --check "src/**/*.ts"`。本清单记录当前工作区中
仍会阻断该检查的文件；这些文件属于其他并行开发中的修改，不应由本次门禁改造顺手重写。

快照：2026-11-22，HEAD `d7ecf95`。刷新清单：`npx prettier --list-different "src/**/*.ts"`。

## 清除方式

1. 等对应修改的负责人完成并提交文件。
2. 对本清单逐文件执行 `npx prettier --write <path>`，或在确认文件归属后运行受控的
   `npx prettier --write "src/**/*.ts"`。
3. 运行 `npx prettier --check "src/**/*.ts"` 与 `make ci` 验证清单归零。

不要通过 `.prettierignore` 排除 `src/` 源码，也不要在格式检查失败时跳过该门禁。

## 已跟踪但尚未提交（49）

```text
src/auth/AuthorizationGuard.test.ts
src/auth/AuthRepositoryCache.ts
src/capabilities/BuiltinCapabilityAudit.ts
src/capabilities/ImageCompletionTranscript.ts
src/capabilities/ImageGenerationCapability.ts
src/capabilities/VisionCapability.ts
src/capabilities/WebCapabilityExecution.ts
src/core/api/RequestArrival.ts
src/management/InternalUserEndpoint.ts
src/management/KeyManagementEndpoint.ts
src/management/OrganizationEndpoint.ts
src/management/TeamEndpoint.ts
src/observability/HttpMetrics.ts
src/observability/RequestTrace.ts
src/privacy/PrivacyMiddleware.ts
src/proxy/AnthropicMessagesEndpoint.ts
src/proxy/ChatCompletionsEndpoint.ts
src/proxy/CompletionsEndpoint.ts
src/proxy/CostTrackingEndpoints.ts
src/proxy/EmbeddingsEndpoint.ts
src/proxy/LoginEndpoints.ts
src/proxy/ResponsesApiEndpoints.ts
src/proxy/SearchToolsEndpoints.ts
src/proxy/WebUiSupportEndpoints.ts
src/repositories/ConfigRepository.ts
src/repositories/ModelRepository.ts
src/router/ProviderRequestExecutor.ts
src/router/SubscriptionDispatch.ts
src/spend/ActiveRequestJournal.test.ts
src/spend/ActiveRequestJournal.ts
src/spend/logStreamWebSocket.test.ts
src/spend/logStreamWebSocket.ts
src/spend/ModelSpeedEndpoint.ts
src/spend/sessionTimelineLive.ts
src/spend/SpendLogBlocks.ts
src/spend/spendLogsEndpoints.ts
src/spend/SpendManagementEndpoint.test.ts
src/spend/SpendTracker.test.ts
src/spend/SpendTracker.ts
src/spend/spendVisibility.ts
src/spend/UiLogDetail.ts
src/subscriptions/native/bridge.ts
src/subscriptions/native/protocol/request.test.ts
src/subscriptions/native/protocol/response.test.ts
src/subscriptions/native/protocol/stream.test.ts
src/subscriptions/native/providers/commandcode.test.ts
src/subscriptions/native/scheduler.ts
src/subscriptions/native/upstream/service.ts
src/types/spend.ts
```

## 尚未跟踪的新文件（20）

```text
src/repositories/ActiveRequestRepository.ts
src/repositories/BudgetRepository.ts
src/repositories/BuiltinCapabilityImageRepository.ts
src/repositories/EndUserRepository.ts
src/repositories/KeyRepository.ts
src/repositories/OrganizationRepository.ts
src/repositories/SearchToolRepository.ts
src/repositories/SessionTimelineRepository.test.ts
src/repositories/SessionTimelineRepository.ts
src/repositories/SpendLogRepository.ts
src/repositories/SpendReportingRepository.test.ts
src/repositories/SpendReportingRepository.ts
src/repositories/SpendReservationRepository.ts
src/repositories/TeamRepository.ts
src/repositories/UpstreamKeyAccountRepository.ts
src/repositories/UserRepository.ts
src/repositories/WebUiSupportRepository.ts
src/shared/UpstreamKeyHash.ts
src/spend/ScopedCostEndpoint.test.ts
src/spend/SpendReservation.test.ts
```