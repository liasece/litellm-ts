import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Content-addressed image storage used by built-in capabilities.
 *
 * The SHA-256 digest is calculated from decoded image bytes. Identical image
 * bytes therefore share one row even when clients use different base64
 * formatting or source URLs.
 */
export const liteLLM_BuiltinCapabilityImages = pgTable("LiteLLM_BuiltinCapabilityImages", {
	contentHash: text("content_hash").primaryKey().notNull(),
	mediaType: text("media_type").notNull(),
	base64Data: text("base64_data").notNull(),
	byteSize: integer("byte_size").notNull(),
	createdAt: timestamp("created_at", { precision: 3 }).defaultNow().notNull(),
});
