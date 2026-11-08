import type { PlaygroundMcpTool } from "../support/PlaygroundModels";
import { asRecord } from "./PlaygroundValueLogic";
export interface ToolArgumentSchema {
	type?: string;
	description?: string;
	default?: unknown;
	enum?: unknown[];
	properties?: Record<string, ToolArgumentSchema>;
	items?: ToolArgumentSchema | ToolArgumentSchema[];
	required?: string[];
}
function schemaValue(raw: unknown): ToolArgumentSchema {
	const value = asRecord(raw) ?? {},
		properties = asRecord(value.properties),
		items = value.items;
	return {
		type: typeof value.type === "string" ? value.type : undefined,
		description: typeof value.description === "string" ? value.description : undefined,
		...("default" in value ? { default: value.default } : {}),
		enum: Array.isArray(value.enum) ? value.enum : undefined,
		properties: properties
			? Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, schemaValue(property)]))
			: undefined,
		items: Array.isArray(items) ? items.map(schemaValue) : asRecord(items) ? schemaValue(items) : undefined,
		required: Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === "string") : undefined,
	};
}
function arrayItems(items?: ToolArgumentSchema | ToolArgumentSchema[]): unknown[] {
	if (!items) return [];
	const values = Array.isArray(items) ? items.map((item) => defaultToolArgument(item)) : [defaultToolArgument(items)];
	return values.filter((value) => value !== undefined);
}
export function defaultToolArgument(property: ToolArgumentSchema | undefined, override?: unknown): unknown {
	if (!property) return undefined;
	const initial = override !== undefined ? override : property.default;
	if (property.type === "object") {
		const result = { ...(asRecord(initial) ?? {}) };
		for (const [key, child] of Object.entries(property.properties ?? {})) result[key] = defaultToolArgument(child, result[key]);
		return result;
	}
	if (property.type === "array") {
		if (Array.isArray(initial)) {
			if (!property.items) return initial;
			if (!initial.length) {
				const sample = arrayItems(property.items);
				return sample.length ? sample : initial;
			}
			const items = property.items;
			if (Array.isArray(items))
				return initial.map((value, index) => defaultToolArgument(items[index] ?? items[items.length - 1], value));
			return initial.map((value) => defaultToolArgument(items, value));
		}
		return initial !== undefined ? initial : arrayItems(property.items);
	}
	if (initial !== undefined) return initial;
	return ["integer", "number"].includes(property.type ?? "") ? 0 : property.type === "boolean" ? false : "";
}
export function toolArgumentSchema(tool: PlaygroundMcpTool): {
	schema: ToolArgumentSchema;
	actual: ToolArgumentSchema;
	stringInput: boolean;
} {
	const raw = tool.inputSchema ?? tool.input_schema,
		stringInput = typeof raw === "string";
	const schema = stringInput
		? { type: "object", properties: { input: { type: "string", description: "Input for this tool" } }, required: ["input"] }
		: schemaValue(raw);
	const params = schema.properties?.params;
	return { schema, actual: params?.type === "object" && params.properties ? params : schema, stringInput };
}
export function initialToolArguments(schema: ToolArgumentSchema): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(schema.properties ?? {}).map(([key, property]) => {
			const value = defaultToolArgument(property);
			return [
				key,
				property.type === "object" || property.type === "array"
					? JSON.stringify(value ?? (property.type === "array" ? [] : {}), null, 2)
					: value,
			];
		}),
	);
}
export function validateToolArguments(
	values: Record<string, unknown>,
	tool: PlaygroundMcpTool,
): { data: Record<string, unknown>; errors: Record<string, string> } {
	const { schema, actual, stringInput } = toolArgumentSchema(tool),
		data: Record<string, unknown> = {},
		errors: Record<string, string> = {};
	for (const [key, property] of Object.entries(actual.properties ?? {})) {
		const value = values[key],
			missing = value === null || value === undefined || value === "";
		if (missing) {
			if (actual.required?.includes(key)) errors[key] = stringInput ? "Please enter input for this tool" : "Please enter " + key;
			continue;
		}
		if (property.type === "object" || property.type === "array") {
			let parsed: unknown = value;
			try {
				if (typeof value === "string") parsed = JSON.parse(value) as unknown;
			} catch {
				errors[key] = "Invalid JSON";
				continue;
			}
			if (property.type === "object" ? !asRecord(parsed) : !Array.isArray(parsed)) {
				errors[key] = property.type === "object" ? "Please enter a JSON object" : "Please enter a JSON array";
				continue;
			}
			data[key] = parsed;
		} else if (property.type === "boolean") data[key] = value === true || value === "true";
		else if (property.type === "number" || property.type === "integer") {
			const number = Number(value);
			data[key] = Number.isNaN(number) ? value : property.type === "integer" ? Math.trunc(number) : number;
		} else data[key] = property.type === "string" ? String(value) : value;
	}
	return { data: schema.properties?.params?.type === "object" && schema.properties.params.properties ? { params: data } : data, errors };
}
