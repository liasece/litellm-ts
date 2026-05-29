/**
 * Embedding 响应类型
 *
 * 兼容 OpenAI Embeddings API 格式。
 * 参考: OpenAI Embeddings API 文档
 */

/** Embedding 向量数据 */
export interface EmbeddingData {
	/** 对象类型，固定为 "embedding" */
	object: "embedding";
	/** 浮点数数组表示的 embedding 向量 */
	embedding: number[];
	/** 在输入列表中的索引 */
	index: number;
}

/** Embedding API 响应 */
export interface EmbeddingResponse {
	/** 对象类型，固定为 "list" */
	object: "list";
	/** embedding 数据列表 */
	data: EmbeddingData[];
	/** 使用的模型名称 */
	model: string;
	/** Token 用量统计 */
	usage?: {
		/** 提示 token 数 */
		prompt_tokens: number;
		/** 补全 token 数 */
		completion_tokens: number;
		/** 总 token 数 */
		total_tokens: number;
	};
}
