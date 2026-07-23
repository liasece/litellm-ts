import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * 缓存配置表 - LiteLLM_CacheConfig (固定单行表)
 */
export const LiteLLM_CacheConfig = pgTable("LiteLLM_CacheConfig", {
	id: text("id").default("cache_config").primaryKey().notNull(),
	cache_settings: jsonb("cache_settings").notNull(),
	created_at: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
	updated_at: timestamp("updated_at", { precision: 3 })
		.$defaultFn(() => new Date())
		.$onUpdate(() => new Date())
		.notNull(),
});
