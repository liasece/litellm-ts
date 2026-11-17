import type { LogEntry } from "../support/LogsModels";
import { appliedFeatures } from "./LogsAppliedFeaturesLogic";
import { asRecord } from "./PrettyMessagesBlocksLogic";
import { PRIVACY_PLACEHOLDER_PATTERN, privacyKindLabel } from "../../content/logic/PrivacyPlaceholderLogic";

/** 日志详情里展示的一条脱敏占位符，按 token 归并。 */
export interface PrivacyReplacement {
	/** 网关写入的占位符原文，例如 `{{EMAIL_abcd2345}}` */
	readonly token: string;
	/** 占位符类型，例如 `EMAIL` */
	readonly kind: string;
	/** 类型的中文展示名 */
	readonly kindLabel: string;
	/** 在所有已加载内容中的出现次数 */
	readonly occurrences: number;
	/** 出现的位置，例如 `Upstream request` */
	readonly locations: readonly string[];
	/** 字段路径，例如 `input[2].content[0].text` */
	readonly field: string;
	/** 首次出现位置附近的一段上下文，不包含原文 */
	readonly context: string;
}

/** Privacy 区块的展示模型。 */
export interface PrivacyReplacementView {
	/** 当前请求是否有脱敏记录或占位符 */
	readonly visible: boolean;
	/** 替换处数，优先使用 capabilities 账本中的次数 */
	readonly occurrences: number;
	/** 不同占位符数量；正文不可用时为 0 */
	readonly distinctValues: number;
	/** 类型摘要，例如 `邮箱 ×2` */
	readonly summary: string;
	/** capabilities 账本里的原始摘要，例如 `EMAIL×2` */
	readonly featureDetail: string;
	/** 占位符明细 */
	readonly replacements: readonly PrivacyReplacement[];
}

interface ContentRoot {
	readonly label: string;
	readonly value: unknown;
}

interface WalkState {
	nodes: number;
	readonly seen: WeakSet<object>;
}

const MAX_DEPTH = 18;
const MAX_NODES = 50_000;
const CONTEXT_RADIUS = 80;

/** 只扫描正文来源；metadata 里的副本会把同一处替换重复计算。 */
function contentRoots(log: LogEntry): ContentRoot[] {
	const proxy = asRecord(log.proxy_server_request);
	return [
		{ label: "Request", value: log.messages },
		{ label: "Response", value: log.response },
		{ label: "Upstream request", value: proxy?.upstream_request ?? proxy?.upstreamRequest },
		{ label: "Upstream response", value: proxy?.upstream_response ?? proxy?.upstreamResponse },
	];
}

function pathStep(path: string, key: string | number): string {
	if (typeof key === "number") return `${path}[${key}]`;
	return path ? `${path}.${key}` : key;
}

function fieldLabel(root: string, path: string): string {
	let field = path;
	if (root.startsWith("Upstream ") && field.startsWith("body.")) field = field.slice("body.".length);
	if (root === "Request" && field.startsWith("messages")) field = field.slice("messages".length).replace(/^\./, "");
	if (root === "Response" && field.startsWith("response")) field = field.slice("response".length).replace(/^\./, "");
	return field || "content";
}

function contextAround(text: string, index: number, length: number): string {
	const start = Math.max(0, index - CONTEXT_RADIUS);
	const end = Math.min(text.length, index + length + CONTEXT_RADIUS);
	const body = text.slice(start, end).replace(/\s+/g, " ").trim();
	return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "");
}

function walkStrings(
	value: unknown,
	root: ContentRoot,
	path: string,
	depth: number,
	state: WalkState,
	visit: (root: ContentRoot, path: string, text: string) => void,
): void {
	if (depth > MAX_DEPTH || state.nodes++ > MAX_NODES || value === null || value === undefined) return;
	if (typeof value === "string") {
		visit(root, path, value);
		return;
	}
	if (typeof value !== "object") return;
	if (state.seen.has(value)) return;
	state.seen.add(value);
	if (Array.isArray(value)) {
		value.forEach((item, index) => walkStrings(item, root, pathStep(path, index), depth + 1, state, visit));
		return;
	}
	for (const [key, child] of Object.entries(value)) {
		walkStrings(child, root, pathStep(path, key), depth + 1, state, visit);
	}
}

