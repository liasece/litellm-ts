import * as fs from "node:fs";
import * as path from "node:path";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("ModelCostMapService");

const DEFAULT_MODEL_COST_MAP_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MIN_MODELS = 1_000;
const DEFAULT_MIN_BUNDLED_RATIO = 0.5;
const HOURS_TO_MS = 60 * 60 * 1000;

/**
 *
 */
export type ModelCostMapEntry = Readonly<Record<string, unknown>>;
/**
 *
 */
export type ModelCostMap = Readonly<Record<string, ModelCostMapEntry>>;
/**
 *
 */
export type ModelCostMapSource = "local" | "remote";

/**
 *
 */
export interface ModelCostMapSnapshot {
	/**
	 *
	 */
	readonly map: ModelCostMap;
	/**
	 *
	 */
	readonly rawJson: string;
	/**
	 *
	 */
	readonly source: ModelCostMapSource;
	/**
	 *
	 */
	readonly url: string | null;
	/**
	 *
	 */
	readonly isEnvForced: boolean;
	/**
	 *
	 */
	readonly fallbackReason: string | null;
	/**
	 *
	 */
	readonly modelCount: number;
	/**
	 *
	 */
	readonly loadedAt: string;
}

/**
 *
 */
export interface ModelCostMapScheduleStatus {
	/**
	 *
	 */
	readonly scheduled: boolean;
	/**
	 *
	 */
	readonly hours: number | null;
	/**
	 *
	 */
	readonly nextReloadAt: string | null;
}

