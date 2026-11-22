/**
 * 模型名 / 别名的引用面：审计与改名级联。
 *
 * 模型组名和别名不只出现在部署行上：fallback 链的键与目标、alias 的目标列表、
 * 模型行的 override_model_name 与 model_info.fallbacks、团队与虚拟密钥的模型白名单、
 * 内置能力的执行模型、websearch 覆盖目标都可能持有它。改名只改一处，其余引用就悬空
 * ——生产 2026-11-18 把 `commandcode/deepseek/deepseek-v4.1-flash` 重建为
 * `commandcode/deepseek-v4.1-flash` 时引用方没有跟着改：旧名请求先是静默弹到
 * opencode-go，fallback 配置修复后变成 400，还有一把虚拟密钥白名单锁着旧名。
 *
 * 本模块把「谁在引用哪个名字」集中成一份清单，供三处共用：
 *   - 改名自动级联：/model/update 改 model_name 后重写所有引用面；
 *   - 手工善后：POST /model/rename（行已被别处改名时只重写引用）；
 *   - 悬空审计：GET /model/references/audit 与 /model/delete 的删除守卫。
 */
import type { DrizzleDb } from "../core/db/Database";
import { configRepositoryFor } from "../repositories/ConfigRepository";
import { keyRepositoryFor } from "../repositories/KeyRepository";
import { modelRepositoryFor } from "../repositories/ModelRepository";
import { objectPermissionRepositoryFor } from "../repositories/ObjectPermissionRepository";
import { teamRepositoryFor } from "../repositories/TeamRepository";
import { BUILTIN_CAPABILITIES_CONFIG_PARAM } from "../capabilities/BuiltinCapabilitiesConfig";

/**
 * Python LiteLLM 的哨兵值：出现在密钥 models 白名单时表示「继承团队全部模型」，
 * 不是模型名，审计时跳过（AuthChecks 同一判定）。
 */
export const MODEL_NAME_SENTINELS: ReadonlySet<string> = new Set(["all-team-models"]);

/** 一个名字引用点；path 定位到行/条目，供审计报告与删除守卫复述。 */
export interface ModelNameReference {
	/** 引用面（如 router_settings.fallbacks / TeamTable.models）。 */
	readonly surface: string;
	/** 引用位置标识（模型组或别名键、密钥/团队 id、路径等）。 */
	readonly path: string;
	/** 被引用的名字。 */
	readonly name: string;
}

/** 引用面全量快照；load 经拥有表的 repository 读取，审计前强制失效缓存保证看到当下事实。 */
export interface ModelReferenceState {
	/** 部署行上的模型组名（多部署组会出现多次）。 */
	readonly groups: readonly string[];
	/** 部署行（override / fallbacks 引用挂在 model_info 上）。 */
	readonly rows: ReadonlyArray<{ readonly modelId: string; readonly modelName: string; readonly modelInfo: Record<string, unknown> }>;
	/** router_settings（fallbacks 三段 + model_group_alias）。 */
	readonly routerSettings: Record<string, unknown>;
	/** general_settings（websearch_override_target_model）。 */
	readonly generalSettings: Record<string, unknown>;
	/** builtin_capabilities（executors[].model）。 */
	readonly capabilities: Record<string, unknown>;
	/** 团队模型白名单。 */
	readonly teams: ReadonlyArray<{ readonly teamId: string; readonly models: readonly string[] }>;
	/** 虚拟密钥模型白名单。 */
	readonly tokens: ReadonlyArray<{ readonly tokenId: string; readonly models: readonly string[] }>;
	/** 对象权限模型白名单。 */
	readonly permissions: ReadonlyArray<{ readonly permissionId: string; readonly models: readonly string[] }>;
}

/** 审计结果：dangling 是真正悬空的引用（哨兵不计入）。 */
export interface ModelReferenceAudit {
	/** 现行名字全集（组名 ∪ 别名键）。 */
	readonly liveNames: readonly string[];
	/** 现行别名键（区分「别名改名」与「组名引用重写」两种级联语义）。 */
	readonly aliasKeys: readonly string[];
	/** 全部引用点。 */
	readonly references: readonly ModelNameReference[];
	/** 悬空引用。 */
	readonly dangling: readonly ModelNameReference[];
}

