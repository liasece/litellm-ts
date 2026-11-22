/**
 * Fallback Handler
 *
 * Manages fallback chains for model requests.
 * Supports model_group_alias and deployment override_model_name resolution (Patch 14).
 *
 * 一条 fallback 条目现在是一棵树的边：条目 `{ targets, recurse }` 的每个目标既可以直接尝试，
 * 也可以在 `recurse` 允许时进入该目标自己的条目（深度优先，兄弟目标在子树之后继续）。
 * {@link FallbackHandler.getFallbackPlan} 把这棵树展开成请求级的有序候选序列，
 * 执行层只需要按序列推进，不再逐步查「当前模型的下一个 fallback」——那正是旧实现丢掉兄弟目标的原因。
 */

import type { ModelGroupResolution, ModelGroupResolutionHop } from "./ModelResolutionTrace";

import { getModelGroupAliasRecurse, selectModelGroupAliasTargets, validateModelGroupAliases } from "../shared/ModelGroupAlias";
import type { ModelGroupAliases } from "../shared/ModelGroupAlias";
import { normalizeFallbackEntry } from "../shared/FallbackEntry";
import type { FallbackEntriesSource, NormalizedFallbackEntry } from "../shared/FallbackEntry";

/** 展开后的一跳候选：按发起下一步时的切模型顺序排列。 */
export type FallbackPlanEntry = ModelGroupResolution;

/** 树中一条边：目标 + 该目标失败后能否继续它自己的条目。 */
interface FallbackEdge {
	/** 配置里写下的目标名（可能是别名或带 provider 前缀）。 */
	target: string;
	/** 目标失败后是否继续目标自身的 fallback 条目。 */
	recurse: boolean;
	/**
	 * `resolution` 是别名的解析边：它的目标就是本次请求真正要执行的模型组，
	 * 只用于继续向下展开，不能作为「失败后的候选」重复排队。
	 */
	role: "resolution" | "fallback";
}

/**
 * 计划展开上限。真正生效的跳数上限是 router 的 max_fallbacks；
 * 这里只是防御配置成环或极大扇出时一次性展开出无界序列。
 */
const FALLBACK_PLAN_LIMIT = 50;

/**
 * Fallback Handler
 *
 * 管理模型请求的回退链，支持上下文窗口溢出和内容策略违规的专属回退。
 * 对齐 PY: fallbacks 是 List[Dict[str, List[str]]]，合并时 first-match-wins。
 */
export class FallbackHandler {
	private _fallbacks: Record<string, NormalizedFallbackEntry>;
	// DIFF-RT-ALIAS-01: alias 值类型扩展为 string | string[] | { model, hidden? }
	// 之前只支持 string | object，string[] 多值数组报 TS 错。
	private _modelGroupAlias: ModelGroupAliases;
	private _modelOverrides: ModelGroupAliases;
	private _contextWindowFallbacks: Record<string, string[]>;
	private _contentPolicyFallbacks: Record<string, string[]>;
	/** 内部缓存：getFallbackChain 计算结果，避免重复计算 */
	private _chainCache: Map<string, ModelGroupResolution[]> = new Map();
	/** 内部缓存：getFallbackPlan 展开结果（键含上限），随分钟与配置变更失效 */
	private _planCache: Map<string, FallbackPlanEntry[]> = new Map();
	private _chainCacheMinute = -1;

	constructor(
		/** PY 风格：fallbacks 是 List[Dict]，first-match-wins 合并 */
		fallbacks?: FallbackEntriesSource,
		modelGroupAlias?: ModelGroupAliases,
		contextWindowFallbacks?: Record<string, string[]>,
		contentPolicyFallbacks?: Record<string, string[]>,
		modelOverrides?: Record<string, string>,
		/** Keep model selection consistent throughout one request snapshot. */
		private readonly _referenceTime?: Date,
	) {
		this._fallbacks = this._mergeFallbacks(fallbacks);
		const aliases = modelGroupAlias ?? {};
		const overrides = modelOverrides ?? {};
		this._validateModelGroupAlias({ ...aliases, ...overrides });
		this._modelGroupAlias = aliases;
		this._modelOverrides = overrides;
		this._contextWindowFallbacks = contextWindowFallbacks ?? {};
		this._contentPolicyFallbacks = contentPolicyFallbacks ?? {};
	}

