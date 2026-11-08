export function cloudZeroPayload(values: Record<string, string>, edit: boolean): Record<string, string> {
	const result: Record<string, string> = { timezone: values.timezone || "UTC" };
	if (!edit || values.connection_id) result.connection_id = values.connection_id;
	if (values.api_key) result.api_key = values.api_key;
	return result;
}