interface ModelCostMapServiceOptions {
	readonly bundledRawJson?: string;
	readonly bundledFilePath?: string;
	readonly fetchImpl?: typeof fetch;
	readonly env?: NodeJS.ProcessEnv;
	readonly now?: () => Date;
	readonly setIntervalImpl?: typeof setInterval;
	readonly clearIntervalImpl?: typeof clearInterval;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPositiveNumber(value: string | undefined, fallback: number): number {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeNumber(value: string | undefined, fallback: number): number {
	if (value === undefined) {
		return fallback;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function deepFreeze<T>(value: T): T {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return value;
	}
	for (const nested of Object.values(value as Record<string, unknown>)) {
		deepFreeze(nested);
	}
	return Object.freeze(value);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 *
 */
export class ModelCostMapService {
	private readonly _bundledMap: ModelCostMap;
	private readonly _fetchImpl: typeof fetch;
	private readonly _env: NodeJS.ProcessEnv;
	private readonly _now: () => Date;
	private readonly _setIntervalImpl: typeof setInterval;
	private readonly _clearIntervalImpl: typeof clearInterval;
	private _snapshot: ModelCostMapSnapshot;
	private _initializePromise: Promise<ModelCostMapSnapshot> | null = null;
	private _reloadPromise: Promise<ModelCostMapSnapshot> | null = null;
	private _scheduleTimer: NodeJS.Timeout | null = null;
	private _scheduleHours: number | null = null;
	private _nextReloadAt: Date | null = null;

	constructor(options: ModelCostMapServiceOptions = {}) {
		const bundledFilePath = options.bundledFilePath ?? path.join(__dirname, "..", "data", "model_prices_and_context_window.json");
		const bundledRawJson = options.bundledRawJson ?? fs.readFileSync(bundledFilePath, "utf8");
		const bundledParsed = this._parseAndValidateMap(bundledRawJson, "bundled model cost map");
		this._bundledMap = this._expandAliases(bundledParsed);
		this._fetchImpl = options.fetchImpl ?? fetch;
		this._env = options.env ?? process.env;
		this._now = options.now ?? (() => new Date());
		this._setIntervalImpl = options.setIntervalImpl ?? setInterval;
		this._clearIntervalImpl = options.clearIntervalImpl ?? clearInterval;
		this._snapshot = this._buildSnapshot(this._bundledMap, {
			source: "local",
			url: null,
			isEnvForced: this._isLocalForced(),
			fallbackReason: null,
		});
	}

	/**
	 *
	 */
	getSnapshot(): ModelCostMapSnapshot {
		return this._snapshot;
	}

	/**
	 *
	 */
	initialize(): Promise<ModelCostMapSnapshot> {
		if (this._initializePromise === null) {
			this._initializePromise = this.reload();
		}
		return this._initializePromise;
	}

	/**
	 *
	 */
	reload(): Promise<ModelCostMapSnapshot> {
		if (this._reloadPromise !== null) {
			return this._reloadPromise;
		}
		const reloadPromise = this._loadSnapshot().then((snapshot) => {
			this._snapshot = snapshot;
			return snapshot;
		});
		this._reloadPromise = reloadPromise.finally(() => {
			this._reloadPromise = null;
		});
		return this._reloadPromise;
	}

	/**
	 * @param hours
	 * @throws hours 不是正有限数时抛出错误
	 */
	schedule(hours: number): ModelCostMapScheduleStatus {
		if (!Number.isFinite(hours) || hours <= 0) {
			throw new Error("hours must be a finite number greater than 0");
		}
		this.cancelSchedule();
		const intervalMs = hours * HOURS_TO_MS;
		this._scheduleHours = hours;
		this._nextReloadAt = new Date(this._now().getTime() + intervalMs);
		this._scheduleTimer = this._setIntervalImpl(() => {
			this._nextReloadAt = new Date(this._now().getTime() + intervalMs);
			void this.reload().catch((error: unknown) => {
				logger.error("Scheduled model cost map reload failed", { error: errorMessage(error) });
			});
		}, intervalMs);
		this._scheduleTimer.unref();
		return this.getScheduleStatus();
	}

	/**
	 *
	 */
	cancelSchedule(): ModelCostMapScheduleStatus {
		if (this._scheduleTimer !== null) {
			this._clearIntervalImpl(this._scheduleTimer);
		}
		this._scheduleTimer = null;
		this._scheduleHours = null;
		this._nextReloadAt = null;
		return this.getScheduleStatus();
	}

	/**
	 *
	 */
	getScheduleStatus(): ModelCostMapScheduleStatus {
		return {
			scheduled: this._scheduleTimer !== null,
			hours: this._scheduleHours,
			nextReloadAt: this._nextReloadAt?.toISOString() ?? null,
		};
	}

	private async _loadSnapshot(): Promise<ModelCostMapSnapshot> {
		if (this._isLocalForced()) {
			return this._buildSnapshot(this._bundledMap, {
				source: "local",
				url: null,
				isEnvForced: true,
				fallbackReason: null,
			});
		}

		const url = this._env.LITELLM_MODEL_COST_MAP_URL ?? DEFAULT_MODEL_COST_MAP_URL;
		try {
			const timeoutMs = readPositiveNumber(this._env.LITELLM_MODEL_COST_MAP_TIMEOUT_MS, DEFAULT_FETCH_TIMEOUT_MS);
			const response = await this._fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
			if (!response.ok) {
				throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
			}
			const rawJson = await response.text();
			const parsed = this._parseAndValidateMap(rawJson, "remote model cost map");
			this._validateRemoteIntegrity(parsed);
			const expanded = this._expandAliases(parsed);
			return this._buildSnapshot(expanded, {
				source: "remote",
				url: url,
				isEnvForced: false,
				fallbackReason: null,
			});
		} catch (error) {
			const fallbackReason = errorMessage(error);
			logger.warn("Remote model cost map unavailable; using bundled fallback", {
				url: url,
				error: fallbackReason,
			});
			return this._buildSnapshot(this._bundledMap, {
				source: "local",
				url: url,
				isEnvForced: false,
				fallbackReason: fallbackReason,
			});
		}
	}

	private _parseAndValidateMap(rawJson: string, label: string): Record<string, Record<string, unknown>> {
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawJson);
		} catch (error) {
			throw new Error(`${label} is invalid JSON: ${errorMessage(error)}`);
		}
		if (!isRecord(parsed) || Object.keys(parsed).length === 0) {
			throw new Error(`${label} must be a non-empty top-level object`);
		}
		const result: Record<string, Record<string, unknown>> = {};
		for (const [model, entry] of Object.entries(parsed)) {
			if (!isRecord(entry)) {
				throw new Error(`${label} entry "${model}" must be an object`);
			}
			result[model] = { ...entry };
		}
		return result;
	}

	private _validateRemoteIntegrity(map: Record<string, Record<string, unknown>>): void {
		const modelCount = Object.keys(map).length;
		const minimumModels = readPositiveNumber(this._env.LITELLM_MODEL_COST_MAP_MIN_MODELS, DEFAULT_MIN_MODELS);
		if (modelCount < minimumModels) {
			throw new Error(`remote model cost map model count ${modelCount} is below minimum ${minimumModels}`);
		}
		const minimumBundledRatio = readNonNegativeNumber(this._env.LITELLM_MODEL_COST_MAP_MIN_BUNDLED_RATIO, DEFAULT_MIN_BUNDLED_RATIO);
		const minimumRelativeCount = Math.ceil(Object.keys(this._bundledMap).length * minimumBundledRatio);
		if (modelCount < minimumRelativeCount) {
			throw new Error(
				`remote model cost map shrink detected: ${modelCount} models is below bundled threshold ${minimumRelativeCount}`,
			);
		}
	}

	private _expandAliases(map: Record<string, Record<string, unknown>>): ModelCostMap {
		const expanded: Record<string, Record<string, unknown>> = {};
		for (const [model, entry] of Object.entries(map)) {
			expanded[model] = { ...entry };
		}
		for (const [canonical, entry] of Object.entries(map)) {
			const aliases = entry.aliases;
			if (!Array.isArray(aliases)) {
				continue;
			}
			for (const alias of aliases) {
				if (typeof alias !== "string" || alias.length === 0) {
					continue;
				}
				if (expanded[alias] !== undefined) {
					logger.warn("Model cost map alias conflicts with canonical key; skipping alias", {
						alias: alias,
						canonical: canonical,
					});
					continue;
				}
				expanded[alias] = { ...entry };
			}
		}
		return deepFreeze(expanded);
	}

	private _buildSnapshot(
		map: ModelCostMap,
		metadata: Pick<ModelCostMapSnapshot, "source" | "url" | "isEnvForced" | "fallbackReason">,
	): ModelCostMapSnapshot {
		const snapshot: ModelCostMapSnapshot = {
			map: map,
			rawJson: JSON.stringify(map),
			source: metadata.source,
			url: metadata.url,
			isEnvForced: metadata.isEnvForced,
			fallbackReason: metadata.fallbackReason,
			modelCount: Object.keys(map).length,
			loadedAt: this._now().toISOString(),
		};
		return deepFreeze(snapshot);
	}

	private _isLocalForced(): boolean {
		return this._env.LITELLM_LOCAL_MODEL_COST_MAP?.toLowerCase() === "true";
	}
}

export const modelCostMapService = new ModelCostMapService();
