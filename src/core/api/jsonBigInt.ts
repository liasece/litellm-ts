/**
 * JSON 不支持 bigint；以十进制字符串保留 PostgreSQL BIGINT 的完整精度。
 * @param _key
 * @param value
 */
export function jsonBigIntReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}
