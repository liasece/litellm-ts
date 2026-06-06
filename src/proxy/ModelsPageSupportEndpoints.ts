/**
 * Models 页面支撑端点
 *
 * Python LiteLLM Dashboard 的 Models 页面需要一批带鉴权的端点来获取
 * 模型详情、模型组信息、成本映射和 pass-through 配置。
 * 这些端点缺失时 WebUI 会出现 client-side exception。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
 *
 * 关键端点说明：
 * - /v2/model/info：WebUI Models 主表数据源。Python 行为是按 Router deployments
 *   构造带分页的响应（{ data, total_count, current_page, total_pages, size }）。
 *   此实现早期是空 stub，会让 WebUI 在主表空数据时走入异常分支甚至卡死。
 * - /model_group/info：AI Hub / Models 页面左侧模型组下拉的数据源。
 *   必须返回 { data: [...] } 数组，否则前端 modelHubData?.data?.find 会抛
 *   "n.find is not a function"。
 */

import type { Router as ExpressRouter } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError, HTTP_STATUS } from "../core/api/ApiError";
import { parsePositiveInt, firstQueryString } from "../core/api/queryParams";
import type { ServiceConfig } from "../core/config";
import type { Deployment, LitellmParams } from "../types/router";
import type { ModelInfo } from "../types/config";
import type { Router } from "../router/Router";
import { SUPPORTS_FLAGS, type SupportsFlag, buildModelGroupInfoResponse, pickRpm, pickTpm } from "./modelGroupBuilder";

/** /v2/model/info 分页默认值与边界常量 */
const DEFAULT_MODEL_INFO_PAGE = 1;
const DEFAULT_MODEL_INFO_PAGE_SIZE = 50;
const EMPTY_TOTAL_PAGES = 0;
const MIN_TOTAL_PAGES = 1;

/** 排序方向（对齐 Python LiteLLM 默认 asc） */
const enum ModelInfoSortOrder {
	Asc = "asc",
	Desc = "desc",
}

/** /v2/model/info 允许的 sortBy 字段白名单。未知值在解析阶段回退到 model_name。 */
enum ModelInfoSortField {
	MODEL_NAME = "model_name",
	ID = "id",
}

const DEFAULT_MODEL_INFO_SORT_BY = ModelInfoSortField.MODEL_NAME;

/**
 * Router 部署访问器抽象。
 * 允许测试用最简实现注入；主流程用 container.router.getDeployments()。
 */
export interface RouterDeploymentsAccessor {
	/** 返回 Router 当前持有的所有 deployments */
	getDeployments(): Deployment[];
}

/** /v2/model/info 接受的 query 形状。明确列出字段，禁止 Record<string, unknown>。 */
interface V2ModelInfoQuery {
	readonly page?: string;
	readonly size?: string;
	readonly search?: string;
	readonly modelId?: string;
	/** 当前 TS 端未实现 team 过滤，仅为协议占位，避免前端发送被默默忽略。 */
	readonly teamId?: string;
	readonly sortBy?: string;
	readonly sortOrder?: string;
}

/**
 * 从 Express req.query（类型为 qs.ParsedQs）逐字段提取 string，
 * 返回类型安全的 V2ModelInfoQuery，消除 `req.query as unknown as V2ModelInfoQuery` 双重断言。
 * @param raw - Express req.query 原始值
 */
function parseModelInfoQuery(raw: Record<string, unknown>): V2ModelInfoQuery {
	return {
		page: firstQueryString(raw.page) ?? undefined,
		size: firstQueryString(raw.size) ?? undefined,
		search: firstQueryString(raw.search) ?? undefined,
		modelId: firstQueryString(raw.modelId ?? raw.model_id) ?? undefined,
		teamId: firstQueryString(raw.teamId ?? raw.team_id) ?? undefined,
		sortBy: firstQueryString(raw.sortBy ?? raw.sort_by) ?? undefined,
		sortOrder: firstQueryString(raw.sortOrder ?? raw.sort_order) ?? undefined,
	};
}

