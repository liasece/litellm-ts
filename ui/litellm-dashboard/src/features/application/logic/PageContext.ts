import type { ComputedRef, InjectionKey } from "vue";

/**
 * 当前页面 id（ApplicationRoot 从 URL 解析后提供）。
 *
 * 模型管理、用量统计各自用一个组件承载多个页面 id：组件从这份 id 推断分区，
 * 而不是自己再解析一次路径，避免 root path 前缀在两处算出不同结果。
 */
export const currentPageKey: InjectionKey<ComputedRef<string>> = Symbol("dashboard-current-page");
