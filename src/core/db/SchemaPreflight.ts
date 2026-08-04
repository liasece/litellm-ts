import { getTableColumns } from "drizzle-orm";
import type { PoolClient } from "pg";
import { LiteLLM_EndUserTable } from "../../db/schema/end-users";
import baseline from "./python-schema-baseline.json";

/**
 *
 */
export interface SchemaColumnSnapshot {
	/**
	 *
	 */
	readonly name: string;
	/**
	 *
	 */
	readonly type: string;
	/**
	 *
	 */
	readonly nullable: boolean;
	/**
	 *
	 */
	readonly default: string | null;
}

/**
 *
 */
export interface SchemaConstraintSnapshot {
	/**
	 *
	 */
	readonly kind: "primary" | "unique";
	/**
	 *
	 */
	readonly columns: readonly string[];
}

/**
 *
 */
export interface SchemaIndexSnapshot {
	/**
	 *
	 */
	readonly unique: boolean;
	/**
	 *
	 */
	readonly method: string;
	/**
	 *
	 */
	readonly keys: readonly string[];
	/**
	 *
	 */
	readonly predicate: string | null;
}

/**
 *
 */
export interface SchemaTableSnapshot {
	/**
	 *
	 */
	readonly name: string;
	/**
	 *
	 */
	readonly columns: readonly SchemaColumnSnapshot[];
	/**
	 *
	 */
	readonly constraints: readonly SchemaConstraintSnapshot[];
	/**
	 *
	 */
	readonly indexes: readonly SchemaIndexSnapshot[];
}

/**
 *
 */
export interface SchemaSnapshot {
	/**
	 *
	 */
	readonly source: string;
	/**
	 *
	 */
	readonly tables: readonly SchemaTableSnapshot[];
}

const INSPECT_SCHEMA_SQL = `
WITH tables AS (
  SELECT c.oid, c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname LIKE 'LiteLLM\\_%' ESCAPE '\\'
), columns AS (
  SELECT t.oid, jsonb_agg(jsonb_build_object(
    'name', a.attname,
    'type', format_type(a.atttypid, a.atttypmod),
    'nullable', NOT a.attnotnull,
    'default', pg_get_expr(d.adbin, d.adrelid)
  ) ORDER BY a.attnum) AS value
  FROM tables t
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = t.oid AND d.adnum = a.attnum
  GROUP BY t.oid
), constraints AS (
  SELECT t.oid, COALESCE(jsonb_agg(jsonb_build_object(
    'kind', CASE con.contype WHEN 'p' THEN 'primary' ELSE 'unique' END,
    'columns', (SELECT jsonb_agg(a.attname ORDER BY key.ordinality)
      FROM unnest(con.conkey) WITH ORDINALITY key(attnum, ordinality)
      JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = key.attnum)
  ) ORDER BY con.contype, con.conname) FILTER (WHERE con.oid IS NOT NULL), '[]'::jsonb) AS value
  FROM tables t
  LEFT JOIN pg_constraint con ON con.conrelid = t.oid AND con.contype IN ('p', 'u')
  GROUP BY t.oid
), indexes AS (
  SELECT t.oid, COALESCE(jsonb_agg(jsonb_build_object(
    'unique', i.indisunique,
    'method', am.amname,
    'keys', (SELECT jsonb_agg(pg_get_indexdef(i.indexrelid, key.ordinality::int, true) ORDER BY key.ordinality)
      FROM unnest(i.indkey) WITH ORDINALITY key(attnum, ordinality)),
    'predicate', pg_get_expr(i.indpred, i.indrelid)
  ) ORDER BY pg_get_indexdef(i.indexrelid)) FILTER (WHERE i.indexrelid IS NOT NULL), '[]'::jsonb) AS value
  FROM tables t
  LEFT JOIN pg_index i ON i.indrelid = t.oid
    AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid)
  LEFT JOIN pg_class ic ON ic.oid = i.indexrelid
  LEFT JOIN pg_am am ON am.oid = ic.relam
  GROUP BY t.oid
)
SELECT jsonb_build_object(
  'source', current_database() || ':' || current_schema(),
  'tables', COALESCE(jsonb_agg(jsonb_build_object(
    'name', t.relname,
    'columns', c.value,
    'constraints', co.value,
    'indexes', i.value
  ) ORDER BY t.relname), '[]'::jsonb)
) AS snapshot
FROM tables t
JOIN columns c USING (oid)
JOIN constraints co USING (oid)
JOIN indexes i USING (oid)`;

function normalizeSql(value: string | null): string | null {
	return value?.replace(/\s+/g, " ").trim() ?? null;
}

function constraintSignature(value: SchemaConstraintSnapshot): string {
	return `${value.kind}:${value.columns.join(",")}`;
}

function indexSignature(value: SchemaIndexSnapshot): string {
	return `${value.unique ? "unique" : "index"}:${value.method}:${value.keys.map((key) => normalizeSql(key)).join(",")}:${normalizeSql(value.predicate) ?? ""}`;
}

const DAILY_SPEND_TABLES_WITH_RESOLVED_MODEL_GROUP = new Set([
	"LiteLLM_DailyAgentSpend",
	"LiteLLM_DailyEndUserSpend",
	"LiteLLM_DailyOrganizationSpend",
	"LiteLLM_DailyTagSpend",
	"LiteLLM_DailyTeamSpend",
	"LiteLLM_DailyUserSpend",
]);

/**
 * 0006 migration 将 Python daily spend 唯一索引扩展为包含 model_group。
 * 这是受管迁移后的已知替换，不应被 Python baseline 预检误判为索引丢失。
 */