/** 改名计划落盘所需的最小变更集；只包含实际被改写的部分。 */
export interface ModelReferenceChanges {
	/** router_settings 被改写时的完整新值（fallbacks 三段 + model_group_alias）。 */
	readonly routerSettings?: Record<string, unknown>;
	/** general_settings 被改写时的完整新值（websearch_override_target_model）。 */
	readonly generalSettings?: Record<string, unknown>;
	/** builtin_capabilities 被改写时的完整新值（executors[].model）。 */
	readonly capabilities?: Record<string, unknown>;
	/** model_info 被改写的部署行（override_model_name / fallbacks）。 */
	readonly rows: ReadonlyArray<{ readonly modelId: string; readonly modelInfo: Record<string, unknown> }>;
	/** models 白名单被改写的团队。 */
	readonly teams: ReadonlyArray<{ readonly teamId: string; readonly models: readonly string[] }>;
	/** models 白名单被改写的虚拟密钥。 */
	readonly tokens: ReadonlyArray<{ readonly tokenId: string; readonly models: readonly string[] }>;
	/** models 白名单被改写的对象权限。 */
	readonly permissions: ReadonlyArray<{ readonly permissionId: string; readonly models: readonly string[] }>;
	/** 每个引用面实际重写的名字个数。 */
	readonly counts: ReadonlyArray<{ readonly surface: string; readonly rewritten: number }>;
}

/**
 * 把任意值读成普通对象；数组、字符串、null 都归为空对象，供防御式字段读取。
 * @param value - 任意配置值
 */
function asRecord(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * PY fallback 条目值的目标列表（数组形态或 {targets, recurse} 形态）。
 * @param value - 条目值
 */
function fallbackTargets(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.filter((target): target is string => typeof target === "string");
	}
	const record = asRecord(value);
	return Array.isArray(record["targets"]) ? record["targets"].filter((target): target is string => typeof target === "string") : [];
}

/**
 * alias 值的目标列表（字符串、数组或 {targets, recurse} 形态）。
 * @param value - alias 值
 */
function aliasTargets(value: unknown): string[] {
	if (typeof value === "string") {
		return [value];
	}
	return fallbackTargets(value);
}

/**
 * 单条 fallback 条目的键与目标都参与改名；保留原有形态（数组/对象）。
 * @param entry - 单条 fallback（键 → 目标）
 * @param from - 旧名
 * @param to - 新名
 */
function rewriteFallbackEntry(
	entry: Record<string, unknown>,
	from: string,
	to: string,
): { entry: Record<string, unknown>; changed: number } {
	const next: Record<string, unknown> = {};
	let changed = 0;
	for (const [key, value] of Object.entries(entry)) {
		const nextKey = key === from ? to : key;
		if (nextKey !== key) {
			changed++;
		}
		if (Array.isArray(value)) {
			const targets = value.map((target) => (target === from ? to : target));
			changed += targets.filter((target, index) => target !== value[index]).length;
			next[nextKey] = targets;
		} else {
			const record = asRecord(value);
			const targets = Array.isArray(record["targets"]) ? record["targets"] : undefined;
			if (targets !== undefined) {
				const nextTargets = targets.map((target) => (target === from ? to : target));
				changed += nextTargets.filter((target, index) => target !== targets[index]).length;
				next[nextKey] = { ...record, targets: nextTargets };
			} else {
				next[nextKey] = value;
			}
		}
	}
	return { entry: next, changed: changed };
}

/**
 * 重写一整段 fallback 配置；非数组原样返回。
 * @param entries - fallback 条目数组
 * @param from - 旧名
 * @param to - 新名
 */
function rewriteFallbackEntries(entries: unknown, from: string, to: string): { entries: unknown; changed: number } {
	if (!Array.isArray(entries)) {
		return { entries: entries, changed: 0 };
	}
	let changed = 0;
	const next = entries.map((entry) => {
		const rewritten = rewriteFallbackEntry(asRecord(entry), from, to);
		changed += rewritten.changed;
		return rewritten.entry;
	});
	return { entries: next, changed: changed };
}

