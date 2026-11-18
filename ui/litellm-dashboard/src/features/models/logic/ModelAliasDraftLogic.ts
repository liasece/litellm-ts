import { objectAlias } from "./AliasResolutionLogic";
import { modelString, type DisplayProxyModel, type ProxyModel } from "../support/ModelModels";
import type { ModelGroupAliases, ModelGroupAliasValue, ModelGroupAliasWindow } from "./ModelGroupAliasLogic";

/**
 * 编辑中的别名。
 *
 * 存储形态有字符串、数组、对象三种写法，界面只面对这一份草稿：单目标、目标顺序、
 * 递归开关和时段都能在一处表达，保存时再折回最紧凑的存储形态。
 */
export interface ModelAliasDraft {
	name: string;
	/** 有顺序的目标：首项是主目标，其余是失败后的同级候选。 */
	targets: string[];
	/** 目标失败后是否继续目标自身的 fallback。 */
	recurse: boolean;
	timezone: string;
	schedule: ModelGroupAliasWindow[];
}

/** 时段使用的默认时区；没有时段时该值不落盘。 */
export const DEFAULT_ALIAS_TIMEZONE = "Asia/Shanghai";

/** 从任意存储形态读出有序目标，空别名留一个空行供编辑。 */
export function aliasDraftTargets(value: ModelGroupAliasValue | undefined): string[] {
	if (value === undefined) return [""];
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.length ? [...value] : [""];
	const declared = value.targets ?? (value.model === undefined ? [] : [value.model]);
	return declared.length ? [...declared] : [""];
}

/** 把已存储的别名读成草稿；新增别名时传 undefined。 */
export function aliasDraft(name: string, value?: ModelGroupAliasValue): ModelAliasDraft {
	const config = objectAlias(value);
	return {
		name,
		targets: aliasDraftTargets(value),
		recurse: config?.recurse !== false,
		timezone: config?.timezone ?? DEFAULT_ALIAS_TIMEZONE,
		schedule: config?.schedule?.map((window) => ({ ...window })) ?? [],
	};
}

/**
 * 把草稿折回存储形态。
 *
 * 单项目标且未关闭递归、没有时段时仍写字符串，保持既有配置的可读形态；
 * 其余情况写对象，因为旧形态既表达不了多个同级目标，也表达不了 recurse。
 * 原条目上的其它字段（hidden 等）原样保留。
 * @param draft - 编辑结果
 * @param original - 被编辑的原始值，用于保留草稿不表达的保护性字段
 */
export function aliasValueFromDraft(draft: ModelAliasDraft, original?: ModelGroupAliasValue): ModelGroupAliasValue {
	const values = draft.targets.map((target) => target.trim()).filter(Boolean);
	const rest: Record<string, unknown> = { ...objectAlias(original) };
	delete rest["model"];
	delete rest["targets"];
	delete rest["schedule"];
	delete rest["timezone"];
	if (draft.recurse) delete rest["recurse"];
	else rest["recurse"] = false;
	if (draft.schedule.length) {
		return {
			...rest,
			targets: values,
			timezone: draft.timezone.trim(),
			schedule: draft.schedule.map((window) => ({ ...window, model: window.model.trim() })),
		} as ModelGroupAliasValue;
	}
	if (values.length === 1 && Object.keys(rest).length === 0) return values[0]!;
	return { ...rest, targets: values } as ModelGroupAliasValue;
}

/**
 * 把一个带 Model Override 的模型转成别名的初始草稿。
 *
 * 别名沿用模型自身的公共名，主目标就是当前的 override 目标：请求的落点不变，
 * 只是从「模型上的强制改投」变成「路由层的别名」。
 * @param model - 待转换的模型部署
 */
export function conversionAliasDraft(model: DisplayProxyModel): ModelAliasDraft {
	const target = modelString(model.model_info.override_model_name);
	return {
		name: model.model_name,
		targets: [target],
		recurse: true,
		timezone: DEFAULT_ALIAS_TIMEZONE,
		schedule: [],
	};
}

/** 别名可选的目标：可路由模型与已有别名（含其它别名声明过的目标）。 */
export function aliasTargetNames(models: readonly string[], aliases: ModelGroupAliases): string[] {
	const values = new Set<string>();
	for (const model of models) if (model) values.add(model);
	for (const [name, value] of Object.entries(aliases)) {
		values.add(name);
		for (const target of aliasDraftTargets(value)) if (target) values.add(target);
	}
	return [...values].sort();
}

/**
 * 写入草稿后的完整别名表。
 *
 * 接口写的是整张表而不是单条补丁，所以先按当前线上内容重建：保留别人的条目和顺序，
 * 只替换本条；改名时旧名字被移除，避免留下指向旧名的重复配置。
 * @param aliases - 当前生效的别名表
 * @param draft - 编辑结果
 * @param originalName - 编辑前的名字；新增别名时为 null
 */
export function mergeAliasDraft(aliases: ModelGroupAliases, draft: ModelAliasDraft, originalName: string | null = null): ModelGroupAliases {
	const name = draft.name.trim();
	const value = aliasValueFromDraft(draft, originalName === null ? undefined : aliases[originalName]);
	const result: ModelGroupAliases = {};
	let placed = false;
	for (const [key, entry] of Object.entries(aliases)) {
		if (key === name || key === originalName) {
			if (!placed) {
				result[name] = value;
				placed = true;
			}
			continue;
		}
		result[key] = entry;
	}
	if (!placed) result[name] = value;
	return result;
}

/**
 * 草稿里能提前判定的错误；环、时区、时段重叠等结构问题交给保存前的整表校验。
 * @param draft - 编辑结果
 * @param aliases - 当前生效的别名表
 * @param originalName - 编辑前的名字；新增别名时为 null
 */
export function aliasDraftError(draft: ModelAliasDraft, aliases: ModelGroupAliases, originalName: string | null = null): string | null {
	const name = draft.name.trim();
	if (!name) return "Alias name is required";
	if (name !== originalName && Object.prototype.hasOwnProperty.call(aliases, name)) {
		return `An alias named "${name}" already exists. Choose a different name.`;
	}
	const values = draft.targets.map((target) => target.trim()).filter(Boolean);
	if (!values.length) return "At least one target is required";
	if (values.includes(name)) return "An alias cannot target itself";
	return null;
}

/**
 * 同一公共名下的全部部署 id。
 *
 * Model Override 按模型组建模（同组部署必须一致），而别名也以公共名为键。只删一行会
 * 让剩余部署继续按 override 改投，新别名因此永远不生效，所以转换以整个模型组为单位。
 * @param rows - 该公共名对应的部署（由接口按名字取全，不能用列表当前页代替）
 * @param modelName - 公共模型名
 */
export function modelGroupDeploymentIds(rows: readonly ProxyModel[], modelName: string): string[] {
	return rows
		.filter((row) => row.model_name === modelName)
		.map((row) => modelString(row.model_info.id))
		.filter(Boolean);
}
