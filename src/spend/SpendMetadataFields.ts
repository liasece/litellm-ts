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
	const keep = new Set(["status", "cold_storage_object_key"]);
	const include = fields.include && new Set(fields.include);
	const exclude = new Set(fields.exclude);
	return Object.fromEntries(
		Object.entries(metadata).filter(([key]) => keep.has(key) || (include ? include.has(key) : !exclude.has(key))),
	);
}
