export interface AuditLogEntry {
	id: string;
	updated_at: string;
	changed_by: string;
	changed_by_api_key: string;
	action: string;
	table_name: string;
	object_id: string;
	before_value: Record<string, unknown>;
	updated_values: Record<string, unknown>;
}
