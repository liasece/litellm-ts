import type { ProviderParam } from "../support/GuardrailModels";
export function validateGuardrailFields(
	values: Record<string, unknown>,
	fields: Record<string, ProviderParam>,
	prefix = "",
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const [name, field] of Object.entries(fields)) {
		const key = prefix ? prefix + "." + name : name;
		if (field.type === "nested" && field.fields) {
			Object.assign(errors, validateGuardrailFields(values, field.fields, key));
			continue;
		}
		const value = values[key];
		if (field.required && (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)))
			errors[key] = name + " is required";
	}
	return errors;
}
