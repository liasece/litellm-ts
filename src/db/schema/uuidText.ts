import { randomUUID } from "node:crypto";
import { text } from "drizzle-orm/pg-core";

/**
 * Prisma `String @default(uuid())`：应用层生成 UUID，但 PostgreSQL 物理列仍为无默认值的 TEXT。
 * @param name
 */
export function uuidText<TName extends string>(name: TName) {
	return text(name).$defaultFn(randomUUID);
}
