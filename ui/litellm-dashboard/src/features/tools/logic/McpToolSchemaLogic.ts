import type { InputSchema, InputSchemaProperty, MCPTool } from "../support/McpModels";
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function arrayItems(items?: InputSchemaProperty | InputSchemaProperty[]): unknown[] {
	if (!items) return [];
	if (Array.isArray(items)) return items.map((item) => mcpDefaultValue(item)).filter((value) => value !== undefined);
	const value = mcpDefaultValue(items);
	return value === undefined ? [] : [value];
}
export function mcpDefaultValue(prop?: InputSchemaProperty, override?: unknown): unknown {
	if (!prop) return undefined;
	const value = override !== undefined ? override : prop.default;
	if (prop.type === "object") {
		const base: Record<string, unknown> = object(value) ? { ...value } : {};
		for (const [key, child] of Object.entries(prop.properties || {})) base[key] = mcpDefaultValue(child, base[key]);
		return base;
	}
	if (prop.type === "array") {
		if (Array.isArray(value)) {
			const items = prop.items;
			if (!items) return value;
			if (!value.length) {
				const sample = arrayItems(items);
				return sample.length ? sample : value;
			}
			if (Array.isArray(items)) return value.map((item, index) => mcpDefaultValue(items[index] ?? items[items.length - 1], item));
			return value.map((item) => mcpDefaultValue(items, item));
		}
		return value !== undefined ? value : arrayItems(prop.items);
	}
	if (value !== undefined) return value;
	return prop.type === "integer" || prop.type === "number" ? 0 : prop.type === "boolean" ? false : "";
}
export function mcpToolSchema(tool: Pick<MCPTool, "inputSchema">) {
	const schema: InputSchema =
		typeof tool.inputSchema === "string"
			? { type: "object", properties: { input: { type: "string", description: "Input for this tool" } }, required: ["input"] }
			: tool.inputSchema;
	const nested = schema?.properties?.params;
	if (nested?.type === "object" && nested.properties)
		return { schema: { type: "object" as const, properties: nested.properties, required: nested.required || [] }, nested: true };
	return { schema: schema || { type: "object" as const, properties: {} }, nested: false };
}
export function mcpInitialArguments(schema: InputSchema) {
	return Object.fromEntries(
		Object.entries(schema.properties || {}).map(([key, prop]) => {
			const value = mcpDefaultValue(prop);
			return [
				key,
				prop.type === "object" || prop.type === "array"
					? JSON.stringify(value ?? (prop.type === "array" ? [] : {}), null, 2)
					: value,
			];
		}),
	);
}
export function mcpArgumentErrors(schema: InputSchema, values: Record<string, unknown>) {
	const errors: Record<string, string> = {};
	for (const [key, prop] of Object.entries(schema.properties || {})) {
		const value = values[key];
		if (schema.required?.includes(key) && (value === undefined || value === null || value === "")) {
			errors[key] = "Please enter " + key;
			continue;
		}
		if (value !== undefined && value !== null && value !== "" && (prop.type === "object" || prop.type === "array")) {
			try {
				const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
				if (prop.type === "object" ? !object(parsed) : !Array.isArray(parsed)) errors[key] = "Please enter a JSON " + prop.type;
			} catch {
				errors[key] = "Invalid JSON";
			}
		}
	}
	return errors;
}
export function mcpToolArguments(tool: Pick<MCPTool, "inputSchema">, values: Record<string, unknown>) {
	const { schema, nested } = mcpToolSchema(tool),
		result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(values)) {
		if (value === null || value === undefined || value === "") continue;
		const prop = schema.properties?.[key];
		switch (prop?.type) {
			case "boolean":
				result[key] = value === true || value === "true";
				break;
			case "number":
			case "integer": {
				const number = Number(value);
				result[key] = Number.isNaN(number) ? value : prop.type === "integer" ? Math.trunc(number) : number;
				break;
			}
			case "object":
			case "array":
				try {
					const parsed: unknown = typeof value === "string" ? JSON.parse(value) : value;
					result[key] = (prop.type === "object" ? object(parsed) : Array.isArray(parsed)) ? parsed : value;
				} catch {
					result[key] = value;
				}
				break;
			case "string":
				result[key] = String(value);
				break;
			default:
				result[key] = value;
		}
	}
	return nested ? { params: result } : result;
}
export function mcpForwardedHeaders(alias: string | null | undefined, values: Record<string, string>) {
	const headers: Record<string, string> = {};
	if (!alias) return headers;
	for (const [key, value] of Object.entries(values)) if (value.trim()) headers["x-mcp-" + alias + "-" + key.toLowerCase()] = value;
	return headers;
}
export function mcpTextSections(text: string) {
	return text.split("\n\n").map((section) => ({
		text: section,
		type: section.startsWith("##")
			? "heading"
			: /https?:\/\/[^\s]+/.test(section)
				? "links"
				: section.includes("Score:")
					? "score"
					: "text",
		links: section.match(/https?:\/\/[^\s]+/g) || [],
	}));
}
