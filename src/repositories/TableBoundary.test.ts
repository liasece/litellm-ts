import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 运行时配置三张热表（配置 / 模型部署 / 凭据）的访问边界。
 *
 * 只有拥有该表的 repository 与 schema 定义可以出现表标识符；
 * 其余模块必须经 repository 读取，这样副本的装载与失效就不会散落在业务代码里。
 */
const OWNER_FILES = ["ConfigRepository.ts", "ModelRepository.ts", "CredentialRepository.ts"]
	.map((name) => join("src", "repositories", name))
	.map((file) => join(process.cwd(), file));

const TABLE_PATTERN = /\bLiteLLM_(?:Config|ProxyModelTable|CredentialsTable)\b/;

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function listSourceFiles(dir: string): string[] {
	const files: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...listSourceFiles(full));
			continue;
		}
		if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			files.push(full);
		}
	}
	return files;
}

describe("运行时配置表边界", () => {
	it("配置、模型部署、凭据三张表只允许拥有它的 repository 访问", () => {
		const root = process.cwd();
		const schemaDir = join(root, "src", "db", "schema") + "/";
		const owners = new Set(OWNER_FILES);

		const offenders = listSourceFiles(join(root, "src"))
			.filter((file) => !file.startsWith(schemaDir) && !owners.has(file))
			.filter((file) => TABLE_PATTERN.test(stripComments(readFileSync(file, "utf8"))))
			.map((file) => relative(root, file));

		expect(offenders).toEqual([]);
	});
});
