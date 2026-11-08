import {
	getModelGroupAliasTarget,
	type ModelGroupAliases,
	type ModelGroupAliasValue,
	type ModelGroupAliasConfig,
} from "./ModelGroupAliasLogic";
export interface AliasResolution {
	path: string[];
	resolvedModel: string;
	reachable: boolean;
	error?: string;
}

function matchesModelName(target: string, modelNames: ReadonlySet<string>): boolean {
	if (modelNames.has(target)) return true;
	const strippedTarget = target.includes("/") ? target.slice(target.indexOf("/") + 1) : target;
	for (const modelName of modelNames) {
		if (modelName === strippedTarget) return true;
		if (!modelName.includes("*")) continue;
		const prefix = modelName.replace(/\*/g, "");
		if (target.startsWith(prefix) || strippedTarget.startsWith(prefix)) return true;
	}
	return false;
}

export function objectAlias(value: ModelGroupAliasValue | undefined): ModelGroupAliasConfig | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

export function resolveAliasPath(
	aliasName: string,
	aliases: ModelGroupAliases,
	modelNames: ReadonlySet<string>,
	at = new Date(),
): AliasResolution {
	const path = [aliasName];
	const seen = new Set(path);
	let current = aliasName;
	while (Object.prototype.hasOwnProperty.call(aliases, current)) {
		let target: string | undefined;
		try {
			target = getModelGroupAliasTarget(aliases[current], at);
		} catch (error) {
			return {
				path,
				resolvedModel: current,
				reachable: false,
				error: error instanceof Error ? error.message : "Invalid schedule",
			};
		}
		if (target === undefined) break;
		path.push(target);
		if (seen.has(target)) {
			return { path, resolvedModel: target, reachable: false, error: `Alias cycle: ${path.join(" → ")}` };
		}
		seen.add(target);
		current = target;
	}
	const reachable = matchesModelName(current, modelNames);
	return {
		path,
		resolvedModel: current,
		reachable,
		error: reachable ? undefined : `No deployment matches “${current}”`,
	};
}