/**
 * alias 目标重写；renameKey 为真时连别名键一起改名（POST /model/rename 的别名场景）。
 * @param aliases - model_group_alias 映射
 * @param from - 旧名
 * @param to - 新名
 * @param renameKey - 是否连同键一起改名
 */
function rewriteAliasMap(
	aliases: Record<string, unknown>,
	from: string,
	to: string,
	renameKey: boolean,
): { aliases: Record<string, unknown>; changed: number } {
	const next: Record<string, unknown> = {};
	let changed = 0;
	for (const [key, value] of Object.entries(aliases)) {
		const targets = aliasTargets(value);
		const nextTargets = targets.map((target) => (target === from ? to : target));
		changed += nextTargets.filter((target, index) => target !== targets[index]).length;
		const entry =
			typeof value === "string"
				? (nextTargets[0] ?? value)
				: Array.isArray(value)
					? nextTargets
					: { ...asRecord(value), targets: nextTargets };
		if (renameKey && key === from) {
			changed++;
			next[to] = entry;
		} else {
			next[key] = entry;
		}
	}
	return { aliases: next, changed: changed };
}

/**
 * 重写名字数组；返回改写个数。
 * @param names - 原数组
 * @param from - 旧名
 * @param to - 新名
 */
function rewriteNameArray(names: readonly string[], from: string, to: string): { names: string[]; changed: number } {
	const next = names.map((name) => (name === from ? to : name));
	return { names: next, changed: next.filter((name, index) => name !== names[index]).length };
}

/**
 * 列出全部引用点。alias 键属于「活名字」本身不列引用；alias 目标、fallback 键与目标、
 * 模型行的 override/fallbacks、团队/密钥/对象权限白名单、websearch 覆盖与能力执行模型
 * 都是引用。
 * @param state - 引用面快照
 */
export function collectModelReferences(state: ModelReferenceState): ModelNameReference[] {
	const references: ModelNameReference[] = [];
	const router = asRecord(state.routerSettings);
	const aliases = asRecord(router["model_group_alias"]);
	const fallbackSections = new Map([
		["router_settings.fallbacks", router["fallbacks"]],
		["router_settings.context_window_fallbacks", router["context_window_fallbacks"]],
		["router_settings.content_policy_fallbacks", router["content_policy_fallbacks"]],
	] as const);
	for (const [surface, entries] of fallbackSections) {
		if (!Array.isArray(entries)) {
			continue;
		}
		for (const entry of entries) {
			for (const [key, value] of Object.entries(asRecord(entry))) {
				references.push({ surface: surface, path: key, name: key });
				for (const target of fallbackTargets(value)) {
					references.push({ surface: surface, path: key, name: target });
				}
			}
		}
	}
	for (const [alias, value] of Object.entries(aliases)) {
		for (const target of aliasTargets(value)) {
			references.push({ surface: "model_group_alias", path: alias, name: target });
		}
	}
	for (const row of state.rows) {
		const info = asRecord(row.modelInfo);
		const override = info["override_model_name"];
		if (typeof override === "string" && override.length > 0) {
			references.push({ surface: "model_info.override_model_name", path: row.modelName, name: override });
		}
		for (const target of Array.isArray(info["fallbacks"]) ? info["fallbacks"] : []) {
			if (typeof target === "string") {
				references.push({ surface: "model_info.fallbacks", path: row.modelName, name: target });
			}
		}
	}
	for (const team of state.teams) {
		for (const name of team.models) {
			references.push({ surface: "TeamTable.models", path: team.teamId, name: name });
		}
	}
	for (const token of state.tokens) {
		for (const name of token.models) {
			references.push({ surface: "VerificationToken.models", path: token.tokenId, name: name });
		}
	}
	for (const permission of state.permissions) {
		for (const name of permission.models) {
			references.push({ surface: "ObjectPermissionTable.models", path: permission.permissionId, name: name });
		}
	}
	const websearch = asRecord(state.generalSettings)["websearch_override_target_model"];
	if (typeof websearch === "string" && websearch.length > 0) {
		references.push({ surface: "general_settings", path: "websearch_override_target_model", name: websearch });
	}
	for (const [capability, config] of Object.entries(state.capabilities)) {
		const executors = asRecord(config)["executors"];
		if (!Array.isArray(executors)) {
			continue;
		}
		for (const [index, executor] of executors.entries()) {
			const model = asRecord(executor)["model"];
			if (typeof model === "string" && model.length > 0) {
				references.push({ surface: "builtin_capabilities", path: `${capability}.executors[${index}].model`, name: model });
			}
		}
	}
	return references;
}

