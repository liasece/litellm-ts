/* eslint-disable jsdoc/check-alignment, jsdoc/require-throws */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { constants } from "node:fs";
import { access, link, mkdir, open, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { SUBSCRIPTION_PROVIDERS, isSubscriptionProvider, SubscriptionCatalog, type SubscriptionProvider, type CatalogEntry } from "../subscriptions/SubscriptionProviders";
import { SubscriptionAccountKeys, type KeySubscription, type SavedSubscriptionKey } from "../subscriptions/SubscriptionAccountKeys";
import type { ConfigRepository } from "../repositories/ConfigRepository";
import { ApiError } from "../core/api/ApiError";
import {
	CLIPROXY_CONFIG_PARAM,
	CLIPROXY_DEFAULT_PORT,
	type CliProxyAccountQuota,
	type CliProxyAccountSummary,
	type CliProxyLogEntry,
	type CliProxyOAuthProvider,
	type CliProxyOAuthSession,
	type CliProxyProcessState,
	type CliProxyRuntimeStatus,
	type CliProxyStoredSettings,
} from "./CliProxyTypes";
import {
	buildCliProxyQuotaRequests,
	normalizeCliProxyCommandCodeQuota,
	normalizeCliProxyPluginQuota,
	normalizeCliProxyQuota,
	type CliProxyQuotaRequest,
} from "./CliProxyQuota";
import {
	getCliProxyDrainSnapshot,
	resolveCliProxyDrainTimeoutMs,
	withCliProxyDrain,
} from "./CliProxyDrainGate";
import { waitForCliProxyReady } from "./CliProxyStartupGate";
import {
	COMMANDCODE_MODEL_PREFIX,
	MODEL_CATALOG_TIMEOUT_MS,
	OPENCODE_GO_MODEL_PREFIX,
	expectedModelPrefixes,
	extractModelIds,
	waitForModelCatalog,
} from "./CliProxyModelCatalog";

const MAX_LOG_ENTRIES = 4_000;
const MAX_OAUTH_OUTPUT_LINES = 500;
const STOP_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 15_000;
// 健康轮询间隔直接决定「进程已能接客」与实际判定的偏差：50ms 让启动窗口的尾部不再
// 固定多等最多 250ms，同时仍远低于一次健康探针的 1.5 秒超时。
const HEALTH_POLL_INTERVAL_MS = 50;
const MAX_OAUTH_SESSIONS = 32;
const RESERVED_CONFIG_KEYS = new Set(["host", "port", "auth-dir", "api-keys", "remote-management"]);
const OPENCODE_GO_PLUGIN_ID = "opencode-go-cliproxyapi";
const OPENCODE_GO_PLUGIN_BASE_URL = "https://opencode.ai/inference/go/v1";
// The Go runtime expands this environment reference after reading its config.
// eslint-disable-next-line no-template-curly-in-string
const OPENCODE_GO_ENV_REFERENCE = "${OPENCODE_GO_API_KEY}";
const COMMANDCODE_PLUGIN_ID = "commandcode-go-cliproxyapi";
const COMMANDCODE_PLUGIN_BASE_URL = "https://api.commandcode.ai/provider/v1";
const MANAGED_ACCOUNTS_KEY = "managed-accounts";
const COMMANDCODE_ACCOUNT_KEY = "commandcode";
const PROVIDER_SPECIFIC_QUOTA = new Set(["codex", "claude", "anthropic", "kimi", "antigravity", "xai"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把额度查询失败的原始原因压成一句可展示文本。
 *
 * 之前这里统一吞成"订阅额度查询失败"，用户无法区分该重试、该重新登录还是该换账号；
 * 保留状态码与上游正文后，503 才有可操作性。
 * @param error - 捕获到的失败原因
 */
function describeQuotaFailure(error: unknown): string {
	if (error instanceof ApiError) {
		return error.message;
	}
	if (isRecord(error)) {
		const status = error["statusCode"] ?? error["status"] ?? error["status_code"];
		const message = error["message"];
		if (typeof status === "number" || typeof status === "string") {
			return typeof message === "string" && message.length > 0 ? `HTTP ${status}: ${message.slice(0, 200)}` : `HTTP ${status}`;
		}
		if (typeof message === "string" && message.length > 0) {
			return message.slice(0, 200);
		}
	}
	return String(error).slice(0, 200);
}

/**
 * @param source
 */
export function parseCliProxyUserConfig(source: string): Record<string, unknown> {
	const parsed = yaml.load(source);
	if (parsed === undefined || parsed === null) {
		return {};
	}
	if (!isRecord(parsed)) {
		throw ApiError.badRequest("CLIProxy 配置必须是 YAML 对象");
	}
	for (const key of RESERVED_CONFIG_KEYS) {
		if (Object.prototype.hasOwnProperty.call(parsed, key)) {
			throw ApiError.badRequest(`${key} 由 LiteLLM 管理，不能在自定义配置中设置`);
		}
	}
	return parsed;
}

/**
 * Serialize a visual-editor config while applying the same managed-boundary validation
 * as the raw YAML editor.
 * @param value
 */
export function serializeCliProxyUserConfig(value: unknown): string {
	if (!isRecord(value)) {
		throw ApiError.badRequest("CLIProxy 配置必须是对象");
	}
	const source = yaml.dump(value, { noRefs: true, lineWidth: 120, sortKeys: false });
	parseCliProxyUserConfig(source);
	return source;
}

/**
 * 当前启用的托管插件组合。
 *
 * 每个插件是否注入由"插件文件存在"与"凭据/账户可用"共同决定；
 * `dir` 是 CPA 的插件目录，两个插件共享同一个目录。
 */
export interface CliProxyManagedPlugins {
	/** CPA 插件目录（.so/.dylib 存放处）。 */
	readonly dir: string;
	/** OpenCode Go 插件是否启用。 */
	readonly opencodeGo: boolean;
	/** CommandCode GOAT/Pro/Max 插件是否启用。 */
	readonly commandcode: boolean;
}

/** 托管 CommandCode 账户的只读摘要（不含密钥）。 */
export interface ManagedCommandCodeAccountSummary {
	/** 在 config.yaml 数组中的位置。 */
	readonly index: number;
	/** 展示名称。 */
	readonly label: string;
	/** 对应的 CPA auth 文件名。 */
	readonly filename: string;
}

/** LiteLLM 托管的一个 CommandCode 账户。 */
export interface ManagedCommandCodeAccount {
	/** CommandCode API key。 */
	readonly apiKey: string;
	/** 展示名称。 */
	readonly label: string;
}

/**
 * 读取 config.yaml 里 CommandCode 账户的原始条目。
 * @param userConfig
 */
function commandCodeAccountEntries(userConfig: Record<string, unknown>): Record<string, unknown>[] {
	const plugins = isRecord(userConfig["plugins"]) ? userConfig["plugins"] : null;
	const accounts = plugins && isRecord(plugins[MANAGED_ACCOUNTS_KEY]) ? plugins[MANAGED_ACCOUNTS_KEY] : null;
	const raw = accounts?.[COMMANDCODE_ACCOUNT_KEY];
	if (Array.isArray(raw)) {
		return raw.filter(isRecord).map((entry) => ({ ...entry }));
	}
	if (isRecord(raw)) {
		return [{ ...raw }];
	}
	return [];
}

/**
 * 把 CommandCode 账户条目写回 config.yaml 结构。
 * @param userConfig
 * @param entries
 */
function setCommandCodeAccountEntries(userConfig: Record<string, unknown>, entries: Record<string, unknown>[]): void {
	const plugins = isRecord(userConfig["plugins"]) ? { ...userConfig["plugins"] } : {};
	const accounts = isRecord(plugins[MANAGED_ACCOUNTS_KEY]) ? { ...plugins[MANAGED_ACCOUNTS_KEY] } : {};
	if (entries.length > 0) {
		accounts[COMMANDCODE_ACCOUNT_KEY] = entries;
	} else {
		delete accounts[COMMANDCODE_ACCOUNT_KEY];
	}
	if (Object.keys(accounts).length > 0) {
		plugins[MANAGED_ACCOUNTS_KEY] = accounts;
	} else {
		delete plugins[MANAGED_ACCOUNTS_KEY];
	}
	userConfig["plugins"] = plugins;
}

/**
 * 读取 config.yaml 中由 LiteLLM 托管的 CommandCode 账户列表。
 * 兼容旧的单对象写法：commandcode: {api-key, label}。
 * @param userConfig
 */
export function extractManagedCommandCodeAccounts(userConfig: Record<string, unknown>): ManagedCommandCodeAccount[] {
	const result: ManagedCommandCodeAccount[] = [];
	for (const entry of commandCodeAccountEntries(userConfig)) {
		const value = entry["api-key"];
		const apiKey = typeof value === "string" ? value.trim() : "";
		if (!apiKey) {
			continue;
		}
		const labelValue = entry["label"];
		const label = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim() : "CommandCode";
		result.push({ apiKey: apiKey, label: label });
	}
	return result;
}

/**
 * 托管 CommandCode 账户对应的 auth 文件名；同一把 key 始终映射到同一个文件。
 * @param apiKey
 */
export function commandCodeAccountFilename(apiKey: string): string {
	return `commandcode-managed-${createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 12)}.json`;
}

/**
 * 校验并规范化用户提交的 API key。
 * @param value
 */
function normalizeCommandCodeApiKey(value: unknown): string {
	if (typeof value !== "string") {
		throw ApiError.badRequest("CommandCode API key 必须是字符串");
	}
	const apiKey = value.trim();
	const hasControlCharacter = [...apiKey].some((character) => {
		const code = character.charCodeAt(0);
		return code < 32 || code === 127;
	});
	if (apiKey.length === 0 || apiKey.length > 8_192 || hasControlCharacter) {
		throw ApiError.badRequest("CommandCode API key 无效");
	}
	return apiKey;
}

/**
 * 校验并规范化账户展示名。
 * @param value
 */
function normalizeCommandCodeLabel(value: unknown): string {
	if (value === undefined || value === null || value === "") {
		return "CommandCode";
	}
	if (typeof value !== "string") {
		throw ApiError.badRequest("CommandCode 账户名称必须是字符串");
	}
	const label = value.trim();
	if (label.length > 200) {
		throw ApiError.badRequest("CommandCode 账户名称过长");
	}
	return label || "CommandCode";
}

/**
 * 从用户配置中移除 LiteLLM 托管的账户段，避免密钥进入 CPA 配置。
 * @param userConfig
 */
export function stripManagedCliProxyAccounts(userConfig: Record<string, unknown>): Record<string, unknown> {
	const plugins = userConfig["plugins"];
	if (!isRecord(plugins) || plugins[MANAGED_ACCOUNTS_KEY] === undefined) {
		return userConfig;
	}
	const nextPlugins: Record<string, unknown> = { ...plugins };
	delete nextPlugins[MANAGED_ACCOUNTS_KEY];
	return { ...userConfig, plugins: nextPlugins };
}

/**
 * @param userConfig
 * @param options
 */
export function buildCliProxyProjection(
	userConfig: Record<string, unknown>,
	options: {
		/**
		 *
		 */
		port: number; /**
		 *
		 */
		authDir: string; /**
		 *
		 */
		internalApiKey: string; /**
		 * Managed plugin toggles; when non-null the matching plugin entries are injected.
		 */
		plugins?: CliProxyManagedPlugins | null;
	},
): Record<string, unknown> {
	const sanitizedConfig = stripManagedCliProxyAccounts(userConfig);
	const projected: Record<string, unknown> = {
		...sanitizedConfig,
		host: "127.0.0.1",
		port: options.port,
		tls: { enable: false, cert: "", key: "" },
		"remote-management": {
			"allow-remote": false,
			"secret-key": "",
			"disable-control-panel": true,
			"disable-auto-update-panel": true,
		},
		"auth-dir": options.authDir,
		"api-keys": [options.internalApiKey],
		"logging-to-file": false,
		pprof: { enable: false, addr: "127.0.0.1:8316" },
	};
	if (options.plugins) {
		projected["plugins"] = buildCliProxyPluginConfig(sanitizedConfig["plugins"], options.plugins);
	}
	return projected;
}

/**
 * 合并托管插件的配置，允许用户在页面上覆盖密钥等字段。
 * @param userValue
 * @param plugins
 */
export function buildCliProxyPluginConfig(userValue: unknown, plugins: CliProxyManagedPlugins): Record<string, unknown> {
	const userPlugins = isRecord(userValue) ? { ...userValue } : {};
	delete userPlugins[MANAGED_ACCOUNTS_KEY];
	const userConfigs = isRecord(userPlugins["configs"]) ? (userPlugins["configs"] as Record<string, unknown>) : {};
	const configs: Record<string, unknown> = { ...userConfigs };
	if (plugins.opencodeGo) {
		const entry = isRecord(configs[OPENCODE_GO_PLUGIN_ID]) ? (configs[OPENCODE_GO_PLUGIN_ID] as Record<string, unknown>) : {};
		configs[OPENCODE_GO_PLUGIN_ID] = {
			enabled: true,
			"base-url": OPENCODE_GO_PLUGIN_BASE_URL,
			"model-prefix": { enabled: true, value: OPENCODE_GO_MODEL_PREFIX },
			"api-keys": [{ value: OPENCODE_GO_ENV_REFERENCE, name: "Personal" }],
			...entry,
		};
	}
	if (plugins.commandcode) {
		// CommandCode 不接受 api-keys：账户只来自 CPA auth 文件（type: commandcode）。
		const entry = isRecord(configs[COMMANDCODE_PLUGIN_ID]) ? (configs[COMMANDCODE_PLUGIN_ID] as Record<string, unknown>) : {};
		configs[COMMANDCODE_PLUGIN_ID] = {
			enabled: true,
			"base-url": COMMANDCODE_PLUGIN_BASE_URL,
			"model-prefix": { enabled: true, value: COMMANDCODE_MODEL_PREFIX },
			...entry,
		};
	}
	return {
		...userPlugins,
		enabled: true,
		dir: plugins.dir,
		configs: configs,
	};
}

function sanitizeImportedConfig(value: Record<string, unknown>): Record<string, unknown> {
	const result = stripManagedCliProxyAccounts({ ...value });
	for (const key of RESERVED_CONFIG_KEYS) {
		delete result[key];
	}
	delete result["logging-to-file"];
	return result;
}

function safeAccountFilename(value: string): string {
	if (path.basename(value) !== value || !value.endsWith(".json") || value.includes("\0")) {
		throw ApiError.badRequest("OAuth 账户文件名无效");
	}
	return value;
}

/**
 *
 */
export class CliProxyRuntimeManager {
	private readonly _repository: ConfigRepository;
	private readonly _accountKeys: SubscriptionAccountKeys;
	private readonly _runtimeRoot: string;
	private readonly _authDir: string;
	private readonly _logsDir: string;
	private readonly _configPath: string;
	private readonly _pluginDir: string;
	private readonly _subscriptionBinary = process.env["LITELLM_SUBSCRIPTIONS_BINARY"] ?? "/opt/cliproxy/litellm-subscriptions";
	private _binaryAvailable = false;
	readonly subscriptionCatalog = new SubscriptionCatalog();
	private _catalogRefresh?: NodeJS.Timeout;
	private _catalogRefreshChild?: ChildProcessWithoutNullStreams;

	private readonly _runtimeVersion = process.env["LITELLM_SUBSCRIPTIONS_VERSION"] ?? "8.0.57";
	private readonly _internalApiKey: string;
	private readonly _internalManagementKey: string;
	private readonly _port: number;
	private _settings: CliProxyStoredSettings = { enabled: true, config_yaml: "" };
	private _process: ChildProcessWithoutNullStreams | null = null;
	private _state: CliProxyProcessState = "stopped";
	private _startedAt: Date | null = null;
	private _restartCount = 0;
	private _lastExitCode: number | null = null;
	private _lastError: string | null = null;
	private _configHash: string | null = null;
	// 本次投影启用的托管插件：启动后据此等待插件模型前缀出现在模型目录里。
	private _plugins: CliProxyManagedPlugins | null = null;
	private _health: CliProxyRuntimeStatus["health"] = "unknown";
	private _operation: string | null = null;
	private _desiredStop = false;
	// 预热是否仍在进行：请求侧的启动等待据此区分「马上就会 running」与「继续等也没有意义」。
	private _startupPending = false;
	private _restartTimer: NodeJS.Timeout | null = null;
	private _operationTail: Promise<void> = Promise.resolve();
	private _logSequence = 0;
	// 由容器注入：返回 Router 侧在途的 CLIProxy 请求数，用于升级前排空。
	private _activeRequestProbe: () => number = () => 0;
	private readonly _logs: CliProxyLogEntry[] = [];
	private readonly _oauthSessions = new Map<
		string,
		{
			/**
			 *
			 */
			snapshot: CliProxyOAuthSession; /**
			 *
			 */
			process: ChildProcessWithoutNullStreams;
		}
	>();

	constructor(repository: ConfigRepository, masterKey: string | undefined) {
		this._repository = repository;
		this._accountKeys = new SubscriptionAccountKeys(repository, process.env["LITELLM_SALT_KEY"] || masterKey);
		this._runtimeRoot = process.env["CLIPROXY_RUNTIME_ROOT"] ?? "/var/lib/litellm/cliproxy";
		this._authDir = path.join(this._runtimeRoot, "auths");
		this._logsDir = path.join(this._runtimeRoot, "logs");
		this._configPath = path.join(this._runtimeRoot, "config.yaml");
		this._pluginDir = process.env["CLIPROXY_PLUGIN_DIR"] ?? path.join(this._runtimeRoot, "plugins");
		this._port = Number(process.env["CLIPROXY_INTERNAL_PORT"] ?? CLIPROXY_DEFAULT_PORT);
		const keyMaterial = masterKey && masterKey.length > 0 ? masterKey : randomUUID();
		this._internalApiKey =
			process.env["CLIPROXY_INTERNAL_API_KEY"] ??
			`cp-${createHmac("sha256", keyMaterial).update("litellm-cliproxy-internal-v1").digest("hex")}`;
		this._internalManagementKey = `cpm-${createHmac("sha256", keyMaterial).update("litellm-cliproxy-management-v1").digest("hex")}`;
		// Provider instances are created lazily and use this process-local value.
		process.env["CLIPROXY_INTERNAL_API_KEY"] = this._internalApiKey;
		process.env["CLIPROXY_INTERNAL_BASE_URL"] = this.baseUrl;
	}

	/**
	 *
	 */
	get baseUrl(): string {
		return `http://127.0.0.1:${this._port}`;
	}

	/**
	 *
	 */
	get internalApiKey(): string {
		return this._internalApiKey;
	}

	/**
	 *
	 */
	get settings(): CliProxyStoredSettings {
		return this._settings;
	}

	/**
	 *
	 */
	get userConfig(): Record<string, unknown> {
		return parseCliProxyUserConfig(this._settings.config_yaml);
	}

	/**
	 *
	 */
	async initialize(): Promise<void> {
		this._startupPending = true;
		try {
			await this._initializeSerially();
		} finally {
			this._startupPending = false;
		}
	}

	/**
	 * 等待 CLIProxy 进入可服务状态，供启动窗口内的请求路径调用。
	 *
	 * 只在预热仍在进行时等待：已经在 `running` 时立即返回，已禁用/已停止/崩溃循环/超时
	 * 也立即返回 false，让调用方按原逻辑走 fallback，而不是把请求拖满一个无意义的预算。
	 * @param timeoutMs - 等待上限（毫秒）
	 * @returns 是否在期限内变为 `running`
	 */
	async waitUntilReady(timeoutMs: number): Promise<boolean> {
		return await waitForCliProxyReady({
			readState: () => this._state,
			isStartupInProgress: () => this._startupPending && !this._desiredStop && this._settings.enabled,
			timeoutMs: timeoutMs,
		});
	}

	/**
	 * 预热主体：装文件、投影配置、拉起子进程；调用方负责维护启动等待标志。
	 */
	private async _initializeSerially(): Promise<void> {
		// 这段初始化在网关监听之后的后台预热里执行，管理接口此时已经可以进来，
		// 因此和其它改配置/改进程的操作共用同一个串行队列。每一步之前检查停止意图：
		// 停机过程中（SIGTERM 常落在启动这几秒内）不再继续装文件或拉起子进程。
		await this._serialize("initialize", async () => {
			await Promise.all([
				mkdir(this._runtimeRoot, { recursive: true }),
				mkdir(this._authDir, { recursive: true }),
				mkdir(this._logsDir, { recursive: true }),
				mkdir(this._pluginDir, {recursive: true}),
			]);
			if (this._desiredStop) {
				return;
			}
			this._binaryAvailable = await access(this._subscriptionBinary, constants.X_OK).then(() => true, () => false);
			if (!this._binaryAvailable) {
				this._state = "unavailable";
				this._lastError = "订阅运行时可执行文件未安装";
			}
			const stored = await this._repository.getParam(CLIPROXY_CONFIG_PARAM);
			if (stored) {
				this._settings = {
					enabled: stored["enabled"] !== false,
					config_yaml: typeof stored["config_yaml"] === "string" ? stored["config_yaml"] : "",
				};
			} else {
				this._settings = await this._importExistingOrDefaultSettings();
				await this._repository.upsertParam(CLIPROXY_CONFIG_PARAM, this._settings);
			}
			await this._accountKeys.load();
			await this._projectConfig();
			if (this._desiredStop || !this._settings.enabled || !this._binaryAvailable) {
				return;
			}
			// 直接起进程而不是走 start()：start() 会再次进入串行队列，在这里会自等待。
			// 传 true 让进程启动前的最后一次检查也认停机意图，避免停机中又被预热拉起。
			await this._startProcess(true);
		});
	}

	/**
	 *
	 */
	async shutdown(): Promise<void> {
		this._desiredStop = true;
		if (this._restartTimer) {
			clearTimeout(this._restartTimer);
			this._restartTimer = null;
		}
		for (const session of this._oauthSessions.values()) {
			if (session.snapshot.state === "running") {
				session.process.kill("SIGTERM");
			}
		}
		await this._stopProcess();
	}

	/**
	 *
	 */
	/**
	 * 当前在途的 CLIProxy 请求数（Router 侧 + 直连端点侧）。
	 */
	private _countInFlightRequests(): number {
		let routerSide = 0;
		try {
			routerSide = Math.max(0, Math.trunc(this._activeRequestProbe()));
		} catch {
			routerSide = 0;
		}
		return routerSide + getCliProxyDrainSnapshot().in_flight_requests;
	}

	/**
	 * 注入 Router 侧在途请求探针；排空要等这些请求写完才重启进程。
	 * @param probe - 返回在途 CLIProxy 请求数的函数
	 */
	setActiveRequestProbe(probe: () => number): void {
		this._activeRequestProbe = probe;
	}

	/**
	 * 运行时状态快照：版本、健康、进程信息与升级排空进度。
	 */
	status(): CliProxyRuntimeStatus {
		const uptime =
			this._startedAt && this._state === "running" ? Math.max(0, Math.floor((Date.now() - this._startedAt.getTime()) / 1000)) : null;
		return {
			available: this._binaryAvailable,
			engine: this._process ? "subscriptions" : null,
			enabled: this._settings.enabled,
			state: this._state,
			version: this._binaryAvailable ? this._runtimeVersion : null,
			installed_versions: this._binaryAvailable ? [this._runtimeVersion] : [],
			pid: this._process?.pid ?? null,
			started_at: this._startedAt?.toISOString() ?? null,
			uptime_seconds: uptime,
			restart_count: this._restartCount,
			last_exit_code: this._lastExitCode,
			last_error: this._lastError,
			config_hash: this._configHash,
			health: this._health,
			operation: this._operation,
			draining: getCliProxyDrainSnapshot().draining,
			in_flight_requests: this._countInFlightRequests(),
		};
	}

	/**
	 * @param next
	 */
	async saveSettings(next: CliProxyStoredSettings): Promise<CliProxyRuntimeStatus> {
		parseCliProxyUserConfig(next.config_yaml);
		await this._serialize("apply-config", async () => {
			this._settings = { enabled: next.enabled, config_yaml: next.config_yaml };
			await this._repository.upsertParam(CLIPROXY_CONFIG_PARAM, this._settings);
			await this._projectConfig();
			if (!next.enabled) {
				this._desiredStop = true;
				await this._stopProcess();
				return;
			}
			if (!this._process) {
				await this._startProcess();
				// _startProcess 在健康检查超时时返回 degraded 而不抛错；此处显式上报失败，避免 saveSettings 假装成功。
				if (this._state !== "running") {
					throw ApiError.unavailable(this._lastError ?? "CLIProxy 启动后健康检查未通过");
				}
				return;
			}
			this._appendLog("system", "配置已写入，等待 CLIProxy 热重载");
			await new Promise((resolve) => setTimeout(resolve, 600));
			if (!(await this._waitForHealth(HEALTH_TIMEOUT_MS))) {
				this._appendLog("system", "热重载后健康检查失败，自动重启 CLIProxy");
				await this._restartProcess();
				if (this._state !== "running") {
					throw ApiError.unavailable(this._lastError ?? "CLIProxy 重启后健康检查未通过");
				}
			}
		});
		return this.status();
	}

	/**
	 * @param enabled
	 * @param userConfig
	 */
	async saveUserConfig(enabled: boolean, userConfig: unknown): Promise<CliProxyRuntimeStatus> {
		return this.saveSettings({ enabled: enabled, config_yaml: serializeCliProxyUserConfig(userConfig) });
	}

	/**
	 * 列出托管 CommandCode 账户，不返回密钥。
	 */
	async listCommandCodeAccounts(): Promise<ManagedCommandCodeAccountSummary[]> {
		const userConfig = parseCliProxyUserConfig(this._settings.config_yaml);
		return extractManagedCommandCodeAccounts(userConfig).map((account, index) => ({
			index: index,
			label: account.label,
			filename: commandCodeAccountFilename(account.apiKey),
		}));
	}

	/**
	 * 新增一个托管 CommandCode 账户。
	 * @param apiKeyValue
	 * @param labelValue
	 */
	async addCommandCodeAccount(apiKeyValue: unknown, labelValue?: unknown): Promise<ManagedCommandCodeAccountSummary[]> {
		const apiKey = normalizeCommandCodeApiKey(apiKeyValue);
		const label = normalizeCommandCodeLabel(labelValue);
		const userConfig = parseCliProxyUserConfig(this._settings.config_yaml);
		const entries = commandCodeAccountEntries(userConfig);
		if (entries.some((entry) => typeof entry["api-key"] === "string" && entry["api-key"].trim() === apiKey)) {
			throw ApiError.conflict("该 CommandCode API key 已存在");
		}
		entries.push({ "api-key": apiKey, label: label });
		await this._saveCommandCodeAccountEntries(userConfig, entries);
		return this.listCommandCodeAccounts();
	}

	/**
	 * 修改托管 CommandCode 账户的 label，或轮换 API key。
	 * @param indexValue
	 * @param patch
	 */
	async updateCommandCodeAccount(
		indexValue: number,
		patch: { apiKey?: unknown; label?: unknown },
	): Promise<ManagedCommandCodeAccountSummary[]> {
		const userConfig = parseCliProxyUserConfig(this._settings.config_yaml);
		const entries = commandCodeAccountEntries(userConfig);
		if (!Number.isInteger(indexValue) || indexValue < 0 || indexValue >= entries.length) {
			throw ApiError.notFound("CommandCode 账户不存在");
		}
		const entry = entries[indexValue]!;
		if (patch.apiKey !== undefined) {
			const apiKey = normalizeCommandCodeApiKey(patch.apiKey);
			const duplicate = entries.some(
				(candidate, index) =>
					index !== indexValue && typeof candidate["api-key"] === "string" && candidate["api-key"].trim() === apiKey,
			);
			if (duplicate) {
				throw ApiError.conflict("该 CommandCode API key 已存在");
			}
			entry["api-key"] = apiKey;
		}
		if (patch.label !== undefined) {
			entry["label"] = normalizeCommandCodeLabel(patch.label);
		}
		await this._saveCommandCodeAccountEntries(userConfig, entries);
		return this.listCommandCodeAccounts();
	}

	/**
	 * 删除一个托管 CommandCode 账户。
	 * @param indexValue
	 */
	async deleteCommandCodeAccount(indexValue: number): Promise<ManagedCommandCodeAccountSummary[]> {
		const userConfig = parseCliProxyUserConfig(this._settings.config_yaml);
		const entries = commandCodeAccountEntries(userConfig);
		if (!Number.isInteger(indexValue) || indexValue < 0 || indexValue >= entries.length) {
			throw ApiError.notFound("CommandCode 账户不存在");
		}
		entries.splice(indexValue, 1);
		await this._saveCommandCodeAccountEntries(userConfig, entries);
		return this.listCommandCodeAccounts();
	}

	/**
	 *
	 */
	async start(): Promise<CliProxyRuntimeStatus> {
		await this._serialize("start", async () => {
			await this._startProcess();
			this._assertRunning();
		});
		return this.status();
	}

	/**
	 *
	 */
	async stop(): Promise<CliProxyRuntimeStatus> {
		await this._serialize("stop", async () => {
			this._desiredStop = true;
			await this._stopProcess();
		});
		return this.status();
	}

	/**
	 *
	 */
	async restart(): Promise<CliProxyRuntimeStatus> {
		await this._serialize("restart", async () => {
			await this._restartProcess();
			this._assertRunning();
		});
		return this.status();
	}

	/**
	 *
	 */
	async listModels(): Promise<string[]> {
		const catalogs = await Promise.all(Object.keys(SUBSCRIPTION_PROVIDERS).filter(isSubscriptionProvider).map(source => this.listSubscriptionModels(source)));
		return [...new Set(catalogs.flat())].sort();
	}

	/**
	 * @param provider
	 */
	async listSavedKeys(provider: KeySubscription): Promise<SavedSubscriptionKey[]> {
		await this._accountKeys.load();
		const archived = await this._archivedAccountFiles();
		return this._accountKeys.list().filter(entry => entry.provider === provider && !archived.has(this._savedKeyFilename(entry)));
	}

	/**
	 * @param provider
	 * @param id
	 * @param label
	 * @param key
	 */
	async saveSubscriptionKey(provider: KeySubscription, id: string | undefined, label: string, key?: string): Promise<SavedSubscriptionKey[]> {
		await this._serialize("save-subscription-key", async () => {
			await this._accountKeys.load();
			const known = this._accountKeys.records.find(r => r.provider === provider && (r.id === id || (!id && r.key === key?.trim())));
			if (key) {await this._checkKeyNotImported(provider, key.trim(), known && this._savedKeyFilename(known));}
			await this._accountKeys.save(provider, id, label, key);
			await this._projectConfig();
		});
		return this.listSavedKeys(provider);
	}

	/**
	 * @param provider
	 * @param id
	 */
	async revokeSubscriptionKey(provider: KeySubscription, id: string): Promise<void> {
		await this._serialize("revoke-subscription-key", async () => {
			await this._accountKeys.load();
			const entry = this._accountKeys.records.find(record => record.provider === provider && record.id === id);
			if (!entry) {throw ApiError.notFound("订阅账号不存在");}
			const filename = this._savedKeyFilename(entry);
			if ((await this._archivedAccountFiles()).has(filename)) {return;}
			await this._projectSavedAccounts();
			// Archive the current projection first. A failed revocation remains recoverable.
			const current = path.join(this._authDir, filename);
			const trashDir = path.join(this._authDir, ".trash");
			await mkdir(trashDir, { recursive: true });
			await rename(current, path.join(trashDir, String(Date.now()) + "-" + filename));
			// Keep the encrypted secret with its archived file for restoration.
			await this._projectConfig();
		});
	}

	private async _checkKeyNotImported(provider: KeySubscription, key: string, except?: string): Promise<void> {
		for (const entry of await readdir(this._authDir, { withFileTypes: true })) {
			if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === except) {continue;}
			const record: unknown = await readFile(path.join(this._authDir, entry.name), "utf8").then(raw => {
				try { return JSON.parse(raw) as unknown; } catch { return null; }
			});
			if (isRecord(record) && record["type"] === provider && record["api_key"] === key) {throw ApiError.conflict("订阅账号已存在");}
		}
	}


	/**
	 * @param provider
	 */
	async listSubscriptionModels(provider: SubscriptionProvider): Promise<string[]> {
		return this._listModelsAt("/subscriptions/" + provider + "/v1/models");
	}

	private async _listModelsAt(resource: string): Promise<string[]> {
		const response = await fetch(this.baseUrl + resource, {
			headers: { Authorization: "Bearer " + this._internalApiKey },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {throw new ApiError(response.status, "订阅模型目录请求失败: HTTP " + response.status);}
		return extractModelIds(await response.json()).sort();
	}

	private async _refreshSubscriptionCatalog(child: ChildProcessWithoutNullStreams): Promise<void> {
		if (this._catalogRefreshChild === child) {return;}
		this._catalogRefreshChild = child;
		try {
			const response = await fetch(this.baseUrl + "/_litellm/subscription-catalog", {
				headers: { Authorization: "Bearer " + this._internalApiKey },
				signal: AbortSignal.timeout(2_000),
			});
			if (!response.ok) {throw new Error(String(response.status));}
			const body: unknown = await response.json();
			if (!isRecord(body) || !Array.isArray(body["data"])) {throw new Error("invalid catalog");}
			const entries: CatalogEntry[] = [];
			for (const item of body["data"]) {
				if (!isRecord(item) || typeof item["id"] !== "string" || !Array.isArray(item["providers"]) ||
					!item["providers"].every((source: unknown) => typeof source === "string")) {continue;}
				entries.push({ id: item["id"], providers: item["providers"] as string[] });
			}
			if (this._process === child) {this.subscriptionCatalog.replace(entries);}
		} catch {
			if (this._process === child) {this._appendLog("system", "订阅模型来源目录暂不可用，将重试");}
		} finally {
			if (this._catalogRefreshChild === child) {this._catalogRefreshChild = undefined;}
		}
	}

	private _clearSubscriptionCatalog(): void {
		clearInterval(this._catalogRefresh);
		this._catalogRefresh = undefined;
		this.subscriptionCatalog.replace([]);
	}

	/**
	 * @param after
	 */
	logs(after = 0): {
		/**
		 *
		 */
		entries: CliProxyLogEntry[]; /**
		 *
		 */
		cursor: number;
	} {
		const entries = this._logs.filter((entry) => entry.id > after);
		return { entries: entries, cursor: this._logSequence };
	}

	/**
	 * 记录一条系统日志（供管理端在持久化失败等需要对外可见的场景使用）。
	 * @param message
	 */
	appendSystemLog(message: string): void {
		this._appendLog("system", message);
	}

	/**
	 * @param options
	 */
	async listAccounts(options?: { includeTrashed?: boolean }): Promise<CliProxyAccountSummary[]> {
		const files = await this._listManagedAuthFiles();
		const includeTrashed = options?.includeTrashed === true;
		return files
			.flatMap((value): CliProxyAccountSummary[] => {
				const authIndex = this._stringField(value, "auth_index", "authIndex");
				const filename = this._stringField(value, "name", "filename");
				if (!authIndex || !filename) {
					return [];
				}
				// 上游 /auth-files 会包含 .trash/ 已归档文件；默认不返回，includeTrashed 时保留
				const trashed = filename.includes("/") || filename.includes("\\");
				if (trashed && !includeTrashed) {
					return [];
				}
				const modified = value["modtime"] ?? value["modified_at"] ?? value["updated_at"];
				const date = typeof modified === "string" || typeof modified === "number" ? new Date(modified) : null;
				const weight = typeof value["weight"] === "number" ? value["weight"] : Number(value["weight"]);
				return [
					{
						auth_index: authIndex,
						filename: filename,
						provider: this._stringField(value, "type", "provider") ?? "unknown",
						email: this._stringField(value, "email"),
						disabled: value["disabled"] === true,
						weight: Number.isFinite(weight) ? weight : null,
						modified_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : new Date(0).toISOString(),
					},
				];
			})
			.sort((left, right) => left.filename.localeCompare(right.filename) || left.auth_index.localeCompare(right.auth_index));
	}

	/**
	 * 通过 CommandCode 插件的管理接口查询账户额度。
	 *
	 * 该插件的账户只来自 CPA auth 文件，额度是账号级窗口（计划/剩余 credits/5 小时、周、月），
	 * 不提供按模型的美元余额明细；插件未加载或账户不存在时返回 null 由调用方降级。
	 * @param authIndex - CPA auth 文件索引
	 */
	private async _fetchCommandCodeQuota(authIndex: string): Promise<CliProxyAccountQuota | null> {
		let payload: unknown;
		try {
			payload = await this._managementJson<unknown>(`/plugins/${COMMANDCODE_PLUGIN_ID}/quota-usage`, {
				method: "POST",
				body: JSON.stringify({ key_id: authIndex }),
			});
		} catch {
			return null;
		}
		const normalized = normalizeCliProxyCommandCodeQuota(payload, authIndex);
		if (!normalized) {
			return null;
		}
		return { provider: "commandcode", ...normalized, fetched_at: new Date().toISOString() };
	}

	private async _fetchPluginQuota(authIndex: string, provider: string): Promise<CliProxyAccountQuota | null> {
		const normalizedProvider = provider.trim().toLowerCase();
		if (PROVIDER_SPECIFIC_QUOTA.has(normalizedProvider)) {
			return null;
		}
		let described: { providers?: unknown };
		try {
			described = await this._managementJson<{ providers?: unknown }>("/quota/providers");
		} catch {
			// 旧版 CLIProxy 没有插件额度接口，继续走 provider 专用查询。
			return null;
		}
		const providers = Array.isArray(described.providers) ? described.providers.filter(isRecord) : [];
		const supported = providers.some((entry) => {
			const values = Array.isArray(entry["supported_providers"]) ? entry["supported_providers"] : [];
			return values.some((value) => typeof value === "string" && value.trim().toLowerCase() === normalizedProvider);
		});
		if (!supported) {
			return null;
		}
		let payload: unknown;
		try {
			payload = await this._managementJson<unknown>("/quota/fetch", {
				method: "POST",
				body: JSON.stringify({ auth_index: authIndex }),
			});
		} catch (error) {
			// 保留真实原因（HTTP 状态码/超时/上游正文）：只回一句"查询失败"时，
			// 用户无法判断该重试、该重新登录还是该换账号。
			throw ApiError.unavailable(`${provider} 订阅额度查询失败: ${describeQuotaFailure(error)}`);
		}
		const normalized = normalizeCliProxyPluginQuota(provider, payload);
		if (!normalized) {
			throw ApiError.unavailable(`${provider} 未返回可展示的订阅额度`);
		}
		return { provider: provider, ...normalized, fetched_at: new Date().toISOString() };
	}

	/**
	 * @param authIndexValue
	 */
	async getAccountQuota(authIndexValue: string): Promise<CliProxyAccountQuota> {
		const authIndex = authIndexValue.trim();
		if (authIndex.length === 0 || authIndex.length > 4_096) {
			throw ApiError.badRequest("CLIProxy auth_index 无效");
		}
		const authFiles = await this._listManagedAuthFiles(authIndex);
		const authFile = authFiles.find((value) => this._stringField(value, "auth_index", "authIndex") === authIndex);
		if (!authFile) {
			throw ApiError.notFound("CLIProxy OAuth 账户不存在");
		}
		const provider = this._stringField(authFile, "type", "provider") ?? "unknown";
		// CommandCode 额度只能走插件接口，不能退化到 provider 专用查询（那条路径没有它的实现）。
		if (provider.trim().toLowerCase() === "commandcode") {
			const commandCodeQuota = await this._fetchCommandCodeQuota(authIndex);
			if (commandCodeQuota) {
				return commandCodeQuota;
			}
			throw ApiError.unavailable("CommandCode 额度不可用：插件未加载或账户不存在");
		}
		const pluginQuota = await this._fetchPluginQuota(authIndex, provider);
		if (pluginQuota) {
			return pluginQuota;
		}
		const requests = buildCliProxyQuotaRequests(provider, authFile);
		const payloads: Array<{
			/**
			 *
			 */
			id: string; /**
			 *
			 */
			body: unknown;
		}> = [];
		const successfulFallbackGroups = new Set<string>();
		for (const request of requests) {
			if (request.fallback_group && successfulFallbackGroups.has(request.fallback_group)) {
				continue;
			}
			try {
				const body = await this._quotaApiCall(authIndex, provider, request);
				payloads.push({ id: request.id, body: body });
				if (request.fallback_group) {
					successfulFallbackGroups.add(request.fallback_group);
				}
			} catch (error) {
				const optional = request.id === "profile" || provider.toLowerCase() === "xai" || request.fallback_group !== undefined;
				if (!optional) {
					throw error;
				}
			}
		}
		return normalizeCliProxyQuota(provider, payloads, authFile);
	}

	/**
	 * @param filenameValue
	 * @param patch
	 */
	async updateAccount(
		filenameValue: string,
		patch: {
			/**
			 *
			 */
			disabled?: boolean; /**
			 *
			 */
			weight?: number | null;
		},
	): Promise<void> {
		const filename = safeAccountFilename(filenameValue);
		const filePath = path.join(this._authDir, filename);
		const value = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
		if (patch.disabled !== undefined) {
			value["disabled"] = patch.disabled;
		}
		if (patch.weight === null) {
			delete value["weight"];
		} else if (patch.weight !== undefined) {
			if (!Number.isInteger(patch.weight) || patch.weight <= 0 || patch.weight > 1_000_000) {
				throw ApiError.badRequest("账户权重必须是 1 到 1000000 之间的整数");
			}
			value["weight"] = patch.weight;
		}
		const temporary = `${filePath}.${randomUUID()}.tmp`;
		await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
		await rename(temporary, filePath);
		this._appendLog("system", `OAuth 账户 ${filename} 已更新`);
	}

	/**
	 * @param filenameValue
	 */
	async trashAccount(filenameValue: string): Promise<void> {
		const filename = safeAccountFilename(filenameValue);
		const trashDir = path.join(this._authDir, ".trash");
		await mkdir(trashDir, { recursive: true });
		await rename(path.join(this._authDir, filename), path.join(trashDir, `${Date.now()}-${filename}`));
		if (this._accountKeys.records.some(record => this._savedKeyFilename(record) === filename)) {await this._serialize("archive-key", () => this._projectConfig());}
		this._appendLog("system", `OAuth 账户 ${filename} 已移入 .trash`);
	}

	/**
	 * 恢复 .trash 中的账户文件回 auths/ 根目录。
	 * 输入 filename 形如 `.trash/1786846264579-codex-foo.json`（trashAccount 写入时的格式），
	 * 去掉 `.trash/` 前缀与时间戳前缀还原为原始文件名。
	 * @param filenameValue - trash 中的相对路径
	 */
	async restoreAccount(filenameValue: string): Promise<void> {
		if (!filenameValue.startsWith(".trash/") || filenameValue.includes("\0")) {
			throw ApiError.badRequest("仅支持恢复 .trash/ 下的账户文件");
		}
		const trashName = filenameValue.slice(".trash/".length);
		const filename = safeAccountFilename(trashName);
		// trashAccount 写入时的文件名格式为 `${Date.now()}-${originalName}`
		const originalName = filename.replace(/^\d+-/, "");
		if (originalName.length === 0) {
			throw ApiError.badRequest("无法从 trash 文件名解析原始账户名");
		}
		const sourcePath = path.join(this._authDir, ".trash", filename);
		const targetPath = path.join(this._authDir, originalName);
		try {
			// Never replace an already-active account when restoring an older archive.
			await link(sourcePath, targetPath);
			await unlink(sourcePath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				throw ApiError.conflict("同名账号已在使用");
			}
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw ApiError.notFound(`trash 中的账户文件不存在: ${filename}`);
			}
			throw error;
		}
		if (this._accountKeys.records.some(record => this._savedKeyFilename(record) === originalName)) {await this._serialize("restore-key", () => this._projectConfig());}
		this._appendLog("system", `OAuth 账户 ${filename} 已恢复为 ${originalName}`);
	}

	/**
	 * @param provider
	 */
	async startOAuth(provider: CliProxyOAuthProvider): Promise<CliProxyOAuthSession> {
		const flagMap: Record<CliProxyOAuthProvider, string> = {
			"codex-device": "-codex-device-login",
			codex: "-codex-login",
			claude: "-claude-login",
			antigravity: "-antigravity-login",
			kimi: "-kimi-login",
			xai: "-xai-login",
		};
		const binary = this._subscriptionBinary;
		await access(binary, constants.X_OK).catch(() => {
			this._binaryAvailable = false;
			throw ApiError.unavailable("订阅运行时可执行文件未安装");
		});
		this._binaryAvailable = true;
		const id = randomUUID();
		const args = [flagMap[provider], "-no-browser", "-config", this._configPath];
		const child = spawn(binary, args, { cwd: this._runtimeRoot, stdio: ["pipe", "pipe", "pipe"] });
		const snapshot: CliProxyOAuthSession = {
			id: id,
			provider: provider,
			state: "running",
			started_at: new Date().toISOString(),
			finished_at: null,
			exit_code: null,
			output: [],
		};
		this._pruneOAuthSessions();
		if (this._oauthSessions.size >= MAX_OAUTH_SESSIONS) {
			// 全部会话都在进行中（等待用户输入）且已达上限时，拒绝新增，避免进程/管道/内存无限增长。
			child.kill("SIGKILL");
			throw ApiError.conflict("OAuth 会话数量已达上限，请先结束部分进行中的登录");
		}
		this._oauthSessions.set(id, { snapshot: snapshot, process: child });
		const receive = (chunk: Buffer): void => {
			for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
				const current = this._oauthSessions.get(id);
				if (!current) {
					continue;
				}
				const output = [...current.snapshot.output, line].slice(-MAX_OAUTH_OUTPUT_LINES);
				current.snapshot = { ...current.snapshot, output: output };
				this._appendLog("oauth", `[${provider}] ${line}`);
			}
		};
		child.stdout.on("data", receive);
		child.stderr.on("data", receive);
		// 子进程退出后 stdin 管道即关闭，此后的写入会触发 error 事件；没有监听器会导致未捕获异常。
		child.stdin.on("error", () => {
			// 忽略：会话终态由 exit 事件推进。
		});
		child.once("exit", (code) => {
			const current = this._oauthSessions.get(id);
			if (!current) {
				return;
			}
			current.snapshot = {
				...current.snapshot,
				state: code === 0 ? "succeeded" : "failed",
				exit_code: code,
				finished_at: new Date().toISOString(),
			};
			// 不在退出时裁剪：刚结束的会话需保留终态供前端轮询读取；裁剪只在新增会话时进行。
		});
		return snapshot;
	}

	/**
	 * 裁剪已结束的 OAuth 会话，防止无限增长；仅删非 running 的最旧条目，保留终态供前端读取。
	 */
	private _pruneOAuthSessions(): void {
		while (this._oauthSessions.size >= MAX_OAUTH_SESSIONS) {
			const oldestFinished = [...this._oauthSessions.entries()].find(([, entry]) => entry.snapshot.state !== "running");
			if (!oldestFinished) {
				break;
			}
			this._oauthSessions.delete(oldestFinished[0]);
		}
	}

	/**
	 * @param id
	 */
	getOAuthSession(id: string): CliProxyOAuthSession {
		const session = this._oauthSessions.get(id);
		if (!session) {
			throw new ApiError(404, "OAuth 登录会话不存在");
		}
		return session.snapshot;
	}

	/**
	 * @param id
	 * @param input
	 */
	sendOAuthInput(id: string, input: string): CliProxyOAuthSession {
		const session = this._oauthSessions.get(id);
		if (!session || session.snapshot.state !== "running") {
			throw ApiError.badRequest("OAuth 登录会话当前不可输入");
		}
		const stdin = session.process.stdin;
		// 进程已在 OS 层退出但 exit 事件尚未派发时，state 仍为 running；此时管道已关闭，写入会触发 error。
		if (stdin.destroyed || !stdin.writable) {
			throw ApiError.conflict("OAuth 登录会话已结束，无法输入");
		}
		stdin.write(`${input}\n`);
		return session.snapshot;
	}

	private async _importExistingOrDefaultSettings(): Promise<CliProxyStoredSettings> {
		try {
			const source = await readFile(this._configPath, "utf8");
			const parsed = yaml.load(source);
			if (isRecord(parsed)) {
				const imported = sanitizeImportedConfig(parsed);
				this._appendLog("system", "已从现有 CLIProxy config.yaml 导入配置");
				return { enabled: true, config_yaml: yaml.dump(imported, { noRefs: true, lineWidth: 120, sortKeys: true }) };
			}
		} catch {
			// First install has no existing config.
		}
		return {
			enabled: true,
			config_yaml: yaml.dump(
				{
					debug: false,
					"commercial-mode": false,
					"usage-statistics-enabled": true,
					"request-retry": 3,
					"max-retry-interval": 30,
					routing: { strategy: "round-robin", "session-affinity": true, "session-affinity-ttl": "1h" },
					"ws-auth": true,
				},
				{ noRefs: true, lineWidth: 120, sortKeys: true },
			),
		};
	}

	private _hasPluginCredential(userConfig: Record<string, unknown>): boolean {
		if ((process.env["OPENCODE_GO_API_KEY"] ?? "").trim() !== "") {
			return true;
		}
		const plugins = isRecord(userConfig["plugins"]) ? userConfig["plugins"] : null;
		const configs = plugins && isRecord(plugins["configs"]) ? plugins["configs"] : null;
		const entry = configs && isRecord(configs[OPENCODE_GO_PLUGIN_ID]) ? configs[OPENCODE_GO_PLUGIN_ID] : null;
		const keys = entry?.["api-keys"];
		return Array.isArray(keys) && keys.length > 0;
	}

	private async _saveCommandCodeAccountEntries(userConfig: Record<string, unknown>, entries: Record<string, unknown>[]): Promise<void> {
		setCommandCodeAccountEntries(userConfig, entries);
		await this.saveSettings({
			enabled: this._settings.enabled,
			config_yaml: serializeCliProxyUserConfig(userConfig),
		});
	}

	private async _syncManagedCommandCodeAccounts(userConfig: Record<string, unknown>): Promise<void> {

		const prefix = "commandcode-managed-";
		let existing: string[] = [];
		try {
			existing = (await readdir(this._authDir)).filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
		} catch {
			existing = [];
		}
		const archived = await this._archivedAccountFiles();
		const desired = new Map<string, ManagedCommandCodeAccount>();
		for (const account of extractManagedCommandCodeAccounts(userConfig)) {
			desired.set(commandCodeAccountFilename(account.apiKey), account);
		}
		await Promise.all(
			existing.filter((name) => !desired.has(name)).map((name) => unlink(path.join(this._authDir, name)).catch(() => undefined)),
		);
		for (const [filename, account] of desired) {
			if (archived.has(filename) && !existing.includes(filename)) {
				continue;
			}
			const targetPath = path.join(this._authDir, filename);
			let current: Record<string, unknown> | null = null;
			try {
				const parsed = JSON.parse(await readFile(targetPath, "utf8")) as unknown;
				if (isRecord(parsed)) {
					current = parsed;
				}
			} catch {
				current = null;
			}
			// 保留用户在 UI 上设置的 disabled/weight 等非密钥字段。
			if (current?.["type"] === "commandcode" && current["api_key"] === account.apiKey && current["label"] === account.label) {
				continue;
			}
			const payload = { ...(current ?? {}), type: "commandcode", api_key: account.apiKey, label: account.label };
			const temporary = path.join(this._authDir, `.${filename}.${randomUUID()}.tmp`);
			await writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
			await rename(temporary, targetPath);
		}
	}

	private _savedKeyFilename(entry: SavedSubscriptionKey): string {
		return "subscription-" + entry.provider + "-" + entry.id + ".json";
	}

	private async _archivedAccountFiles(): Promise<Set<string>> {
		const names = await readdir(path.join(this._authDir, ".trash")).catch((e: NodeJS.ErrnoException) => {
			if (e.code === "ENOENT") {return [];}
			throw e;
		});
		return new Set(names.map(name => name.replace(/^\d+-/, "")));
	}

	private async _projectSavedAccounts(): Promise<{ value: string; name: string }[]> {
		if (this._accountKeys.records.length === 0) {return [];}
		const archived = await this._archivedAccountFiles();
		const openCodeKeys: { value: string; name: string }[] = [];
		for (const record of this._accountKeys.records) {
			const filename = this._savedKeyFilename(record);
			const file = path.join(this._authDir, filename);
			const contents = await readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
				if (err.code === "ENOENT") {return null;}
				throw err;
			});
			if (!contents && archived.has(filename)) {continue;}
			const previous: unknown = contents === null ? {} : JSON.parse(contents);
			if (!isRecord(previous)) {throw ApiError.unavailable("订阅账号文件无效");}
			if (previous["api_key"] !== record.key || previous["label"] !== record.label || previous["type"] !== record.provider) {
				const next: Record<string, unknown> = { ...previous, type: record.provider, api_key: record.key, label: record.label };
				if (record.provider === "opencode-go") {next["id"] = "opencode-go-key-" + createHash("sha256").update(record.key).digest("hex");}
				const tmp = path.join(this._authDir, "." + filename + "." + randomUUID() + ".tmp");
				await writeFile(tmp, JSON.stringify(next), { mode: 0o600 });
				await rename(tmp, file);
			}
			if (record.provider === "opencode-go") {openCodeKeys.push({ value: record.key, name: record.label });}
		}
		return openCodeKeys;
	}


	private async _projectConfig(): Promise<void> {
		const userConfig = parseCliProxyUserConfig(this._settings.config_yaml);
		const nativeKeys = await this._projectSavedAccounts();
		if (nativeKeys.length > 0) {
			const plugins = isRecord(userConfig["plugins"]) ? userConfig["plugins"] : {};
			const configs = isRecord(plugins["configs"]) ? plugins["configs"] : {};
			const entry = isRecord(configs[OPENCODE_GO_PLUGIN_ID]) ? configs[OPENCODE_GO_PLUGIN_ID] : {};
			const configured = Array.isArray(entry["api-keys"]) ? entry["api-keys"] : process.env["OPENCODE_GO_API_KEY"] ? [{ value: OPENCODE_GO_ENV_REFERENCE, name: "Personal" }] : [];
			userConfig["plugins"] = { ...plugins, configs: { ...configs, [OPENCODE_GO_PLUGIN_ID]: { ...entry, "api-keys": [...configured, ...nativeKeys] } } };
		}
		await this._syncManagedCommandCodeAccounts(userConfig);
		const plugins = { dir: this._pluginDir, opencodeGo: this._hasPluginCredential(userConfig), commandcode: true };
		this._plugins = plugins;
		const projected = buildCliProxyProjection(userConfig, {
			port: this._port,
			authDir: this._authDir,
			internalApiKey: this._internalApiKey,
			plugins: plugins,
		});
		const contents = `# Generated by LiteLLM TS. Edit through the LiteLLM CLIProxy page.\n${yaml.dump(projected, {
			noRefs: true,
			lineWidth: 120,
			sortKeys: true,
		})}`;
		const handle = await open(this._configPath, "w", 0o600);
		try {
			await handle.writeFile(contents, "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		this._configHash = createHash("sha256").update(contents).digest("hex");
	}

	private _stringField(value: Record<string, unknown>, ...keys: string[]): string | null {
		for (const key of keys) {
			const candidate = value[key];
			if (typeof candidate === "string" && candidate.trim().length > 0) {
				return candidate.trim();
			}
		}
		return null;
	}

	private async _managementJson<T>(resource: string, init?: RequestInit): Promise<T> {
		const response = await this.managementRequest(resource, init);
		if (!response.ok) {
			throw new ApiError(response.status, `CLIProxy 内部管理请求失败: HTTP ${response.status}`);
		}
		try {
			return (await response.json()) as T;
		} catch {
			throw ApiError.unavailable("CLIProxy 内部管理响应无效");
		}
	}

	/**
	 * Execute an authenticated request against the loopback-only CLIProxy
	 * management API. Public callers must apply their own route allowlist and
	 * LiteLLM proxy-admin authorization before using the response.
	 * @param resource
	 * @param init
	 */
	async managementRequest(resource: string, init?: RequestInit): Promise<globalThis.Response> {
		if (!resource.startsWith("/") || resource.includes("..") || resource.includes("\0")) {
			throw ApiError.badRequest("CLIProxy 管理资源路径无效");
		}
		const headers = new Headers(init?.headers);
		headers.set("Authorization", `Bearer ${this._internalManagementKey}`);
		if (init?.body && !headers.has("Content-Type")) {
			headers.set("Content-Type", "application/json");
		}
		return await fetch(`${this.baseUrl}/v0/management${resource}`, {
			...init,
			headers: headers,
			signal: AbortSignal.timeout(15_000),
		});
	}

	/**
	 * Import config-backed changes made through a CLIProxy management handler
	 * into LiteLLM's DB-owned user configuration, then regenerate the managed
	 * runtime projection.
	 * @param removedPlugin
	 */
	async persistManagementConfig(removedPlugin?: string): Promise<void> {
		const response = await this.managementRequest("/config.yaml");
		if (!response.ok) {
			throw new ApiError(response.status, `CLIProxy 配置同步失败: HTTP ${response.status}`);
		}
		const parsed = yaml.load(await response.text());
		if (!isRecord(parsed)) {
			throw ApiError.unavailable("CLIProxy 配置同步响应无效");
		}
		const userConfig = sanitizeImportedConfig(parsed);
		// Native keys belong to the sealed key store; do not copy its projection to user YAML.
		const plugins = isRecord(userConfig["plugins"]) ? userConfig["plugins"] : {};
		const configs = isRecord(plugins["configs"]) ? plugins["configs"] : {};
		if (removedPlugin === OPENCODE_GO_PLUGIN_ID || removedPlugin === COMMANDCODE_PLUGIN_ID) {
			// Built-ins can be loaded without a file. Preserve an operator's explicit uninstall across projections.
			configs[removedPlugin] = { enabled: false };
			plugins["configs"] = configs;
			userConfig["plugins"] = plugins;
		}
		this.omitSavedPluginKeys(configs[OPENCODE_GO_PLUGIN_ID]);
		const managed = commandCodeAccountEntries(this.userConfig);
		if (managed.length) {setCommandCodeAccountEntries(userConfig, managed);}
		await this.saveSettings({
			enabled: this._settings.enabled,
			config_yaml: yaml.dump(userConfig, { noRefs: true, lineWidth: 120, sortKeys: false }),
		});
	}

	/**
	 * Removes projected account secrets from legacy editable plugin configuration.
	 * @param config - OpenCode Go's editable plugin object.
	 */
	omitSavedPluginKeys(config: unknown): void {
		if (!isRecord(config) || !Array.isArray(config["api-keys"])) {return;}
		const keys = new Set(this._accountKeys.records.filter(record => record.provider === "opencode-go").map(record => record.key));
		config["api-keys"] = config["api-keys"].filter(item => !keys.has(String(isRecord(item) ? item["value"] : item)));
	}

	private async _listManagedAuthFiles(authIndex?: string): Promise<Record<string, unknown>[]> {
		const query = authIndex ? `?auth_index=${encodeURIComponent(authIndex)}` : "";
		const body = await this._managementJson<{
			/**
			 *
			 */
			files?: unknown;
		}>(`/auth-files${query}`);
		return Array.isArray(body.files) ? body.files.filter(isRecord) : [];
	}

	private async _quotaApiCall(authIndex: string, provider: string, request: CliProxyQuotaRequest): Promise<unknown> {
		const result = await this._managementJson<{
			/**
			 *
			 */
			status_code?: unknown; /**
			 *
			 */
			body?: unknown;
		}>("/api-call", {
			method: "POST",
			body: JSON.stringify({
				auth_index: authIndex,
				method: request.method,
				url: request.url,
				header: request.header,
				...(request.data === undefined ? {} : { data: request.data }),
			}),
		});
		const status = typeof result.status_code === "number" ? result.status_code : Number(result.status_code);
		if (!Number.isInteger(status) || status < 200 || status >= 300) {
			throw ApiError.unavailable(`${provider} 订阅额度查询失败: HTTP ${Number.isInteger(status) ? status : "unknown"}`);
		}
		if (typeof result.body === "string") {
			try {
				return JSON.parse(result.body) as unknown;
			} catch {
				throw ApiError.unavailable(`${provider} 订阅额度响应无效`);
			}
		}
		if (result.body === undefined || result.body === null) {
			throw ApiError.unavailable(`${provider} 订阅额度响应为空`);
		}
		return result.body;
	}

	/**
	 * 启动子进程并等待健康检查。
	 * @param respectStopIntent - 为 true 时，把停机意图当成放弃启动的理由；供后台预热使用，
	 * 使「检查停止意图」与「spawn」落在同一段同步代码里，停机期间不会被预热重新拉起。
	 */
	private async _startProcess(respectStopIntent = false): Promise<void> {
		if (this._process) {
			return;
		}
		if (!this._settings.enabled) {
			this._state = "stopped";
			return;
		}
		const binary = this._subscriptionBinary;
		await access(binary, constants.X_OK).catch(() => {
			this._binaryAvailable = false;
			throw ApiError.unavailable("订阅运行时可执行文件未安装");
		});
		this._binaryAvailable = true;
		if (respectStopIntent && this._desiredStop) {
			this._state = "stopped";
			return;
		}
		this._desiredStop = false;
		this._state = "starting";
		this._health = "unknown";
		this._appendLog("system", `启动订阅运行时 ${this._runtimeVersion}`);
		const child = spawn(binary, ["-config", this._configPath], {
			cwd: this._runtimeRoot,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, HOME: this._runtimeRoot, MANAGEMENT_PASSWORD: this._internalManagementKey },
		});
		this._process = child;
		this._startedAt = new Date();
		child.stdout.on("data", (chunk: Buffer) => this._consumeProcessLog("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => this._consumeProcessLog("stderr", chunk));
		child.once("error", (error) => {
			this._lastError = error.message;
			this._appendLog("system", `CLIProxy 启动错误: ${error.message}`);
		});
		child.once("exit", (code) => {
			if (this._process !== child) {
				return;
			}
			this._process = null;
			this._clearSubscriptionCatalog();
			this._lastExitCode = code;
			this._startedAt = null;
			this._health = "unhealthy";
			if (this._desiredStop || !this._settings.enabled) {
				this._state = "stopped";
				this._appendLog("system", `CLIProxy 已停止，退出码 ${String(code)}`);
				return;
			}
			this._restartCount += 1;
			this._state = this._restartCount >= 5 ? "crash_loop" : "degraded";
			const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this._restartCount, 5));
			this._appendLog("system", `CLIProxy 异常退出，${delay / 1000} 秒后重启`);
			this._restartTimer = setTimeout(() => {
				this._restartTimer = null;
				void this._serialize("restart", async () => {
					await this._startProcess();
				}).catch((error: unknown) => {
					this._lastError = error instanceof Error ? error.message : String(error);
				});
			}, delay);
		});
		if (!(await this._waitForHealth(HEALTH_TIMEOUT_MS))) {
			if (this._desiredStop) {
				// 健康等待是被停机意图打断的，不要覆盖 shutdown 已经写好的 stopped 状态。
				this._state = "stopped";
				return;
			}
			// 子进程仍在运行且已被受管（exit handler 已挂载），不抛错、不失控；
			// 保持 degraded 状态让 status() 如实反映，用户可 restart() 重试。
			this._state = "degraded";
			this._health = "unhealthy";
			this._lastError = "CLIProxy 启动后健康检查超时";
			return;
		}
		// /healthz 只代表 HTTP 服务已经在听。托管插件是在 listen 之后才把模型注册进目录的，
		// 这期间带插件前缀的模型会被判成 unknown provider，请求只能先吃一次 400 再走 fallback。
		// 等模型目录出现这些前缀再宣布 running；超时只记日志、不阻断启动，未就绪时仍由 fallback 兜底。
		const catalog = await waitForModelCatalog({
			prefixes: expectedModelPrefixes(this._plugins),
			fetchModelIds: async () => await this._fetchModelIds(),
			isAborted: () => this._desiredStop || this._process === null,
			timeoutMs: MODEL_CATALOG_TIMEOUT_MS,
		});
		if (catalog.aborted) {
			if (this._desiredStop) {
				// 停机意图落在模型目录等待期间：与健康等待一致，不覆盖 shutdown 已经写好的状态。
				this._state = "stopped";
			}
			return;
		}
		if (catalog.missing.length > 0) {
			this._appendLog(
				"system",
				`CLIProxy 模型目录 ${MODEL_CATALOG_TIMEOUT_MS}ms 内未就绪（缺少 ${catalog.missing.join("、")}），先恢复运行；命中未就绪模型的请求由 fallback 兜底`,
			);
		} else if (catalog.waitedMs >= 200) {
			this._appendLog("system", `CLIProxy 模型目录就绪（健康后等待 ${catalog.waitedMs}ms）`);
		}
		await this._refreshSubscriptionCatalog(child);
		if (this._process !== child || this._desiredStop) {return;}
		this._catalogRefresh = setInterval(() => void this._refreshSubscriptionCatalog(child), 30_000);
		this._catalogRefresh.unref();
		this._state = "running";
		this._health = "healthy";
		this._restartCount = 0;
	}

	/**
	 * 命令性操作（start/restart/update/rollback）后断言进程已 running；
	 * _startProcess 在健康检查超时返回 degraded 而不抛错，此处把失败如实上报给调用方。
	 */
	private _assertRunning(): void {
		if (this._state !== "running") {
			throw ApiError.unavailable(this._lastError ?? "CLIProxy 健康检查未通过");
		}
	}

	private async _stopProcess(): Promise<void> {
		if (this._restartTimer) {
			clearTimeout(this._restartTimer);
			this._restartTimer = null;
		}
		const child = this._process;
		if (!child) {
			this._state = "stopped";
			return;
		}
		this._state = "stopping";
		this._desiredStop = true;
		// The next engine must not open a rotating token while its previous
		// owner can still write it. A timeout escalates the signal, not ownership.
		if (child.exitCode === null && child.signalCode === null) {
			await new Promise<void>((resolve, reject) => {
				const force = setTimeout(() => child.kill("SIGKILL"), STOP_TIMEOUT_MS);
				const deadline = setTimeout(() => {
					child.off("close", closed);
					reject(ApiError.unavailable("旧订阅进程尚未退出，未启动新的凭据写入进程"));
				}, STOP_TIMEOUT_MS + 5_000);
				const closed = (): void => {
					clearTimeout(force);
					clearTimeout(deadline);
					resolve();
				};
				child.once("close", closed);
				child.kill("SIGTERM");
			});
		}
		if (this._process === child) {
			this._process = null;
			this._clearSubscriptionCatalog();
		}
		this._startedAt = null;
		this._state = "stopped";
		this._health = "unknown";
	}

	private async _restartProcess(): Promise<void> {
		// 重启会掐断在途 SSE：先降级（新请求走 fallback）并等旧请求写完，再换进程。
		// 进程本来就不在运行时没有可排空的流，timeoutMs=0 直接重启，避免崩溃恢复被拖慢。
		await withCliProxyDrain(
			async () => {
				this._desiredStop = true;
				await this._stopProcess();
				this._desiredStop = false;
				this._restartCount += 1;
				await this._startProcess();
			},
			{
				probe: () => this._activeRequestProbe(),
				timeoutMs: this._process === null ? 0 : resolveCliProxyDrainTimeoutMs(),
				onStart: (inFlight) =>
					this._appendLog("system", `CLIProxy 进入降级：新请求改走 fallback，在途 ${inFlight} 个`),
				onSettled: (result) => {
					this._appendLog(
						"system",
						result.idle
							? `CLIProxy 排空完成（${result.waitedMs}ms），开始重启`
							: `CLIProxy 排空超时（${result.timeoutMs}ms），仍有 ${result.remaining} 个在途请求；继续重启，被截断的流由 Router fallback 兜底`,
					);
				},
			},
		);
		this._appendLog("system", "CLIProxy 已退出降级，恢复流量");
	}

	private async _waitForHealth(timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			// 停机意图已下发或子进程已经退出时没有可等的东西：继续轮询只会让后台预热
			// 拖住退出，而且这个端口不会再健康。
			if (this._desiredStop || this._process === null) {
				this._health = "unhealthy";
				return false;
			}
			try {
				const response = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(1_500) });
				if (response.ok) {
					this._health = "healthy";
					return true;
				}
			} catch {
				// Still starting.
			}
			await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS));
		}
		this._health = "unhealthy";
		return false;
	}

	/**
	 * 读取 CPA 当前可解析的模型 id 列表（`/v1/models`）。
	 *
	 * 用内部 API key 鉴权；任何非 2xx 或解析失败都按「还没就绪」返回空列表，
	 * 由 {@link waitForModelCatalog} 继续轮询到上限。
	 * @returns 模型 id 列表
	 */
	private async _fetchModelIds(): Promise<string[]> {
		const response = await fetch(`${this.baseUrl}/v1/models`, {
			headers: { Authorization: `Bearer ${this._internalApiKey}` },
			signal: AbortSignal.timeout(1_500),
		});
		if (!response.ok) {
			return [];
		}
		return extractModelIds(await response.json().catch(() => null));
	}

	private _consumeProcessLog(stream: "stdout" | "stderr", chunk: Buffer): void {
		for (const line of chunk.toString("utf8").split(/\r?\n/).filter(Boolean)) {
			this._appendLog(stream, line);
		}
	}

	private _appendLog(stream: CliProxyLogEntry["stream"], message: string): void {
		this._logSequence += 1;
		this._logs.push({
			id: this._logSequence,
			timestamp: new Date().toISOString(),
			stream: stream,
			message: message,
		});
		if (this._logs.length > MAX_LOG_ENTRIES) {
			this._logs.splice(0, this._logs.length - MAX_LOG_ENTRIES);
		}
	}

	private async _serialize(operation: string, action: () => Promise<void>): Promise<void> {
		let resolveCurrent!: () => void;
		const previous = this._operationTail;
		this._operationTail = new Promise<void>((resolve) => {
			resolveCurrent = resolve;
		});
		await previous;
		this._operation = operation;
		try {
			await action();
		} catch (error) {
			this._lastError = error instanceof Error ? error.message : String(error);
			throw error;
		} finally {
			this._operation = null;
			resolveCurrent();
		}
	}
}
