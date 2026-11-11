import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import type { BuiltinGeneratedImage } from "../../capabilities/ImageGenerationCapability";

/** Image bytes live in the content-addressed image store. User prompts are not needed for replay. */
export type ImageCompletionAsset = Omit<BuiltinGeneratedImage, "b64Json" | "prompt"> & {
	/** Paid position in the plan declared by the image tool. Earlier operations have no stored plan. */
	readonly target?: { readonly index: number; readonly count: number };
};

export const imageCompletions = pgTable("LiteLLM_ImageCompletion", {
	id: text("id").primaryKey(),
	scope: text("scope").notNull(),
	requestHash: text("request_hash").notNull(),
	action: text("action").$type<"create" | "edit">().notNull(),
	toolCallId: text("tool_call_id").notNull(),
	status: text("status").$type<"running" | "completed" | "unknown">().notNull(),
	assets: jsonb("assets").$type<ImageCompletionAsset[]>().notNull().default([]),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const imageCompletionAnchors = pgTable(
	"LiteLLM_ImageCompletionAnchor",
	{
		scope: text("scope").notNull(),
		anchor: text("anchor").notNull(),
		replyId: text("reply_id").notNull(),
		operationId: text("operation_id")
			.notNull()
			.references(() => imageCompletions.id, { onDelete: "cascade" }),
	},
	(table) => [primaryKey({ columns: [table.scope, table.anchor, table.replyId, table.operationId] })],
);