	/**
	 * 合并 fallbacks。PY 行为：List[Dict] 顺序遍历，first-match-wins。
	 * 也兼容直接传入 Record。条目值在这里统一成 `{ targets, recurse }`；
	 * 非法值只跳过该条目，避免一份脏配置让整次路由装配失败。
	 * @param fallbacks
	 */
	private _mergeFallbacks(fallbacks?: FallbackEntriesSource): Record<string, NormalizedFallbackEntry> {
		if (!fallbacks) {
			return {};
		}
		const merged: Record<string, NormalizedFallbackEntry> = {};
		const groups: Array<Record<string, unknown>> = Array.isArray(fallbacks) ? fallbacks : [fallbacks];
		for (const group of groups) {
			for (const [key, value] of Object.entries(group ?? {})) {
				if (key in merged) {
					continue;
				}
				const entry = normalizeFallbackEntry(value);
				if (entry.targets.length === 0) {
					continue;
				}
				merged[key] = entry;
			}
		}
		return merged;
	}

	/**
	 * 已知 provider 前缀列表，对齐 PY litellm.provider_list
	 * （fallback_event_handlers._check_stripped_model_group 遍历枚举）
	 * GAP: PY 实际是动态 Enum，包含 100+ provider；TS 静态列表虽不全，但已涵盖主流
	 * 现补充：xai, anthropic_beta, text-completion-openai, jina_ai, friendliai, galadriel,
	 *        github, gitlab, lemonade, lm_studio, moonshot, nebius, novita, oci, oxylabs,
	 *        recraft, snowflake, tavily, topaz, triton, volcengine, wandb_integration, etc.
	 */
	private static readonly _knownProviders: readonly string[] = [
		"openai",
		"text-completion-openai",
		"anthropic",
		"anthropic_beta",
		"azure",
		"azure_ai",
		"bedrock",
		"cohere",
		"cohere_chat",
		"vertex_ai-language-models",
		"vertex_ai-anthropic_models",
		"vertex_ai-chat-models",
		"vertex_ai-code-chat-models",
		"vertex_ai-code-text-models",
		"vertex_ai-embedding-models",
		"vertex_ai-image-models",
		"vertex_ai-text-models",
		"vertex_ai-text-embedding-models",
		"vertex_ai-vision-models",
		"gemini",
		"gemini_cli",
		"huggingface",
		"together_ai",
		"openrouter",
		"replicate",
		"ai21",
		"aleph_alpha",
		"anyscale",
		"baseten",
		"custom",
		"custom_openai",
		"deepinfra",
		"deepseek",
		"fireworks_ai",
		"friendliai",
		"galadriel",
		"glm",
		"mimo",
		"mistral",
		"groq",
		"xai",
		"github",
		"gitlab",
		"jina_ai",
		"lemonade",
		"lm_studio",
		"moonshot",
		"nebius",
		"novita",
		"nlp_cloud",
		"oci",
		"ollama",
		"openllm",
		"oxylabs",
		"perplexity",
		"petals",
		"predibase",
		"recraft",
		"sagemaker",
		"snowflake",
		"tavily",
		"topaz",
		"triton",
		"vllm",
		"volcengine",
		"voyage",
		"wandb_integration",
		"watsonx",
	];

	/**
	 * 剥离 provider 前缀（对齐 PY _check_stripped_model_group 行为）：
	 * 仅当斜杠前是已知 provider 前缀时才剥离。避免误把用户模型名
	 * 中包含 "/" 的情况当成 provider 前缀。
	 * GAP: PY `model_group.startswith(f"{_provider}/")` 是大小写敏感比较（fallback_event_handlers.py:38-39）
	 * TS 之前用 lowercase 比较，现改为 case-sensitive
	 * @param model
	 */
	private _stripProviderPrefix(model: string): string {
		const slashIdx = model.indexOf("/");
		if (slashIdx > 0 && slashIdx < model.length - 1) {
			const prefix = model.slice(0, slashIdx);
			// GAP: case-sensitive 比较 (PY 行为)
			if (FallbackHandler._knownProviders.includes(prefix)) {
				return model.slice(slashIdx + 1);
			}
		}
		return model;
	}

