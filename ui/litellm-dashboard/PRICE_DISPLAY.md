# 价格显示

设置入口：Settings → Admin Settings → 价格显示。全局默认 USD；模型详情概览下方可选价格显示币种，默认跟随系统。

显示偏好保存在当前浏览器的 localStorage，按站点隔离；同站点标签页同步。不会写入数据库，也不会跨浏览器同步。模型部署 ID 优先，模型名称用于仅有名称的 Model Hub、用量和 Playground 展示。

金额换算只发生在最终格式化时。API 数据、计费、预算校验、排序、聚合及金额编辑框继续使用 USD。原始 JSON、请求响应、配置示例、API 响应和数值 CSV 导出保持原单位；打印价格报告使用显示币种。跨模型图表的共同坐标轴使用全局币种，具体模型的价格和费用详情使用模型偏好。

## 汇率

默认数据源为 [Frankfurter](https://frankfurter.dev/v1/) 的 ECB 每日参考汇率。使用官方继续支持的 v1 接口：
`https://api.frankfurter.dev/v1/latest?base=USD`。

浏览器每小时刷新，请求不携带 Cookie、认证头或 Referer。周末和假期可以使用最近发布日的汇率；超过 10 天、基准不是 USD、非正数、非有限数字或缺少日期的响应会被拒绝。目标币种缺少有效汇率时显示“汇率不可用”，不使用 1:1 代替，也不把美元金额标为目标币种。

可在设置中替换为支持 CORS 的 HTTPS 地址。保存前实际请求并校验。支持 Frankfurter v2 数组及以下 JSON 形状：

```json
{"base":"USD","date":"2026-09-25","rates":{"CNY":7,"EUR":0.9}}
```

上述数值仅用于说明数据格式，不是内置汇率。

## 维护入口

- `src/utils/priceDisplay.ts`：纯换算、源校验、模型币种优先级。
- `src/contexts/PriceDisplay.tsx`：浏览器偏好、TanStack Query 汇率读取、响应式金额组件与格式器。
- `src/components/PriceDisplaySettings.tsx`：全局及模型设置。
- 模型列表、模型概览/基本设置、AI Hub、公开 Model Hub：模型单价。
- Usage、Old Usage、Activity、用户/团队/组织/项目、Virtual Keys、已删除实体：金额与预算展示。
- Logs 表格、悬浮费用明细、日志详情、请求响应消息卡片、会话模拟、审计日志：费用展示。
- Playground/模型对比/Prompt 对话、MCP/Agent/透传费用、价格计算器及打印报告：单次费用及估算。

新增金额展示使用 `Money` 或 `useMoneyFormatter`，不要用通用数字格式器换算数据。静态表格列使用 `Money` 订阅汇率变化；需要字符串的图表、Tooltip 等使用响应式格式器。金额输入标签明确标注 USD。