/** Python LiteLLM 兼容分页响应（提供 current_page/page 与 total_count/total 两套别名） */
interface PaginatedModelInfoResponse {
	data: ModelInfoV2Item[];
	total_count: number;
	total: number;
	current_page: number;
	page: number;
	total_pages: number;
	size: number;
	page_size: number;
}

/** Python LiteLLM 兼容的 /v2/model/info 单元素 */
interface ModelInfoV2Item {
	model_name: string;
	litellm_params: Record<string, unknown>;
	model_info: Record<string, unknown>;
}

/** /v2/model/info 单模型查询响应 */
interface ModelInfoV1Response {
	data: ModelInfoV2Item[];
}

/**
 * 对外暴露的 litellm_params 白名单字段。
 *
 * 设计原则：仅保留 WebUI Models 页面需要的字段，避免任意字段透传后被
 * 自动回显/代理到客户端导致敏感数据泄漏。注意这是顶层白名单（浅拷贝），
 * 不会递归进入嵌套对象——extra_headers / extra_body 等可能藏 secret 的字段
 * 整体不进入 out。
 *
 * 字段名必须是 LitellmParams 实际键（keyof LitellmParams），所以只列
 * LitellmParams 接口中已声明的字段。
 */
const PUBLIC_LITELLM_PARAM_KEYS: ReadonlySet<keyof LitellmParams> = new Set<keyof LitellmParams>([
	"model",
	"api_base",
	"custom_llm_provider",
	"rpm",
	"tpm",
	"timeout",
	"stream_timeout",
	"max_retries",
	"input_cost_per_token",
	"output_cost_per_token",
]);

/**
 * 安全地构造对外暴露的 litellm_params：仅复制白名单字段并丢弃 undefined。
 *
 * 浅拷贝边界：只复制 LitellmParams 顶层键，不递归进入嵌套对象。
 * - extra_headers / extra_body 等嵌套容器整体不返回（防止 secret 泄漏）
 * - api_key 永不返回（仅作为敏感字段额外防御）
 * @param params - 内部 litellm_params
 * @returns 字段白名单的浅拷贝
 */
function buildPublicLitellmParams(params: LitellmParams): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [paramName, paramValue] of Object.entries(params)) {
		if (!PUBLIC_LITELLM_PARAM_KEYS.has(paramName as keyof LitellmParams)) {
			continue;
		}
		if (paramValue === undefined) {
			continue;
		}
		out[paramName] = paramValue;
	}
	return out;
}

/**
 * 构造模型唯一 id：优先使用 model_info.id，否则用 litellm_params.model + 序号稳定生成。
 * index 仅在大于 0 时附加 `-${index}`，避免 base-0 出现 `foo-0` 这样的非 Python 风格 id。
 * @param modelInfo - 模型元信息
 * @param dep - 部署对象
 * @param index - 同一 model_name 下的序号（用于稳定 id）
 */
function resolveModelId(modelInfo: ModelInfo | undefined, dep: Deployment, index: number): string {
	if (modelInfo?.id) {
		return modelInfo.id;
	}
	const base = dep.litellm_params.model ?? dep.model_name;
	return index === 0 ? base : `${base}-${index}`;
}

/**
 * 清理掉 undefined 字段：保持 missing/null 语义，避免 WebUI 端 `.id === undefined` 误判。
 * @template T - 对象类型
 * @param obj
 */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
	const out: Partial<T> = {};
	for (const [infoKey, infoValue] of Object.entries(obj)) {
		if (infoValue !== undefined) {
			(out as Record<string, unknown>)[infoKey] = infoValue;
		}
	}
	return out;
}

/**
 * 把一个 Deployment 投影为 /v2/model/info 单元素。
 * 严格不包含 api_key 等敏感字段。
 * @param dep - Router deployment
 * @param stableIndex - 同一 model_name 下的序号
 * @param modelInfo - 优先取自 dep.model_info；为空时使用兜底对象
 */
