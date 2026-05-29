/**
 * 通用 API 响应类型
 * 供端点定义引用，统一响应格式
 */

/**
 * 操作成功响应（携带泛型业务数据）
 * @template T - 业务数据类型
 */
export interface SuccessResponse<T = unknown> {
	/** 固定为 true，标识操作成功 */
	readonly success: true;
	/** 业务数据（可选） */
	readonly data?: T;
	/** 响应消息（可选） */
	readonly message?: string;
}

/**
 * 错误响应
 */
export interface ErrorResponse {
	/** 固定为 false，标识操作失败 */
	readonly success: false;
	/** 面向用户的错误描述 */
	readonly message: string;
	/** 错误码（可选，用于客户端区分错误类型） */
	readonly code?: string;
}

/**
 * 分页响应
 * @template T - 列表项数据类型
 */
export interface PaginatedResponse<T> {
	/** 列表数据 */
	readonly data: readonly T[];
	/** 当前页码（从 1 开始） */
	readonly page: number;
	/** 每页条数 */
	readonly pageSize: number;
	/** 总记录数 */
	readonly total: number;
	/** 是否有下一页 */
	readonly hasMore: boolean;
}
