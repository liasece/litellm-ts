export function cacheRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
export function deepParseCache(value: unknown): unknown {
	if (typeof value !== "string") return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
export function cacheHealthDetails(response: Record<string, unknown>) {
	let error: Record<string, unknown> | null = null,
		params: Record<string, unknown> = {},
		redis: Record<string, unknown> = {};
	if (response.error) {
		const raw = cacheRecord(response.error);
		try {
			const parsed = cacheRecord(typeof raw.message === "string" ? JSON.parse(raw.message) : raw.message);
			error = { message: parsed.message || "Unknown error", traceback: parsed.traceback || "No traceback available" };
			params = cacheRecord(deepParseCache(parsed.litellm_cache_params));
			redis = cacheRecord(deepParseCache(parsed.health_check_cache_params));
		} catch {
			error = { message: String(raw.message || "Unknown error"), traceback: "Error parsing details" };
		}
	} else {
		params = cacheRecord(deepParseCache(response.litellm_cache_params));
		redis = cacheRecord(deepParseCache(response.health_check_cache_params));
	}
	const sync = cacheRecord(cacheRecord(cacheRecord(redis.redis_client).connection_pool).connection_kwargs),
		async = cacheRecord(cacheRecord(cacheRecord(redis.redis_async_client).connection_pool).connection_kwargs),
		kwargs = cacheRecord(redis.connection_kwargs);
	const host = sync.host || async.host || kwargs.host || redis.host || "N/A",
		port = sync.port || async.port || kwargs.port || redis.port || "N/A";
	const nodes = cacheRecord(redis.redis_kwargs).startup_nodes;
	const startup = nodes
		? JSON.stringify(nodes)
		: (sync.host || async.host) && (sync.port || async.port)
			? JSON.stringify([{ host: sync.host || async.host, port: sync.port || async.port }])
			: "N/A";
	const rows: { label: string; value: string; section?: boolean }[] = [];
	if (error)
		rows.push(
			{ label: "Error Details", value: "", section: true },
			{ label: "Error Message", value: String(error.message) },
			{ label: "Traceback", value: String(error.traceback) },
		);
	rows.push(
		{ label: "Cache Details", value: "", section: true },
		{ label: "Cache Configuration", value: String(params.type) },
		{ label: "Ping Response", value: String(response.ping_response) },
		{ label: "Set Cache Response", value: String(response.set_cache_response || "N/A") },
		{ label: "litellm_settings.cache_params", value: JSON.stringify(params, null, 2) },
	);
	if (params.type === "redis")
		rows.push(
			{ label: "Redis Details", value: "", section: true },
			{ label: "Redis Host", value: String(host) },
			{ label: "Redis Port", value: String(port) },
			{ label: "Redis Version", value: String(redis.redis_version || "N/A") },
			{ label: "Startup Nodes", value: startup },
			{ label: "Namespace", value: String(redis.namespace || "N/A") },
		);
	const raw = JSON.stringify(
		JSON.parse(
			JSON.stringify({ ...response, litellm_cache_params: params, health_check_cache_params: redis }, (_, value) =>
				deepParseCache(value),
			),
		),
		null,
		2,
	);
	return { rows, raw };
}
export function failedCacheHealth(reason: unknown) {
	let error: unknown = { message: "Unknown error occurred" };
	if (reason && typeof reason === "object" && "message" in reason) {
		try {
			const parsed: unknown = JSON.parse(String(reason.message));
			error = cacheRecord(parsed).error || parsed;
		} catch {
			error = { message: String(reason.message) };
		}
	}
	return { error };
}