	/**
	 * 在给定 map 中按同样优先级查找（CW/CP 通道使用纯目标数组）：
	 * 1. Exact model name match
	 * 2. Provider-prefix stripped match
	 * 3. alias 解析后的名字匹配
	 * 4. Wildcard '*' match
	 *
	 * Model Override（override_model_name）是「强制的直接 fallback」：请求在选 deployment 前
	 * 就已经落在目标模型组上，所以链按目标模型组查；源模型组自己的 fallbacks 配置不会遮住目标链。
	 * @param model
	 * @param fallbackMap
	 * @param at
	 */
	private _lookupFallback(model: string, fallbackMap: Record<string, string[]>, at = this._referenceTime ?? new Date()): string[] {
		const lookupModel = this._forcedModelGroup(model, at);
		const direct = this._lookupByKeys(lookupModel, fallbackMap, false, at);
		return direct ?? [];
	}

	/**
	 * 同一套查找优先级，但返回普通 fallback 的条目（含递归开关）。
	 *
	 * `skipAliasResolution` 用于别名自身：别名声明的目标列表已经由 `_fallbackEdges` 展开成
	 * 树边走过了，这里再按「解析后的名字」查一次会把同一段链重复计入，也会绕开 `recurse` 开关。
	 * @param model
	 * @param at
	 * @param skipAliasResolution
	 */
	private _lookupFallbackEntry(model: string, at: Date, skipAliasResolution: boolean): NormalizedFallbackEntry | undefined {
		const lookupModel = this._forcedModelGroup(model, at);
		return this._lookupByKeys(lookupModel, this._fallbacks, skipAliasResolution, at);
	}

	/**
	 * 精确名 → 去 provider 前缀 → 解析别名后 → 通配符，返回首个命中的条目。
	 * @param lookupModel
	 * @param map
	 * @param skipAliasResolution
	 * @param at
	 */
	private _lookupByKeys<T>(lookupModel: string, map: Record<string, T>, skipAliasResolution: boolean, at: Date): T | undefined {
		// Exact match
		const exact = map[lookupModel];
		if (exact) {
			return exact;
		}
		// Provider-prefix stripped match
		const stripped = this._stripProviderPrefix(lookupModel);
		if (stripped !== lookupModel) {
			const strippedMatch = map[stripped];
			if (strippedMatch) {
				return strippedMatch;
			}
		}
		// Resolve alias and try again
		if (!skipAliasResolution) {
			const resolvedAlias = this._resolveAlias(lookupModel, this._redirects(), at);
			if (resolvedAlias !== lookupModel) {
				// Exact match on resolved alias
				const aliasMatch = map[resolvedAlias];
				if (aliasMatch) {
					return aliasMatch;
				}
				// Provider-prefix stripped match on resolved alias (对齐 PY get_fallback_model_group)
				const strippedAlias = this._stripProviderPrefix(resolvedAlias);
				if (strippedAlias !== resolvedAlias) {
					const strippedAliasMatch = map[strippedAlias];
					if (strippedAliasMatch) {
						return strippedAliasMatch;
					}
				}
			}
		}
		// Wildcard match
		return map["*"];
	}

	/**
	 * Get context window fallback chain for a model
	 * @param model - original model name
	 * @returns ordered context window fallback chain
	 */
	getContextWindowFallbackChain(model: string): string[] {
		return this._lookupFallback(model, this._contextWindowFallbacks);
	}

	/**
	 * Get content policy fallback chain for a model
	 * @param model - original model name
	 * @returns ordered content policy fallback chain
	 */
	getContentPolicyFallbackChain(model: string): string[] {
		return this._lookupFallback(model, this._contentPolicyFallbacks);
	}

