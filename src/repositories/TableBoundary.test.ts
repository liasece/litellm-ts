import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

/**
 * 表访问边界。
 *
 * 规则：`src/db/schema/*` 里的表符号只允许出现在 `*Repository.ts` 里。
 * 一张表的 SQL（读、写、聚合）集中在一个仓储文件里，缓存与失效才有一处可维护的地方；
 * 业务模块（端点和记账流程）拿仓储对象，不直接拼查询。
 *
 * 这条规则是「服务单例部署 + 仓储层负责缓存写穿」的前提：只有当一张表只有一个写入点，
 * 写穿才不会漏；也只有当读路径都经过仓储，分钟级 TTL 才不会被某个旁路查询绕过。
 */
/**
 * 从 schema 文件里收集表符号。
 *
 * 手写一份表名清单会在新增表时静默失效；直接读 `pgTable(` 的导出名，
 * 边界跟着 schema 自动扩展。
 */
function collectTableSymbols(schemaDir: string): string[] {
	const symbols = new Set<string>();
	for (const name of readdirSync(schemaDir)) {
		if (!name.endsWith(".ts")) {
			continue;
		}
		const source = readFileSync(join(schemaDir, name), "utf8");
		for (const match of source.matchAll(/export const (\w+)\s*=\s*pgTable\(/g)) {
			symbols.add(match[1] as string);
		}
	}
	return [...symbols].sort((left, right) => right.length - left.length);
}

/** 表符号的匹配式；按长度倒序，避免短名先命中半个标识符。 */
const TABLE_PATTERNS = collectTableSymbols(join(process.cwd(), "src", "db", "schema")).map((symbol) => new RegExp(`\\b${symbol}\\b`));

function referencesTable(source: string): boolean {
	const stripped = stripComments(source);
	return TABLE_PATTERNS.some((pattern) => pattern.test(stripped));
}

/** 允许引用表符号的非仓储文件：schema 自检只读列结构，属于结构层而不是业务访问。 */
const STRUCTURAL_EXCEPTIONS = new Set(["src/core/db/SchemaPreflight.ts"]);

/**
 * 尚未收敛的文件。
 *
 * 这个清单只允许变短：每迁移一个模块就从这里删一行，全部清空后这条用例才真正表达规则。
 */
const PENDING: readonly string[] = [];

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

describe("表访问边界", () => {
	const root = process.cwd();
	const schemaPrefix = join("src", "db", "schema") + "/";
	const pending = new Set(PENDING);

	it("表符号只出现在仓储文件里", () => {
		const offenders = listSourceFiles(join(root, "src"))
			.map((file) => relative(root, file))
			.filter((file) => !file.startsWith(schemaPrefix))
			.filter((file) => !STRUCTURAL_EXCEPTIONS.has(file))
			.filter((file) => !pending.has(file))
			.filter((file) => !basename(file).endsWith("Repository.ts"))
			.filter((file) => referencesTable(readFileSync(join(root, file), "utf8")));

		expect(offenders).toEqual([]);
	});

	it("业务代码经工厂取用仓储，不自己 new", () => {
		// 副本是按数据库连接绑定的；`new` 出来的第二个实例虽然指向同一份缓存，
		// 但一旦有人给某张表换了缓存策略，这里的旁路就会悄悄变成第二份缓存。
		// 装配处（container）与仓储自身、测试替身除外。
		const offenders = listSourceFiles(join(root, "src"))
			.map((file) => relative(root, file))
			.filter((file) => file !== join("src", "container.ts"))
			.filter((file) => !basename(file).endsWith("Repository.ts"))
			.filter((file) => !basename(file).includes(".test."))
			.filter((file) => /new [A-Z]\w*Repository\(/.test(stripComments(readFileSync(join(root, file), "utf8"))));

		expect(offenders).toEqual([]);
	});

	it("待收敛清单只减不增，且每一项都仍然违规", () => {
		const stillOffending = PENDING.filter((file) => referencesTable(readFileSync(join(root, file), "utf8")));
		// 已经迁移完的文件必须从清单里删掉，否则清单会掩盖新出现的旁路访问。
		expect(stillOffending).toEqual([...PENDING]);
	});
});
