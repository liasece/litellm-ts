# LiteLLM Dashboard 前端契约

本目录使用 React 18 与 Next.js 16 App Router。除非有单独的迁移设计和验证，不要升级到 React 19。

- 当前管理后台以 Client Component 为主。不得在局部功能改动中无计划引入 React Server Component
  或 Server Action；如需改变渲染边界，应先说明数据流、缓存、认证和回退方案。
- 服务端状态优先沿用现有 TanStack Query 模式，不得为局部需求新增状态管理库。
- `useEffect` 只用于与浏览器 API、网络、订阅等外部系统同步，不用于计算能从 props、URL 或其他
  state 直接派生的值；这类值应在渲染时计算，必要时使用纯函数或 `useMemo`。
- 不得随意关闭 `react-hooks/exhaustive-deps`，也不得全局关闭 React Hooks 或 Next.js 核心规则来
  掩盖存量问题。确需例外时，应在最小作用域说明理由并有测试覆盖。
- `eslint-suppressions.json` 是启用 Next 16 规则时记录的存量错误基线。不得增加 suppression
  数量；修复存量问题后运行 `eslint . --prune-suppressions` 收紧基线。
- 新增路径路由时，必须兼容现有 legacy `?page=...` 路由，并同步更新路径到导航选中项的映射及测试。
- 前端改动至少运行 ESLint、相关 Vitest 和 Next.js production build；同时检查 TypeScript。仓库内
  既有测试夹具类型错误应单独记录，不得用放宽生产类型检查来绕过。