/**
 * 审计：名字集合 = 部署组名 ∪ alias 键；引用不落在集合内（且不是哨兵）即悬空。
 * alias 目标链成环也判悬空——环上的名字永远解析不到部署。
 * @param state - 引用面快照
 */
export function auditModelReferences(state: ModelReferenceState): ModelReferenceAudit {
	const aliases = asRecord(asRecord(state.routerSettings)["model_group_alias"]);
	const aliasKeys = Object.keys(aliases);
	const liveNames = [...new Set([...state.groups, ...aliasKeys])];
	const live = new Set(liveNames);
	const references = collectModelReferences(state);
	const cyclic = new Set<string>();
	for (const alias of aliasKeys) {
		const seen = new Set<string>([alias]);
		let current = alias;
		for (;;) {
			const next = aliasTargets(aliases[current])[0];
			if (next === undefined || seen.has(next)) {
				if (next !== undefined && !state.groups.includes(next)) {
					cyclic.add(alias);
				}
				break;
			}
			seen.add(next);
			current = next;
			if (state.groups.includes(current)) {
				break;
			}
		}
	}
	const dangling = references.filter(
		(reference) => !live.has(reference.name) && !MODEL_NAME_SENTINELS.has(reference.name) && !cyclic.has(reference.name),
	);
	for (const alias of cyclic) {
		dangling.push({ surface: "model_group_alias_cycle", path: alias, name: alias });
	}
	return { liveNames: liveNames, aliasKeys: aliasKeys, references: references, dangling: dangling };
}

/**
 * 生成改名计划：把所有引用面里等于 `from` 的名字改写为 `to`。
 *
 * `renameAliasKey` 为真时（POST /model/rename 的别名改名场景）连同别名键一起改；
 * 部署行的 model_name 由调用方负责（/model/update），本函数只重写引用。
 * 形态保持：数组/对象、对象上的 recurse 等字段原样保留。
 * @param state - 引用面快照
 * @param from - 旧名
 * @param to - 新名
 * @param renameAliasKey - 是否连同别名键一起改名
 */