	/**
	 * 合并 model_group_alias 与 deployment 强制重定向（override_model_name）后的解析表。
	 * 同名时 override 优先，与 resolveModelGroup 的路由解析保持同一优先级。
	 */
	private _redirects(): ModelGroupAliases {
		return { ...this._modelGroupAlias, ...this._modelOverrides };
	}

	/**
	 * 请求实际执行的模型组。Model Override 视为「强制的直接 fallback」：请求在选 deployment 前
	 * 就跳到目标，因此后续 fallback 链按目标查。纯 alias 不跨 override 边，仍保持源名字优先。
	 * @param model - 请求里的模型组
	 * @param at - 请求快照固定的时间
	 */
	private _forcedModelGroup(model: string, at: Date): string {
		const redirects = this._redirects();
		const seen = new Set<string>([model]);
		let current = model;
		let crossedOverride = false;
		for (;;) {
			const next = this._getAliasTarget(current, redirects, at);
			if (next === undefined || seen.has(next)) {
				break;
			}
			if (Object.prototype.hasOwnProperty.call(this._modelOverrides, current)) {
				crossedOverride = true;
			}
			seen.add(next);
			current = next;
		}
		return crossedOverride ? current : model;
	}

	/**
	 * 读取 alias 的单跳主目标。目标列表靠后的候选不参与解析，只作为失败后的同级候选。
	 * @param model - 当前模型组
	 * @param aliases - 待查询的 alias 映射
	 * @param at
	 */
	private _getAliasTarget(model: string, aliases: ModelGroupAliases, at: Date): string | undefined {
		return this._selectAliasTarget(model, aliases, at)?.target;
	}

	/**
	 * 解析一条 alias 边，并指出目标是默认目标还是每日时段选中的目标。
	 *
	 * 时段 alias（峰谷价路由）与静态改名在日志里是两种能力，这里保留判定结果，
	 * 避免展示层重新实现一遍时段规则。
	 * @param model - 当前模型组
	 * @param aliases - 待查询的 alias 映射
	 * @param at - 请求快照固定的时间
	 */
	private _selectAliasTarget(
		model: string,
		aliases: ModelGroupAliases,
		at: Date,
	): { target: string; scheduled: boolean; targets: string[] } | undefined {
		return Object.prototype.hasOwnProperty.call(aliases, model) ? selectModelGroupAliasTargets(aliases[model], at) : undefined;
	}

	/**
	 * 判定一条已解析的 alias 边来自哪个能力：模型级 override 优先，其次是普通 alias，
	 * 时段命中的 alias 单独标记。
	 * @param from - 边起点
	 * @param selection - 该边的解析结果
	 */
	private _hopKind(from: string, selection: { scheduled: boolean }): ModelGroupResolutionHop["kind"] {
		if (Object.prototype.hasOwnProperty.call(this._modelOverrides, from)) {
			return "override";
		}
		return selection.scheduled ? "alias:scheduled" : "alias";
	}

	private _resolveAliasWithTrace(
		model: string,
		aliases: ModelGroupAliases = this._redirects(),
		at = this._referenceTime ?? new Date(),
	): ModelGroupResolution {
		const path = [model];
		const hops: ModelGroupResolutionHop[] = [];
		const seen = new Set(path);
		let current = model;

		while (true) {
			const selection = this._selectAliasTarget(current, aliases, at);
			if (selection === undefined) {
				return {
					inputModel: model,
					resolvedModel: current,
					resolutionPath: path,
					...(hops.length > 0 ? { hops: hops } : {}),
				};
			}
			if (seen.has(selection.target)) {
				throw new Error(`Model group alias cycle detected: ${[...path, selection.target].join(" -> ")}`);
			}
			hops.push({ from: current, to: selection.target, kind: this._hopKind(current, selection) });
			path.push(selection.target);
			seen.add(selection.target);
			current = selection.target;
		}
	}

	private _resolveAlias(
		model: string,
		aliases: ModelGroupAliases = this._modelGroupAlias,
		at = this._referenceTime ?? new Date(),
	): string {
		return this._resolveAliasWithTrace(model, aliases, at).resolvedModel;
	}

