/**
 * RFC 7386; own properties only, never assign prototype keys.
 * @param target
 * @param patch
 */
export function jsonMergePatch(target: unknown, patch: unknown): unknown {
	if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
		return structuredClone(patch);
	}
	const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	if (target && typeof target === "object" && !Array.isArray(target)) {
		for (const [key, value] of Object.entries(target)) {
			if (!isPrototypeKey(key)) {
				result[key] = structuredClone(value);
			}
		}
	}
	for (const [key, value] of Object.entries(patch)) {
		if (isPrototypeKey(key)) {
			continue;
		}
		if (value === null) {
			delete result[key];
		} else {
			result[key] = jsonMergePatch(result[key], value);
		}
	}
	return result;
}
function isPrototypeKey(key: string): boolean {
	return key === "__proto__" || key === "constructor" || key === "prototype";
}