export function planModelReferenceRename(
	state: ModelReferenceState,
	from: string,
	to: string,
	renameAliasKey = false,
): ModelReferenceChanges {
	const counts: Array<{ surface: string; rewritten: number }> = [];
	const rows: Array<{ modelId: string; modelInfo: Record<string, unknown> }> = [];
	const teams: Array<{ teamId: string; models: string[] }> = [];
	const tokens: Array<{ tokenId: string; models: string[] }> = [];
	const permissions: Array<{ permissionId: string; models: string[] }> = [];
	let rowModelInfoChanged = 0;
	const router = asRecord(state.routerSettings);
	const aliases = asRecord(router["model_group_alias"]);
	const aliasResult = rewriteAliasMap(aliases, from, to, renameAliasKey);
	let nextRouter: Record<string, unknown> | undefined;
	if (aliasResult.changed > 0) {
		counts.push({ surface: "model_group_alias", rewritten: aliasResult.changed });
		nextRouter = { ...router, model_group_alias: aliasResult.aliases };
	}
	for (const [section, surface] of [
		["fallbacks", "router_settings.fallbacks"],
		["context_window_fallbacks", "router_settings.context_window_fallbacks"],
		["content_policy_fallbacks", "router_settings.content_policy_fallbacks"],
	] as const) {
		const result = rewriteFallbackEntries(router[section], from, to);
		if (result.changed > 0) {
			counts.push({ surface: surface, rewritten: result.changed });
			nextRouter = { ...(nextRouter ?? router), [section]: result.entries };
		}
	}
	for (const row of state.rows) {
		const info = asRecord(row.modelInfo);
		const override = info["override_model_name"];
		const fallbacks = Array.isArray(info["fallbacks"]) ? info["fallbacks"] : undefined;
		const nextFallbacks =
			fallbacks !== undefined
				? rewriteNameArray(
						fallbacks.filter((t): t is string => typeof t === "string"),
						from,
						to,
					)
				: undefined;
		let changed = 0;
		let nextInfo: Record<string, unknown> | undefined;
		if (typeof override === "string" && override === from) {
			changed++;
			nextInfo = { ...info, override_model_name: to };
		}
		if (nextFallbacks !== undefined && nextFallbacks.changed > 0) {
			changed += nextFallbacks.changed;
			nextInfo = { ...(nextInfo ?? info), fallbacks: nextFallbacks.names };
		}
		if (changed > 0) {
			rowModelInfoChanged += changed;
			rows.push({ modelId: row.modelId, modelInfo: nextInfo ?? info });
		}
	}
	if (rowModelInfoChanged > 0) {
		counts.push({ surface: "model_info", rewritten: rowModelInfoChanged });
	}
	for (const team of state.teams) {
		const result = rewriteNameArray(team.models, from, to);
		if (result.changed > 0) {
			counts.push({ surface: "TeamTable.models", rewritten: result.changed });
			teams.push({ teamId: team.teamId, models: result.names });
		}
	}
	for (const token of state.tokens) {
		const result = rewriteNameArray(token.models, from, to);
		if (result.changed > 0) {
			counts.push({ surface: "VerificationToken.models", rewritten: result.changed });
			tokens.push({ tokenId: token.tokenId, models: result.names });
		}
	}
	for (const permission of state.permissions) {
		const result = rewriteNameArray(permission.models, from, to);
		if (result.changed > 0) {
			counts.push({ surface: "ObjectPermissionTable.models", rewritten: result.changed });
			permissions.push({ permissionId: permission.permissionId, models: result.names });
		}
	}
	const general = asRecord(state.generalSettings);
	const websearch = general["websearch_override_target_model"];
	let generalSettings: Record<string, unknown> | undefined;
	if (websearch === from) {
		counts.push({ surface: "general_settings", rewritten: 1 });
		generalSettings = { ...general, websearch_override_target_model: to };
	}
	const capabilities = asRecord(state.capabilities);
	let capabilitiesChanged = 0;
	let nextCapabilities: Record<string, unknown> | undefined;
	for (const [capability, config] of Object.entries(capabilities)) {
		const record = asRecord(config);
		const executors = Array.isArray(record["executors"]) ? record["executors"] : undefined;
		if (executors === undefined) {
			continue;
		}
		let changed = 0;
		const nextExecutors = executors.map((executor) => {
			if (asRecord(executor)["model"] === from) {
				changed++;
				return { ...asRecord(executor), model: to };
			}
			return executor;
		});
		if (changed > 0) {
			capabilitiesChanged += changed;
			nextCapabilities = { ...(nextCapabilities ?? capabilities), [capability]: { ...record, executors: nextExecutors } };
		}
	}
	if (capabilitiesChanged > 0) {
		counts.push({ surface: "builtin_capabilities", rewritten: capabilitiesChanged });
	}
	return {
		...(nextRouter === undefined ? {} : { routerSettings: nextRouter }),
		...(generalSettings === undefined ? {} : { generalSettings: generalSettings }),
		...(nextCapabilities === undefined ? {} : { capabilities: nextCapabilities }),
		rows: rows,
		teams: teams,
		tokens: tokens,
		permissions: permissions,
		counts: counts,
	};
}

/**
 * 构建引用面快照。模型与配置经拥有表的 repository 读取并先失效缓存——审计必须看到
 * 外部直改数据库后的真实状态；团队/密钥/权限的投影查询本身不读按键缓存
 * （见各仓储的 `listModelWhitelists`），因此同样绕过缓存看到库里的权威值。
 * @param db - drizzle 数据库实例
 */