	private _validateModelGroupAlias(aliases: ModelGroupAliases): void {
		validateModelGroupAliases(aliases);
	}

	/**
	 * 一个节点失败后可以直接尝试的目标（树中的第一层边）。
	 *
	 * 顺序：先别名自身声明的有序目标（含主目标，主目标通常已作为本次尝试而由调用方去重），
	 * 再是显式 fallbacks 条目。别名节点不再额外按「解析后的名字」查一次 fallbacks，
	 * 那段链属于目标的子树，由计划展开时的深度优先遍历负责。
	 * @param model - 当前节点
	 * @param at - 请求快照固定的时间
	 */
	/**
	 * 该名字是否是配置里的别名（模型级 override 不算别名：它是强制换组，不声明目标列表）。
	 * @param model
	 */
	private _isAliasNode(model: string): boolean {
		return Object.prototype.hasOwnProperty.call(this._modelGroupAlias, model);
	}

	/**
	 * 一个节点失败后可以直接尝试的目标（树中的第一层边）。
	 *
	 * 顺序：先别名自身声明的有序目标（含主目标，主目标通常已作为本次尝试而由调用方去重），
	 * 再是显式 fallbacks 条目。别名节点不再额外按「解析后的名字」查一次 fallbacks，
	 * 那段链属于目标的子树，由计划展开时的深度优先遍历负责。
	 * @param model - 当前节点
	 * @param at - 请求快照固定的时间
	 */
	private _fallbackEdges(model: string, at: Date): FallbackEdge[] {
		const edges: FallbackEdge[] = [];
		const lookupModel = this._forcedModelGroup(model, at);
		const aliasNode = this._modelGroupAliasTargetNode(model, lookupModel);
		// 显式 fallbacks 条目排在别名自身的目标之前：历史语义是「精确配置的名字优先于
		// 别名解析后的名字」，两者同时配置时不因为引入递归而改变谁先被尝试。
		const entry = this._lookupFallbackEntry(model, at, aliasNode !== undefined);
		if (entry) {
			for (const target of entry.targets) {
				edges.push({ target: target, recurse: entry.recurse, role: "fallback" });
			}
		}
		if (aliasNode !== undefined) {
			const value = this._modelGroupAlias[aliasNode];
			const selection = selectModelGroupAliasTargets(value, at);
			const recurse = getModelGroupAliasRecurse(value);
			const targets = selection?.targets ?? [];
			for (let index = 0; index < targets.length; index++) {
				edges.push({ target: targets[index]!, recurse: recurse, role: index === 0 ? "resolution" : "fallback" });
			}
		}
		return edges;
	}

	/**
	 * 该名字在 alias 表里命中的节点（优先取强制换组后的名字），没有则 undefined。
	 * 模型级 override 不是别名，不参与目标列表展开。
	 * @param model - 请求里的模型组
	 * @param lookupModel - 应用模型级 override 后的模型组
	 */
	private _modelGroupAliasTargetNode(model: string, lookupModel: string): string | undefined {
		if (Object.prototype.hasOwnProperty.call(this._modelGroupAlias, lookupModel)) {
			return lookupModel;
		}
		return Object.prototype.hasOwnProperty.call(this._modelGroupAlias, model) ? model : undefined;
	}

	/**
	 * 按分钟刷新链缓存，保证时段 alias 在下一分钟按新目标展开。
	 * @param at
	 */
	private _refreshCacheMinute(at: Date): void {
		const minute = Math.floor(at.getTime() / 60_000);
		if (minute !== this._chainCacheMinute) {
			this.invalidateCache();
			this._chainCacheMinute = minute;
		}
	}

