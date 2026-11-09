import { integer, jsonb, pgTable, text, timestamp, index } from "drizzle-orm/pg-core";

/**
 * SpendLog 内容寻址块存储。
 *
 * 累积式聊天快照会把同一段对话在同一个请求里重复存三份（`messages`、
 * `proxy_server_request.body.messages`、上游请求体），跨轮次又把整段历史重存一遍。
 * 这里按单条消息内容寻址存储一次，SpendLogs 里只保留引用 id 列表。
 *
 * `block_id` 是内容规范化 JSON 的 SHA-256 前 128 位（base64url，22 字符）；
 * 相同内容永远得到同一个 id，因此写侧可以盲插 `ON CONFLICT DO NOTHING`，
 * 不需要先查询是否已存在。`byte_size` 是规范化 JSON 的字节长度，供会话时间线
 * 计算页面体积预算，读取时无需 detoast 块内容。
 *
 * 表只增不删：块被跨请求共享，按时间清理会打破仍在使用它的行。
 */
export const liteLLM_SpendLogBlocks = pgTable(
	"LiteLLM_SpendLogBlocks",
	{
		blockId: text("block_id").notNull().primaryKey(),
		payload: jsonb("payload").notNull(),
		byteSize: integer("byte_size").notNull(),
		firstSeen: timestamp("first_seen", { precision: 3 }).defaultNow().notNull(),
	},
	(table) => ({
		firstSeenIdx: index("LiteLLM_SpendLogBlocks_first_seen_idx").on(table.firstSeen),
	}),
);
