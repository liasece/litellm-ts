/**
 *
 */
export interface SpendMetadataFields {
	/**
	 *
	 */
	include?: string[];
	/**
	 *
	 */
	exclude?: string[];
}

/**
 * @param value
 * @throws {Error} Rejects invalid input or a denied operation.
 */
export function validateSpendMetadataFields(value: unknown): SpendMetadataFields | undefined {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== "object" || Array.isArray(value)) {
		throw new Error("spend_logs_metadata_fields must be an object");
	}
	const fields = value as Record<string, unknown>;
	if (Object.keys(fields).some((key) => key !== "include" && key !== "exclude") || ("include" in fields && "exclude" in fields)) {
		throw new Error("spend_logs_metadata_fields requires either include or exclude");
	}
	for (const key of ["include", "exclude"] as const) {
		const list = fields[key];
		if (list !== undefined && (!Array.isArray(list) || list.some((item) => typeof item !== "string" || item.length === 0))) {
			throw new Error(`spend_logs_metadata_fields.${key} must be a string array`);
		}
	}
	return fields as SpendMetadataFields;
}

/**
 * Projection is only applied to the persisted metadata column, after billing has been computed.
 * @param metadata
 * @param fields
 */
export function projectSpendMetadata(metadata: Record<string, unknown>, fields?: SpendMetadataFields): Record<string, unknown> {
	if (!fields) {
		return { ...metadata };
	}
	// 能力标记与 status 同等地位：include/exclude 只裁剪可配置的明细，不能把「这条请求
	// 被哪些路由能力处理过」裁掉，否则列表的 Feature 列会随配置静默变空。
	// upstream_errors 同样是诊断事实而非可配置明细，被裁掉后日志详情就无法在最终错误
	// 下方列出全部上游错误。
	const keep = new Set(["status", "cold_storage_object_key", "applied_features", "upstream_errors"]);
	const include = fields.include && new Set(fields.include);
	const exclude = new Set(fields.exclude);
	return Object.fromEntries(
		Object.entries(metadata).filter(([key]) => keep.has(key) || (include ? include.has(key) : !exclude.has(key))),
	);
}