	/**
	 * Get the fallback chain for a model, resolving aliases first.
	 * 只展开第一层：用于展示、错误信息与「是否还有 fallback」判断。
	 * 执行路径用 {@link FallbackHandler.getFallbackPlan} 取整棵树的顺序。
	 * 支持通配符 * 匹配和 provider 前缀剥离匹配（对齐 PY fallback_event_handlers.py）。
	 * 结果带缓存，避免 hasMoreFallbacks/getNextFallback 重复计算
	 * @param model - original model name
	 * @returns ordered fallback chain (excluding the original model)
	 */
	getFallbackChainWithTrace(model: string): ModelGroupResolution[] {
		const at = this._referenceTime ?? new Date();
		this._refreshCacheMinute(at);
		const cached = this._chainCache.get(model);
		if (cached) {
			return cached.map((entry) => ({ ...entry, resolutionPath: [...entry.resolutionPath] }));
		}
		// 链就是计划本身：一段配置里靠后的兄弟目标和各目标自身的链都属于「可以换的候选」，
		// 展示与错误信息用同一份顺序，避免执行顺序和文案说两套话。
		const chain: ModelGroupResolution[] = this.getFallbackPlan(model, FALLBACK_PLAN_LIMIT).map((entry) => ({
			inputModel: entry.inputModel,
			resolvedModel: entry.resolvedModel,
			resolutionPath: [...entry.resolutionPath],
			...(entry.hops === undefined ? {} : { hops: entry.hops.map((hop) => ({ ...hop })) }),
		}));
		this._chainCache.set(model, chain);
		return chain.map((entry) => ({ ...entry, resolutionPath: [...entry.resolutionPath] }));
	}

	/**
	 * 把「请求模型失败后可以换谁」展开成一条有序候选序列。
	 *
	 * 深度优先：每个目标先作为候选，`recurse` 允许时接着展开该目标自己的条目，
	 * 子树走完再回到下一个兄弟目标。`recurse: false` 的条目只贡献同级候选，
	 * 目标（含别名解析到的模型组）当作叶子，因此不会有配置者没有预期的模型被带进来。
	 *
	 * 序列不包含请求模型自身；调用方从下标 0 开始推进。解析完成的模型组不会重复出现，
	 * 因此同一组被多条路径引用时只尝试一次。
	 * @param model - 请求的模型组
	 * @param limit - 展开上限（真正的跳数上限由 router 的 max_fallbacks 控制）
	 */
	getFallbackPlan(model: string, limit = FALLBACK_PLAN_LIMIT): FallbackPlanEntry[] {
		const at = this._referenceTime ?? new Date();
		this._refreshCacheMinute(at);
		const cacheKey = `${limit}|${model}`;
		const cached = this._planCache.get(cacheKey);
		if (cached) {
			return cached.map((entry) => ({ ...entry, resolutionPath: [...entry.resolutionPath] }));
		}
		const capped = Math.max(0, limit);
		const plan: FallbackPlanEntry[] = [];
		const seenGroups = new Set<string>([this._forcedModelGroup(model, at)]);
		const visitedNodes = new Set<string>();
		const walk = (node: string, allowDescend: boolean): void => {
			if (!allowDescend || plan.length >= capped || visitedNodes.has(node)) {
				return;
			}
			visitedNodes.add(node);
			for (const edge of this._fallbackEdges(node, at)) {
				if (plan.length >= capped) {
					return;
				}
				// 别名的解析边指向的就是本次尝试的模型组：只继续向下展开它的链，不作为候选排队。
				if (edge.role !== "resolution") {
					const resolution = this._resolveAliasWithTrace(edge.target, this._redirects(), at);
					if (!seenGroups.has(resolution.resolvedModel)) {
						seenGroups.add(resolution.resolvedModel);
						plan.push(resolution);
					}
				}
				walk(edge.target, edge.recurse);
			}
		};
		walk(model, true);
		this._planCache.set(cacheKey, plan);
		return plan.map((entry) => ({ ...entry, resolutionPath: [...entry.resolutionPath] }));
	}

	/**
	 * @param model
	 */
	getFallbackChain(model: string): string[] {
		return this.getFallbackChainWithTrace(model).map((entry) => entry.resolvedModel);
	}

