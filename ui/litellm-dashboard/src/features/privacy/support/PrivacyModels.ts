/** 脱敏观测页的数据模型（与后端 `/privacy/*` 的响应字段一致）。 */

/** 汇总卡片 */
export interface PrivacySummary {
	/** 替换处数 */
	readonly occurrences: number;
	/** 不同值数量 */
	readonly distinctValues: number;
	/** 请求数 */
	readonly requests: number;
	/** 无法还原的占位符数量 */
	readonly unresolved: number;
}

/** 分组统计行 */
export interface PrivacyBreakdownRow {
	/** 分组名 */
	readonly name: string;
	/** 处数 */
	readonly occurrences: number;
	/** 请求数（类型分组不返回该字段） */
	readonly requests?: number;
	/** 类型分组下的值数量 */
	readonly values?: number;
}

/** 概览 */
export interface PrivacyOverview {
	/** 时间范围（天） */
	readonly days: number;
	/** 汇总 */
	readonly summary: PrivacySummary;
	/** 按客户端 */
	readonly byClient: readonly PrivacyBreakdownRow[];
	/** 按提供方 */
	readonly byProvider: readonly PrivacyBreakdownRow[];
	/** 按类型 */
	readonly byKind: readonly PrivacyBreakdownRow[];
	/** 最近 24 小时曲线 */
	readonly series: ReadonlyArray<{ readonly bucket: string; readonly occurrences: number }>;
}

/** 请求级明细 */
export interface PrivacyRequestRow {
	/** 请求 ID */
	readonly requestId: string;
	/** 时间 */
	readonly createdAt: string;
	/** 客户端 */
	readonly client: string;
	/** 提供方 */
	readonly provider: string;
	/** 模型 */
	readonly model: string;
	/** 处数 */
	readonly occurrences: number;
	/** 值数 */
	readonly distinctValues: number;
	/** 类型分布 */
	readonly kinds: Readonly<Record<string, number>>;
	/** 处置动作 */
	readonly action: string;
	/** 耗时 */
	readonly durationMs: number;
	/** 无法还原数量 */
	readonly unresolved: number;
}

/** 值级明细 */
export interface PrivacyValueRow {
	/** 类型 */
	readonly kind: string;
	/** 指纹 */
	readonly hash: string;
	/** 原文长度 */
	readonly length: number;
	/** 前 3 个字符 */
	readonly hint: string;
	/** 出现次数 */
	readonly occurrences: number;
	/** 涉及请求数 */
	readonly requests: number;
	/** 涉及的客户端 */
	readonly clients: readonly string[];
	/** 最近出现时间 */
	readonly lastSeen: string;
}

/** 分页结果 */
export interface PrivacyListPage<T> {
	/** 行 */
	readonly rows: readonly T[];
	/** 是否还有更多 */
	readonly hasMore: boolean;
}

/** 列表查询 */
export interface PrivacyListQuery {
	/** 时间范围（天） */
	readonly days: number;
	/** 客户端过滤 */
	readonly client?: string;
	/** 提供方过滤 */
	readonly provider?: string;
	/** 类型过滤 */
	readonly kind?: string;
	/** 条数 */
	readonly limit: number;
	/** 偏移 */
	readonly offset: number;
}

/** 生效配置 */
export interface PrivacySettings {
	/** 总开关 */
	readonly enabled: boolean;
	/** 处置动作 */
	readonly action: string;
	/** 按类型处置 */
	readonly kinds: Readonly<Record<string, string>>;
	/** 自定义词条 */
	readonly customWords: readonly unknown[];
	/** 永不脱敏 */
	readonly neverMask: readonly string[];
	/** 是否脱敏配置里的密钥 */
	readonly maskConfiguredSecrets: boolean;
	/** 脱敏异常时是否拒绝请求 */
	readonly failClosed: boolean;
	/** 保留天数 */
	readonly retentionDays: number;
}

/** 设置写入内容 */
export interface PrivacySettingsPatch {
	/** 总开关 */
	readonly enabled?: boolean;
	/** 处置动作 */
	readonly action?: "mask" | "warn";
}

/** 接口集合（便于测试注入） */
export interface PrivacyApi {
	/** 概览 */
	overview(days: number, signal?: AbortSignal): Promise<PrivacyOverview>;
	/** 请求明细 */
	requests(query: PrivacyListQuery, signal?: AbortSignal): Promise<PrivacyListPage<PrivacyRequestRow>>;
	/** 值明细 */
	values(query: PrivacyListQuery, signal?: AbortSignal): Promise<PrivacyListPage<PrivacyValueRow>>;
	/** 读取配置 */
	settings(signal?: AbortSignal): Promise<PrivacySettings>;
	/** 写入配置 */
	updateSettings(patch: PrivacySettingsPatch, signal?: AbortSignal): Promise<PrivacySettings>;
}