function hasManagedDailyModelGroupIndexReplacement(
	tableName: string,
	expected: SchemaIndexSnapshot,
	actualIndexes: readonly SchemaIndexSnapshot[],
): boolean {
	if (
		!DAILY_SPEND_TABLES_WITH_RESOLVED_MODEL_GROUP.has(tableName) ||
		!expected.unique ||
		expected.method !== "btree" ||
		expected.predicate !== null ||
		expected.keys.includes("model_group")
	) {
		return false;
	}
	const modelIndex = expected.keys.indexOf("model");
	if (modelIndex < 0) {
		return false;
	}
	const replacementKeys = [...expected.keys.slice(0, modelIndex + 1), "model_group", ...expected.keys.slice(modelIndex + 1)];
	return actualIndexes.some(
		(index) =>
			index.unique &&
			index.method === expected.method &&
			index.predicate === expected.predicate &&
			index.keys.length === replacementKeys.length &&
			index.keys.every((key, indexPosition) => normalizeSql(key) === normalizeSql(replacementKeys[indexPosition] ?? null)),
	);
}

/**
 * 比较 Python 基线要求与数据库实际结构；允许接管后新增对象，但不允许基线对象漂移。
 * @param expected
 * @param actual
 */
export function compareSchemaSnapshots(expected: SchemaSnapshot, actual: SchemaSnapshot): string[] {
	const drift: string[] = [];
	const actualTables = new Map(actual.tables.map((table) => [table.name, table]));
	for (const expectedTable of expected.tables) {
		const actualTable = actualTables.get(expectedTable.name);
		if (!actualTable) {
			drift.push(`missing table ${expectedTable.name}`);
			continue;
		}
		const actualColumns = new Map(actualTable.columns.map((column) => [column.name, column]));
		for (const expectedColumn of expectedTable.columns) {
			const actualColumn = actualColumns.get(expectedColumn.name);
			if (!actualColumn) {
				drift.push(`missing column ${expectedTable.name}.${expectedColumn.name}`);
				continue;
			}
			if (actualColumn.type !== expectedColumn.type) {
				drift.push(`type ${expectedTable.name}.${expectedColumn.name}: expected ${expectedColumn.type}, got ${actualColumn.type}`);
			}
			if (actualColumn.nullable !== expectedColumn.nullable) {
				drift.push(
					`nullable ${expectedTable.name}.${expectedColumn.name}: expected ${String(expectedColumn.nullable)}, got ${String(actualColumn.nullable)}`,
				);
			}
			if (normalizeSql(actualColumn.default) !== normalizeSql(expectedColumn.default)) {
				drift.push(`default ${expectedTable.name}.${expectedColumn.name} differs`);
			}
		}

		const actualConstraints = new Set(actualTable.constraints.map(constraintSignature));
		for (const constraint of expectedTable.constraints) {
			const signature = constraintSignature(constraint);
			if (!actualConstraints.has(signature)) {
				drift.push(`missing ${constraint.kind} constraint ${expectedTable.name}(${constraint.columns.join(",")})`);
			}
		}

		const actualIndexes = new Set(actualTable.indexes.map(indexSignature));
		for (const index of expectedTable.indexes) {
			if (
				!actualIndexes.has(indexSignature(index)) &&
				!hasManagedDailyModelGroupIndexReplacement(expectedTable.name, index, actualTable.indexes)
			) {
				drift.push(`missing index ${expectedTable.name}(${index.keys.join(",")})`);
			}
		}
	}
	return drift;
}

/**
 * 校验认证敏感运行时映射没有越过 Python 基线。
 * @throws {Error} 运行时映射与基线不一致时抛出
 */
export function validateRuntimeSchemaContract(): void {
	const endUserBaseline = (baseline as SchemaSnapshot).tables.find((table) => table.name === "LiteLLM_EndUserTable");
	if (!endUserBaseline) {
		throw new Error("Runtime schema contract unavailable: LiteLLM_EndUserTable baseline missing");
	}
	const expectedColumns = endUserBaseline.columns.map((column) => column.name).sort();
	const runtimeColumns = Object.values(getTableColumns(LiteLLM_EndUserTable))
		.map((column) => column.name)
		.sort();
	if (runtimeColumns.length !== expectedColumns.length || runtimeColumns.some((column, index) => column !== expectedColumns[index])) {
		throw new Error(
			`Runtime schema contract mismatch: LiteLLM_EndUserTable expected [${expectedColumns.join(", ")}], got [${runtimeColumns.join(", ")}]`,
		);
	}
}

/**
 * 对当前 search_path schema 执行只读 catalog inspection，并拒绝 Python LiteLLM 基线漂移。
 * @param client
 */
export async function runSchemaPreflight(client: PoolClient): Promise<void> {
	validateRuntimeSchemaContract();
	const result = await client.query<{ snapshot: SchemaSnapshot }>(INSPECT_SCHEMA_SQL);
	const actual = result.rows[0]?.snapshot;
	if (!actual) {
		throw new Error("PostgreSQL schema preflight failed: catalog snapshot unavailable");
	}
	const drift = compareSchemaSnapshots(baseline as SchemaSnapshot, actual);
	if (drift.length > 0) {
		const visible = drift.slice(0, 20).join("; ");
		const remainder = drift.length > 20 ? `; and ${String(drift.length - 20)} more` : "";
		throw new Error(`PostgreSQL schema drift detected: ${visible}${remainder}`);
	}
}
