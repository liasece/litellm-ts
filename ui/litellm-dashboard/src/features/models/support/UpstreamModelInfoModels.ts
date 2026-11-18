/**
 * 上游模型信息的类型与格式化。
 *
 * 后端 `/model/upstream_info` 与 `/v2/model/info` 里的 `upstream_model_info` 是同一份
 * 结构：上游给出的 model_info 语义字段 + 抓取时间 + 哪些字段真的被代理采用了。界面
 * 不猜字段含义，只按这里声明的映射展示。
 */

/** 后端返回的上游信息块。 */
export interface UpstreamModelInfoPayload {
	readonly source: string;
	readonly upstream_model: string;
	readonly display_name?: string;
	readonly status: "ok" | "unsupported" | "error";
	readonly stale: boolean;
	readonly fetched_at: string;
	readonly expires_at: string;
	readonly error?: string;
	readonly model_info: Record<string, unknown> | null;
	readonly raw: Record<string, unknown> | null;
	readonly filled_fields: readonly string[];
}

/** `/model/upstream_info` 的单条部署条目。 */
export interface UpstreamModelInfoEntry {
	readonly model_name: string;
	readonly model_id: string;
	readonly provider: string | null;
	readonly upstream_model_info: UpstreamModelInfoPayload | null;
}

/** 展示顺序与中文标签；也决定气泡里出现哪些行。 */
export const UPSTREAM_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
	["max_input_tokens", "上下文窗口"],
	["max_output_tokens", "最大输出"],
	["input_cost_per_token", "输入单价"],
	["output_cost_per_token", "输出单价"],
	["cache_read_input_token_cost", "缓存读取单价"],
	["cache_creation_input_token_cost", "缓存写入单价"],
	["supports_vision", "图片输入"],
	["supports_function_calling", "工具调用"],
	["supports_reasoning", "推理"],
	["supports_response_schema", "结构化输出"],
];

/**
 * token 数量转成易读形式：1M / 131K / 8192。
 * @param value - token 数
 */
export function formatTokenCount(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return "—";
	}
	if (value >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
	}
	if (value >= 1_000) {
		const thousands = value / 1_000;
		return `${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}K`;
	}
	return String(value);
}

/**
 * per-token 单价转成「每百万 token」的美元展示。
 * @param value - per-token 价格
 */
export function formatCostPerMillion(value: unknown): string {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
		return "—";
	}
	const perMillion = value * 1_000_000;
	const digits = perMillion >= 1 ? 2 : perMillion >= 0.01 ? 3 : 4;
	return `$${perMillion.toFixed(digits)}`;
}

/**
 * 单字段展示值：成本字段换算成每百万，布尔显示 支持/不支持，数字按 token 格式化。
 * @param field - model_info 字段名
 * @param value - 字段值
 */
export function formatUpstreamField(field: string, value: unknown): string {
	if (typeof value === "boolean") {
		return value ? "支持" : "不支持";
	}
	if (field.includes("cost") || field.includes("price")) {
		return formatCostPerMillion(value);
	}
	return formatTokenCount(value);
}

/** 气泡里的一行。 */
export interface UpstreamFieldRow {
	readonly field: string;
	readonly label: string;
	readonly value: string;
}

/**
 * 从载荷里挑出能展示的行；没有值的字段直接省略。
 * @param payload - 上游信息块
 * @param fields - 只展示这些字段（例如费用气泡只看单价，不把上下文长度混进来）
 */
export function upstreamFieldRows(payload: UpstreamModelInfoPayload, fields?: readonly string[]): UpstreamFieldRow[] {
	const info = payload.model_info;
	if (info === null) {
		return [];
	}
	const allowed = fields === undefined ? undefined : new Set(fields);
	const rows: UpstreamFieldRow[] = [];
	for (const [field, label] of UPSTREAM_FIELD_LABELS) {
		if (allowed !== undefined && !allowed.has(field)) {
			continue;
		}
		const value = info[field];
		if (value === undefined || value === null) {
			continue;
		}
		rows.push({ field: field, label: label, value: formatUpstreamField(field, value) });
	}
	return rows;
}

/** 计费相关字段；费用位置的提示只展示这些。 */
export const UPSTREAM_PRICE_FIELDS: readonly string[] = [
	"input_cost_per_token",
	"output_cost_per_token",
	"cache_read_input_token_cost",
	"cache_creation_input_token_cost",
];

/**
 * 这个位置是否真的该显示上游提示。
 *
 * 图标是「你看到的这个值来自上游」的标记，不是「上游有资料」的入口：没有真实的
 * 上游取值时就什么都不显示，避免每个模型名、每个费用格都挂一个图标。
 * @param payload - 上游信息块；未加载时为 undefined
 * @param field - 当前展示的值对应的字段；模型名等非字段位置为 undefined
 * @param used - 调用方明确知道该值来自上游时传 true（历史行不能按当前配置推断）
 */
export function shouldShowUpstreamHint(
	payload: UpstreamModelInfoPayload | undefined,
	field: string | undefined,
	used: boolean | undefined,
): boolean {
	// 调用方明确知道是不是上游取值时以此为准；不知道（undefined）才回落到 filled_fields。
	if (used !== undefined) {
		return used;
	}
	if (payload === undefined || field === undefined) {
		return false;
	}
	return payload.filled_fields.includes(field);
}

/**
 * 抓取/过期时间的短展示（本地时区，精确到分钟）。
 * @param iso - ISO 时间
 */
export function formatFreshness(iso: string): string {
	const date = new Date(iso);
	return Number.isNaN(date.getTime())
		? "—"
		: date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
