import { isSensitiveKey } from "./sanitizeSensitiveValues";
/**
 * Redact known configured credentials embedded inside upstream error text.
 * @param text
 * @param config
 */
export function redactConfiguredSecrets(text: string, config: unknown): string {
	const secrets = new Set<string>();
	const visit = (value: unknown, sensitive = false): void => {
		if (typeof value === "string") {
			if (sensitive && value) {
				secrets.add(value);
				if (/^Bearer /i.test(value)) {
					secrets.add(value.slice(7));
				}
			}
			return;
		}
		if (!value || typeof value !== "object") {
			return;
		}
		for (const [key, item] of Object.entries(value)) {
			visit(item, sensitive || isSensitiveKey(key));
		}
	};
	visit(config);
	let result = text;
	for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
		result = result.split(secret).join("********");
	}
	return result;
}

/**
 * Redact configured secrets in structured error payloads without mutating the transport body.
 * @param value - Error payload
 * @param config - Known connection credentials
 */
export function redactErrorPayload(value: unknown, config: unknown): unknown {
	if (typeof value === "string") {
		return redactConfiguredSecrets(value, config);
	}
	if (Array.isArray(value)) {
		return value.map((item) => redactErrorPayload(item, config));
	}
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactErrorPayload(item, config)]));
	}
	return value;
}
