import { ApiError } from "../core/api/ApiError";

/**
 * @param alias
 * @param settings
 * @throws {Error} Rejects invalid input or a denied operation.
 */
export function validateKeyAlias(alias: unknown, settings: Record<string, unknown>): void {
	if (alias === undefined || alias === null) {
		return;
	}
	if (typeof alias !== "string") {
		throw ApiError.badRequest("Invalid key_alias");
	}
	const configured = settings["key_alias_pattern"];
	const pattern = configured ?? (settings["enable_key_alias_format_validation"] === true ? "[A-Za-z0-9_.-]+" : undefined);
	if (pattern === undefined) {
		return;
	}
	if (typeof pattern !== "string") {
		throw ApiError.badRequest("key_alias_pattern must be a string");
	}
	let expression: RegExp;
	try {
		expression = new RegExp(`^(?:${pattern})$`);
	} catch {
		throw ApiError.badRequest("Invalid key_alias_pattern configuration");
	}
	if (alias.length > 255 || !expression.test(alias)) {
		throw ApiError.badRequest("key_alias does not match the configured naming policy");
	}
}

/**
 * Validate an operator naming rule before saving it or accepting traffic.
 * @param settings
 * @throws {Error} Rejects invalid input or a denied operation.
 */
export function validateKeyAliasSettings(settings: Record<string, unknown>): void {
	const pattern = settings["key_alias_pattern"];
	if (pattern === undefined || pattern === null) {
		return;
	}
	if (typeof pattern !== "string") {
		throw ApiError.badRequest("key_alias_pattern must be a string");
	}
	try {
		new RegExp(`^(?:${pattern})$`);
	} catch {
		throw ApiError.badRequest("Invalid key_alias_pattern configuration");
	}
}