export async function loadModelReferenceState(db: DrizzleDb): Promise<ModelReferenceState> {
	const modelRepository = modelRepositoryFor(db);
	const configRepository = configRepositoryFor(db);
	modelRepository.invalidateCache();
	configRepository.invalidateCache();
	const [modelRows, configRows, teamRows, tokenRows, permissionRows] = await Promise.all([
		modelRepository.snapshotRows(),
		configRepository.snapshotRows(),
		teamRepositoryFor(db).listModelWhitelists(),
		keyRepositoryFor(db).listModelWhitelists(),
		objectPermissionRepositoryFor(db).listModelWhitelists(),
	]);
	const configByName = new Map(configRows.map((row) => [row.param_name, row.param_value]));
	return {
		groups: modelRows.map((row) => row.model_name).filter((name): name is string => typeof name === "string"),
		rows: modelRows
			.filter((row) => typeof row.model_name === "string")
			.map((row) => ({ modelId: row.model_id, modelName: row.model_name as string, modelInfo: asRecord(row.model_info) })),
		routerSettings: asRecord(configByName.get("router_settings")),
		generalSettings: asRecord(configByName.get("general_settings")),
		capabilities: asRecord(configByName.get(BUILTIN_CAPABILITIES_CONFIG_PARAM)),
		teams: teamRows.map((row) => ({ teamId: row.teamId, models: row.models ?? [] })).filter((row) => typeof row.teamId === "string"),
		tokens: tokenRows.map((row) => ({ tokenId: row.token, models: row.models ?? [] })).filter((row) => typeof row.tokenId === "string"),
		permissions: permissionRows
			.map((row) => ({ permissionId: row.objectPermissionId, models: row.models ?? [] }))
			.filter((row) => typeof row.permissionId === "string"),
	};
}

/**
 * 悬空校验是否可执行：模型表为空（全新安装或测试桩）时名字无从解析，跳过校验。
 * 生产库里始终有部署行；alias 键本身不能代替解析——目标最终要落到组上。
 * @param state - 引用面快照
 */
export function isModelReferenceValidationPossible(state: ModelReferenceState): boolean {
	return state.groups.length > 0;
}

/**
 * 落盘改名计划。模型行与配置段经各自 repository 写入（缓存同步失效，运行中的
 * 请求快照自动刷新）；团队白名单、密钥白名单与对象权限同样经各表仓储写入，
 * 写入后失效对应缓存，下一次鉴权读到的是新名字。逐面串行，失败时已写部分保留，
 * GET /model/references/audit 可核对剩余悬空并重跑改名补齐。
 * @param db - drizzle 数据库实例
 * @param changes - 改名计划
 * @param updatedBy - 写入者（模型行 updated_by）
 */
export async function persistModelReferenceChanges(db: DrizzleDb, changes: ModelReferenceChanges, updatedBy: string): Promise<void> {
	if (changes.routerSettings !== undefined) {
		await configRepositoryFor(db).upsertParam("router_settings", changes.routerSettings);
	}
	if (changes.generalSettings !== undefined) {
		await configRepositoryFor(db).upsertParam("general_settings", changes.generalSettings);
	}
	if (changes.capabilities !== undefined) {
		await configRepositoryFor(db).upsertParam(BUILTIN_CAPABILITIES_CONFIG_PARAM, changes.capabilities);
	}
	const modelRepository = modelRepositoryFor(db);
	for (const row of changes.rows) {
		await modelRepository.update(row.modelId, { model_info: row.modelInfo, updated_by: updatedBy, updated_at: new Date() });
	}
	const teamRepository = teamRepositoryFor(db);
	for (const team of changes.teams) {
		await teamRepository.replaceModels(team.teamId, team.models);
	}
	const keyRepository = keyRepositoryFor(db);
	for (const token of changes.tokens) {
		await keyRepository.updateByToken(token.tokenId, { models: [...token.models] });
	}
	const objectPermissionRepository = objectPermissionRepositoryFor(db);
	for (const permission of changes.permissions) {
		await objectPermissionRepository.replaceModels(permission.permissionId, permission.models);
	}
}
