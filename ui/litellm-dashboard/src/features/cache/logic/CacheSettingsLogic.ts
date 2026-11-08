import type { CacheField } from "../api/CacheApi";
const basic = ["host", "port", "password", "username"],
	ssl = ["ssl", "ssl_cert_reqs", "ssl_check_hostname"],
	management = ["namespace", "ttl", "max_connections"],
	gcp = ["gcp_service_account", "gcp_ssl_ca_certs"];
export function cacheFieldGroups(fields: CacheField[]) {
	const names = (names: string[]) =>
		names.map((name) => fields.find((field) => field.field_name === name)).filter((field): field is CacheField => Boolean(field));
	return {
		basic: names(basic),
		ssl: names(ssl),
		management: names(management),
		gcp: names(gcp),
		cluster: fields.filter((field) => field.redis_type === "cluster"),
		sentinel: fields.filter((field) => field.redis_type === "sentinel"),
		semantic: fields.filter((field) => field.redis_type === "semantic"),
	};
}
export function gatherCacheValues(
	fields: CacheField[],
	redisType: string,
	values: Record<string, string | boolean | undefined>,
	save = false,
): Record<string, unknown> {
	const result: Record<string, unknown> = { type: save && redisType === "semantic" ? "redis-semantic" : "redis" };
	for (const field of fields) {
		if (field.field_name === "redis_type" || (field.redis_type != null && field.redis_type !== redisType)) continue;
		const raw = values[field.field_name];
		let value: unknown = null;
		if (field.field_type === "Boolean") {
			if (typeof raw === "boolean") value = raw;
		} else if (field.field_type === "List") {
			if (typeof raw === "string" && raw) {
				try {
					value = JSON.parse(raw);
				} catch {
					/* Legacy omits invalid JSON list inputs. */
				}
			}
		} else if (typeof raw === "string" && raw.trim()) {
			const trimmed = raw.trim();
			if (["Integer", "Float"].includes(field.field_type)) {
				const number = Number(trimmed);
				if (!Number.isNaN(number)) value = number;
			} else value = trimmed;
		}
		if (value !== null && value !== undefined) result[field.field_name] = value;
	}
	return result;
}
export function collectCacheInputs(root: HTMLElement, fields: CacheField[]): Record<string, string | boolean | undefined> {
	const values: Record<string, string | boolean | undefined> = {};
	for (const field of fields) {
		const controls = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[name],textarea[name]")];
		const input = controls.find((input) => input.name === field.field_name);
		if (!input) continue;
		values[field.field_name] = field.field_type === "Boolean" ? (input as HTMLInputElement).checked : input.value;
	}
	return values;
}