	/**
	 * DIFF-RT-02: 把 alias 解析为底层 model group，对齐 PY
	 * `router.py:5905-5918 self._get_model_from_alias`。
	 * 如果 `model` 已经是底层 group（无 alias），原样返回。
	 * @param model
	 */
	resolveModelGroupWithTrace(model: string): ModelGroupResolution {
		return this._resolveAliasWithTrace(model);
	}

	/**
	 * @param model
	 */
	resolveModelGroup(model: string): string {
		return this.resolveModelGroupWithTrace(model).resolvedModel;
	}

	/**
	 * Invalidate the chain cache (e.g., when fallbacks are mutated at runtime)
	 */
	invalidateCache(): void {
		this._chainCache.clear();
		this._planCache.clear();
	}

	/**
	 * 运行时替换 fallback 映射（对齐 PY Router.update_settings 的 fallbacks 热更新）。
	 * 接受 PY 风格 List[Dict]（first-match-wins 合并）或 Record；替换后失效链缓存。
	 * @param fallbacks - 新的 fallback 配置
	 */
	setFallbacks(fallbacks?: FallbackEntriesSource): void {
		this._fallbacks = this._mergeFallbacks(fallbacks);
		this.invalidateCache();
	}

	/**
	 * 读取当前 fallback 配置（合并后的 Record 视图，等价 PY Router.fallbacks 运行时值）。
	 * 供管理端点按 model_group 反查展示（PY get_all_fallbacks 的数据源）。
	 * 返回深拷贝，避免外部改写内部状态。
	 */
	getFallbacks(): Record<string, string[]> {
		return Object.fromEntries(Object.entries(this._fallbacks).map(([key, entry]) => [key, [...entry.targets]]));
	}

	/** 返回当前 alias key，隐藏 alias target，避免管理端泄漏底层 provider 模型。 */
	getModelGroupAliasKeys(): string[] {
		return Object.keys(this._modelGroupAlias);
	}

	/**
	 * 运行时替换 context window fallback 映射（PY update_settings 白名单项）。
	 * @param fallbacks - 新的 context window fallback 配置
	 */
	setContextWindowFallbacks(fallbacks?: Record<string, string[]>): void {
		this._contextWindowFallbacks = fallbacks ?? {};
		this.invalidateCache();
	}

	/**
	 * 运行时替换 model_group_alias（PY update_settings 白名单项）。
	 * @param modelGroupAlias - 新的别名映射
	 */
	setModelGroupAlias(modelGroupAlias?: ModelGroupAliases): void {
		const aliases = modelGroupAlias ?? {};
		this._validateModelGroupAlias({ ...aliases, ...this._modelOverrides });
		this._modelGroupAlias = aliases;
		this.invalidateCache();
	}

	/**
	 * Replace deployment-level forced redirects while preserving configured aliases.
	 * Forced redirects take precedence when the same source name is configured in both.
	 * @param modelOverrides
	 */
	setModelOverrides(modelOverrides?: Record<string, string>): void {
		const overrides = modelOverrides ?? {};
		this._validateModelGroupAlias({ ...this._modelGroupAlias, ...overrides });
		this._modelOverrides = overrides;
		this.invalidateCache();
	}

	/**
	 * Check if there are more fallbacks available at the given depth
	 * @param model - original model name
	 * @param currentDepth - current position in the fallback chain
	 * @returns true if more fallbacks exist
	 */
	hasMoreFallbacks(model: string, currentDepth: number): boolean {
		const chain = this.getFallbackChain(model);
		return currentDepth < chain.length;
	}

	/**
	 * Get the next fallback model in the chain
	 * @param model - original model name
	 * @param currentDepth - current position in the fallback chain
	 * @returns the next fallback model or null if none available
	 */
	getNextFallbackWithTrace(model: string, currentDepth: number): ModelGroupResolution | null {
		return this.getFallbackChainWithTrace(model)[currentDepth] ?? null;
	}

	/**
	 * @param model
	 * @param currentDepth
	 */
	getNextFallback(model: string, currentDepth: number): string | null {
		return this.getNextFallbackWithTrace(model, currentDepth)?.resolvedModel ?? null;
	}
}