function buildModelInfoV2Item(dep: Deployment, stableIndex: number, modelInfo: ModelInfo | undefined): ModelInfoV2Item {
	const info: ModelInfo = modelInfo ?? {};
	const id = resolveModelId(info, dep, stableIndex);
	// 补齐 id / mode / model_name 等字段：WebUI 表格列与详情面板均依赖这些字段存在
	// （直接读取 `model_info.id` / `model_info.mode` / `model_info.model_name`，
	//  缺字段时表格渲染会显示 "undefined" 并触发排序/筛选异常）。
	const supports: Partial<Record<SupportsFlag, boolean>> = {};
	for (const flag of SUPPORTS_FLAGS) {
		if (info[flag] === true) {
			supports[flag] = true;
		}
	}
	const publicModelInfo: Record<string, unknown> = stripUndefined({
		id: id,
		mode: info.mode,
		model_name: info.model_name ?? dep.model_name,
		input_cost_per_token: info.input_cost_per_token,
		output_cost_per_token: info.output_cost_per_token,
		max_input_tokens: info.max_input_tokens,
		max_output_tokens: info.max_output_tokens,
		litellm_provider: info.litellm_provider ?? dep.litellm_params.custom_llm_provider,
		tpm: pickTpm(info, dep),
		rpm: pickRpm(info, dep),
		...supports,
		region: info.region,
	});
	return {
		model_name: dep.model_name,
		litellm_params: buildPublicLitellmParams(dep.litellm_params),
		model_info: publicModelInfo,
	};
}

/**
 * 解析排序方向，未识别值时回退到 asc。
 * @param raw - 原始 query 值
 */
function resolveSortOrder(raw: unknown): ModelInfoSortOrder {
	if (raw === ModelInfoSortOrder.Desc) {
		return ModelInfoSortOrder.Desc;
	}
	// 默认 asc：对齐 Python LiteLLM /v2/model/info 默认排序行为。
	return ModelInfoSortOrder.Asc;
}

/**
 * 解析 sortBy：仅接受 MODEL_INFO_SORT_FIELDS 白名单中的字段；
 * 未知值或非字符串值回退到 DEFAULT_MODEL_INFO_SORT_BY（model_name）。
 * @param raw - 原始 query 值
 */
function resolveSortBy(raw: unknown): ModelInfoSortField {
	if (raw === ModelInfoSortField.MODEL_NAME || raw === ModelInfoSortField.ID) {
		return raw;
	}
	return DEFAULT_MODEL_INFO_SORT_BY;
}

/**
 * 在原始 items 上做 stable 排序（仅支持预定义字段，避免任意属性读取）
 * @template T - 元素类型
 * @param items - 待排序元素
 * @param sortBy - 已校验的 ModelInfoSortField
 * @param order - asc / desc
 */
function sortItems<T extends { model_name: string; model_info: { id?: string } }>(
	items: T[],
	sortBy: ModelInfoSortField,
	order: ModelInfoSortOrder,
): T[] {
	const dir = order === ModelInfoSortOrder.Desc ? -1 : 1;
	// typed extractor map: 编译器保证每个 ModelInfoSortField 都有对应分支
	const keyOf: Record<ModelInfoSortField, (it: T) => string> = {
		[ModelInfoSortField.MODEL_NAME]: (it) => it.model_name ?? "",
		[ModelInfoSortField.ID]: (it) => it.model_info?.id ?? it.model_name ?? "",
	};
	const extractor = keyOf[sortBy];
	const indexed = items.map((item, originalIndex) => ({
		item: item,
		originalIndex: originalIndex,
		sortKey: extractor(item),
	}));
	indexed.sort((a, b) => {
		if (a.sortKey === b.sortKey) {
			// 稳定排序：原序靠前
			return a.originalIndex - b.originalIndex;
		}
		if (a.sortKey < b.sortKey) {
			return -1 * dir;
		}
		return 1 * dir;
	});
	return indexed.map((x) => x.item);
}

/**
 * 构造 /v2/model/info 分页响应
 * @param deployments - Router 全部 deployment
 * @param query - 原始 query
 */
