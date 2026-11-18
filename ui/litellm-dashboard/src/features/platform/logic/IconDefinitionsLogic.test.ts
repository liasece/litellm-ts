import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import icons from "../ui/UiLucideIconDefinitions.json";
import { resolveIconNodes, type IconDefinitions } from "./IconDefinitionsLogic";

const definitions = icons as unknown as IconDefinitions;

describe("icon definitions", () => {
	it("accepts the suffix-less and suffixed spellings of the same icon", () => {
		expect(resolveIconNodes(definitions, "GripVertical").length).toBeGreaterThan(0);
		expect(resolveIconNodes(definitions, "GripVerticalIcon")).toEqual(resolveIconNodes(definitions, "GripVertical"));
	});

	it("ignores an unknown name instead of throwing", () => {
		expect(resolveIconNodes(definitions, "NotARealIcon")).toEqual([]);
	});

	it("resolves every literal icon name used by a component", () => {
		// 名字写错只会渲染空 svg，界面看起来“什么都没有”，所以在这里把字面量名字全部解析一遍。
		const missing: string[] = [];
		for (const file of vueFiles(sourceRoot())) {
			const text = readFileSync(file, "utf8");
			for (const match of text.matchAll(/<UiLucideIcon\b[^>]*?(?<![\w:-])name="([A-Za-z][A-Za-z0-9]*)"/gs)) {
				if (!resolveIconNodes(definitions, match[1]).length) missing.push(`${match[1]} (${file})`);
			}
		}
		expect(missing).toEqual([]);
	});
});

function sourceRoot() {
	return fileURLToPath(new URL("../../..", import.meta.url));
}

function* vueFiles(directory: string): Generator<string> {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name === "node_modules") continue;
			yield* vueFiles(path);
		} else if (entry.name.endsWith(".vue")) yield path;
	}
}