/**
 * 提取日志详情中实际出现的脱敏占位符。
 *
 * 原文按 Privacy 的持久化契约不会进入 SpendLogs，所以这里只读取占位符本身及其上下文；
 * capabilities 账本用来覆盖「正文尚未加载 / 已归档」时仍能显示发生过替换的情况。
 * @param log - 详情抽屉中的日志
 */
export function privacyReplacementView(log: LogEntry): PrivacyReplacementView {
	const feature = appliedFeatures(log).find((item) => item.id === "privacy");
	const replacements = new Map<string, PrivacyReplacement>();

	for (const root of contentRoots(log)) {
		walkStrings(root.value, root, "", 0, { nodes: 0, seen: new WeakSet() }, (source, path, text) => {
			const pattern = new RegExp(PRIVACY_PLACEHOLDER_PATTERN.source, "g");
			for (const match of text.matchAll(pattern)) {
				const token = match[0];
				const kind = match[1];
				const index = match.index ?? 0;
				const field = fieldLabel(source.label, path);
				const existing = replacements.get(token);
				if (existing) {
					replacements.set(token, {
						...existing,
						occurrences: existing.occurrences + 1,
						locations: existing.locations.includes(source.label) ? existing.locations : [...existing.locations, source.label],
					});
				} else {
					replacements.set(token, {
						token,
						kind,
						kindLabel: privacyKindLabel(kind),
						occurrences: 1,
						locations: [source.label],
						field,
						context: contextAround(text, index, token.length),
					});
				}
			}
		});
	}

	const rows = [...replacements.values()];
	const kindCounts = new Map<string, number>();
	for (const row of rows) kindCounts.set(row.kindLabel, (kindCounts.get(row.kindLabel) ?? 0) + row.occurrences);
	const tokenOccurrences = rows.reduce((sum, row) => sum + row.occurrences, 0);
	// 账本对「只替换了 1 处」省略 count 字段，列表徽标按 1 次展示；这里必须用同一口径，
	// 否则单处替换的请求会在详情里显示 0 replacements。账本存在时以它为准：模型可能把
	// 占位符复述到正文里，按内容扫描求和会比实际替换处数大，两处显示就会对不上。
	const featureCount = feature === undefined ? 0 : Math.max(1, feature.count ?? 1);
	const featureDetail = feature?.detail ?? "";
	const scanSummary = [...kindCounts].map(([label, count]) => `${label} ×${count}`).join(" · ");
	const summary = featureDetail.length > 0 ? localizeKindsDetail(featureDetail) : scanSummary;

	return {
		visible: feature !== undefined || rows.length > 0,
		occurrences: feature === undefined ? tokenOccurrences : featureCount,
		distinctValues: rows.length,
		summary,
		featureDetail,
		replacements: rows,
	};
}

/**
 * 把账本里的类型摘要（`EMAIL×2, SECRET×1`）换成与行内标签一致的中文类型名。
 * 认不出的写法原样保留，避免解析失败时把摘要清空。
 * @param detail - 账本 detail 字段
 */
function localizeKindsDetail(detail: string): string {
	const parts: string[] = [];
	for (const match of detail.matchAll(/([A-Z][A-Z0-9_]{1,23})\s*×\s*(\d+)|(\+\d+)/g)) {
		if (match[3] !== undefined) {
			parts.push(match[3]);
			continue;
		}
		parts.push(`${privacyKindLabel(match[1])} ×${match[2]}`);
	}
	return parts.length > 0 ? parts.join(" · ") : detail;
}