function buildV2ModelInfoResponse(deployments: Deployment[], query: V2ModelInfoQuery): PaginatedModelInfoResponse {
	const page = parsePositiveInt(query.page, DEFAULT_MODEL_INFO_PAGE);
	const size = parsePositiveInt(query.size, DEFAULT_MODEL_INFO_PAGE_SIZE);
	const search = (query.search ?? "").trim().toLowerCase();
	const modelId = (query.modelId ?? "").trim();
	// 注意：当前 TS 端尚未实现 team 访问控制，teamId 不参与过滤，
	// 也不读取 query.teamId（避免日后改回时与"已读未用"语义混淆）。
	const sortBy = resolveSortBy(query.sortBy);
	const sortOrder = resolveSortOrder(query.sortOrder);

	// 先按 model_name 分组并给每个分组内 deployment 一个 stable index，
	// 用于生成可重复的 id（与 Router 持有顺序一致 → 多次请求得到相同 id）。
	const grouped = new Map<string, Deployment[]>();
	for (const dep of deployments) {
		const deploymentGroup = grouped.get(dep.model_name);
		if (deploymentGroup) {
			deploymentGroup.push(dep);
		} else {
			grouped.set(dep.model_name, [dep]);
		}
	}

	let items: ModelInfoV2Item[] = [];
	for (const [, group] of grouped) {
		group.forEach((dep, idx) => {
			items.push(buildModelInfoV2Item(dep, idx, dep.model_info));
		});
	}

	// 过滤：search 命中 model_name / litellm_params.model / model_info.id
	if (search.length > 0) {
		items = items.filter((it) => {
			const modelNameLc = it.model_name.toLowerCase();
			const innerModel = typeof it.litellm_params["model"] === "string" ? (it.litellm_params["model"] as string).toLowerCase() : "";
			const idLc = typeof it.model_info["id"] === "string" ? (it.model_info["id"] as string).toLowerCase() : "";
			return modelNameLc.includes(search) || innerModel.includes(search) || idLc.includes(search);
		});
	}

	// 过滤：modelId 精确匹配 id
	if (modelId.length > 0) {
		items = items.filter((it) => it.model_info["id"] === modelId);
	}

	// 排序
	items = sortItems(items, sortBy, sortOrder);

	const total = items.length;
	// 对齐 Python LiteLLM 的空态：total_pages 保持 0；非空时至少 1
	const totalPages = total === 0 ? EMPTY_TOTAL_PAGES : Math.max(MIN_TOTAL_PAGES, Math.ceil(total / size));
	const start = (page - 1) * size;
	const pageData = items.slice(start, start + size);

	return {
		data: pageData,
		total_count: total,
		total: total,
		current_page: page,
		page: page,
		total_pages: totalPages,
		size: size,
		page_size: size,
	};
}

/**
 * 构造 /model_group/info 响应：从 deployments 按 model_name 聚合
 * @param deployments - Router 全部 deployment
 */
// buildModelGroupInfoResponse 移至 ./modelGroupBuilder.ts
// 注意：SUPPORTS_FLAGS / SupportsFlag 类型仍在本文件 import，因为
// buildModelInfoV2Item 也用同一白名单聚合 supports_* 字段。

/**
 * 提取 deployments 列表：仅从 Router / RouterDeploymentsAccessor 注入获取。
 *
 * main.ts 必须传 container.router：Router deployments 是运行时真实模型源，
 * 包含 config 重构过程中可能丢失的 model_info 字段与默认 deployment 元信息
 * （如 custom_llm_provider、rpm/tpm、timeout 等）。如未注入则返回空数组，
 * 让 WebUI 走空态分支而不是显示陈旧数据。
 * @param routerOrAccessor
 */
function resolveDeployments(routerOrAccessor: Router | RouterDeploymentsAccessor | undefined): Deployment[] {
	if (routerOrAccessor && typeof (routerOrAccessor as RouterDeploymentsAccessor).getDeployments === "function") {
		try {
			return (routerOrAccessor as RouterDeploymentsAccessor).getDeployments();
		} catch {
			return [];
		}
	}
	return [];
}

