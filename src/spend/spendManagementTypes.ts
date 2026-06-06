/**
 * SpendManagement 共享类型
 *
 * 集中 Drizzle Column 抽象类型 / SortableSpendLogField union 等跨文件共享类型，
 * 避免在每个 endpoint 文件里重复定义。
 */

import type { SQL } from "drizzle-orm";

/** Drizzle 列 / SQL 表达式抽象类型（参数化给 sql\`${col} ASC\` 用） */
export type Column = SQL | unknown;