/**
 * 注册 Models 页面支撑端点
 * @param router - Express Router 实例（需经过鉴权中间件）
 * @param routerOrAccessor - TS Router 或 deployments 访问器；用于构造 /v2/model/info 真实数据
 * @param config - 服务配置；用于 model_cost_map 暴露真实 model_count 等
 */
export function registerModelsPageSupportRoutes(
	router: ExpressRouter,
	routerOrAccessor?: Router | RouterDeploymentsAccessor,
	config?: ServiceConfig,
): void {
	// ── /v2/model/info ──────────────────────────────────────

	/**
	 * 分页获取模型详情列表
	 *
	 * WebUI 通过 useModelsInfo hook 调用，期望 PaginatedModelInfoResponse：
	 * { data: [...], total_count, current_page, total_pages, size }
	 * 同时返回 Python 分页字段别名（total/page/page_size），避免某些消费方 .length 读取 undefined 崩溃。
	 *
	 * 支持 query：
	 *   - page, size: 分页
	 *   - search: 模糊匹配 model_name / litellm_params.model / model_info.id
	 *   - modelId: 精确匹配 model_info.id
	 *   - teamId: 当前 TS 端尚未实现 team 过滤；保留在 query 类型中以兼容前端，但端点不读取。
	 *   - sortBy, sortOrder: 排序（仅支持 model_name / id；sortOrder 非法值回退 asc）
	 */
	registerRoute(router, { method: "get", path: "/v2/model/info" }, (req) => {
		const deployments = resolveDeployments(routerOrAccessor);
		// 无部署时按 Python 空态返回 total_pages = 0
		return buildV2ModelInfoResponse(deployments, parseModelInfoQuery(req.query as Record<string, unknown>));
	});

	// ── /v1/model/info ──────────────────────────────────────

	/** 单个模型详情查询（WebUI 编辑模型时使用） */
	registerRoute(router, { method: "get", path: "/v1/model/info" }, (req): ModelInfoV1Response => {
		const modelIdRaw = req.query.model_id ?? req.query.modelId ?? "";
		const modelId = typeof modelIdRaw === "string" ? modelIdRaw : "";
		const deployments = resolveDeployments(routerOrAccessor);
		if (!modelId) {
			return { data: [] };
		}
		// 优先按 model_name 匹配；再按 litellm_params.model 匹配
		const dep = deployments.find((d) => d.model_name === modelId) ?? deployments.find((d) => d.litellm_params.model === modelId);
		if (!dep) {
			throw new ApiError(HTTP_STATUS.NOT_FOUND, `Model "${modelId}" not found`);
		}
		// 同一 model_name 内按出现顺序分配 stableIndex
		const sameGroup = deployments.filter((d) => d.model_name === dep.model_name);
		const idx = sameGroup.indexOf(dep);
		return { data: [buildModelInfoV2Item(dep, idx, dep.model_info)] };
	});

	// ── /model_group/info ───────────────────────────────────

	/**
	 * 模型组信息
	 *
	 * WebUI modelHubCall 直接消费返回值。Python 真实返回：{ data: [...] }
	 * （注意：WebUI 端 modelHubData?.data?.filter / .find，必须有 data 数组，否则报
	 * "n.find is not a function"）
	 */
	registerRoute(router, { method: "get", path: "/model_group/info" }, () => {
		const deployments = resolveDeployments(routerOrAccessor);
		return buildModelGroupInfoResponse(deployments);
	});

	// ── /config/pass_through_endpoint ───────────────────────
	//
	// 当前为占位实现（STUB）。TS 端尚未实现 pass-through 端点的持久化与转发，
	// 暂以兼容 WebUI 消费契约的最小响应体返回，避免触发前端 `.find` 抛错。
	//
	// 响应 shape 与 Python LiteLLM 对齐：
	//   GET    /config/pass_through_endpoint
	//     → { endpoints: passThroughItem[] }
	//   GET    /config/pass_through_endpoint/team/:teamId
	//     → { endpoints: passThroughItem[] }（按团队过滤；stub 不过滤，返回空）
	//   POST   /config/pass_through_endpoint
	//     → { success: true, endpoint: passThroughItem | undefined }
	//   DELETE /config/pass_through_endpoint/:endpointPath
	//     → { success: true, endpoint_id: string | undefined }
	//
	// 注意：
	//   1. 这些 stub 不实际存储端点配置 — 重启后状态丢失。
	//   2. WebUI 拿到空 endpoints 时会渲染空表格，这是预期行为。
	//   3. 等 pass_through_endpoints 完整实现时，把内存 / DB 接入此处即可。
	//   4. 鉴权要求由主 router 统一保证（需 PROXY_ADMIN 或 team 角色），不需要
	//      在每个 stub 中重复校验。

	/** 获取所有 pass-through 端点配置（stub：始终返回空列表） */
	registerRoute(router, { method: "get", path: "/config/pass_through_endpoint" }, () => ({ endpoints: [] }));

	/** 获取指定团队的 pass-through 端点配置（stub：不实现按团队过滤） */
	registerRoute(router, { method: "get", path: "/config/pass_through_endpoint/team/:teamId" }, () => ({ endpoints: [] }));

	/** 创建 pass-through 端点（stub：不持久化） */
	registerRoute(router, { method: "post", path: "/config/pass_through_endpoint" }, (_req, _res) => ({
		success: true,
		endpoint: undefined,
	}));

	/** 删除 pass-through 端点（stub：不持久化） */
	registerRoute(router, { method: "delete", path: "/config/pass_through_endpoint/:endpointPath" }, (_req, _res) => ({
		success: true,
		endpoint_id: undefined,
	}));

	// ── /config/field/info ──────────────────────────────────

	/** 获取指定配置字段信息 */
	registerRoute(router, { method: "get", path: "/config/field/info" }, () => ({}));

	// ── 配置回调（Models 页面 / 路由设置） ────────────────────

	/**
	 * 获取已配置的回调、告警与可用回调清单
	 *
	 * Python 真实响应见 `litellm/proxy/proxy_server.py:12681-12687`：
	 * `{ status, callbacks, alerts, router_settings, available_callbacks }`。
	 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
	 * WebUI `getCallbacksCall` 直接 `response.json()`，必须返回 JSON 对象。
	 */
	registerRoute(router, { method: "get", path: "/get/config/callbacks" }, () => ({
		status: "success",
		callbacks: [],
		alerts: [],
		router_settings: {},
		available_callbacks: {},
	}));

	// ── 成本映射相关 ─────────────────────────────────────────

	/**
	 * 获取模型成本映射数据源信息
	 *
	 * Python LiteLLM 真实响应见 `litellm/proxy/proxy_server.py:13048-13088`，
	 * 包含 `source`、`url`、`is_env_forced`、`fallback_reason`、`model_count`
	 * （基于 `litellm.model_cost` 长度）。
	 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
	 * WebUI 渲染时会调用 `C.model_count.toLocaleString()`，所以 `model_count` 必须存在。
	 */
	registerRoute(router, { method: "get", path: "/model/cost_map/source" }, () => ({
		source: "local",
		url: null,
		is_env_forced: false,
		fallback_reason: null,
		model_count: config?.modelList?.length ?? 0,
	}));

	/** 获取模型成本映射定时重载状态 */
	registerRoute(router, { method: "get", path: "/schedule/model_cost_map_reload/status" }, () => ({
		scheduled: false,
		next_reload_at: null,
	}));

	/** 调度模型成本映射重载 */
	registerRoute(router, { method: "post", path: "/schedule/model_cost_map_reload" }, () => ({
		success: true,
	}));

	/** 取消模型成本映射重载调度 */
	registerRoute(router, { method: "delete", path: "/schedule/model_cost_map_reload" }, () => ({
		success: true,
	}));

	/** 立即重载模型成本映射 */
	registerRoute(router, { method: "post", path: "/reload/model_cost_map" }, () => ({
		success: true,
	}));
}
