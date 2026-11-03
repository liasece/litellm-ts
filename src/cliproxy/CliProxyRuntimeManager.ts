/* eslint-disable jsdoc/check-alignment, jsdoc/require-throws */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, readdirSync, readlinkSync } from "node:fs";
import { access, chmod, copyFile, mkdir, open, readdir, readFile, readlink, rename, symlink, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { Readable } from "node:stream";
import yaml from "js-yaml";
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
	type CliProxyReleaseInfo,
	type CliProxyRuntimeStatus,
	type CliProxyStoredSettings,
	type CliProxyUpdateInfo,
} from "./CliProxyTypes";
import {
	buildCliProxyQuotaRequests,
	normalizeCliProxyCommandCodeQuota,
	normalizeCliProxyPluginQuota,
	normalizeCliProxyQuota,
	type CliProxyQuotaRequest,
} from "./CliProxyQuota";

const MAX_LOG_ENTRIES = 4_000;
const MAX_OAUTH_OUTPUT_LINES = 500;
const STOP_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 15_000;
const MAX_OAUTH_SESSIONS = 32;
const RELEASE_REPOSITORY = "router-for-me/CLIProxyAPI";
const RESERVED_CONFIG_KEYS = new Set(["host", "port", "auth-dir", "api-keys", "remote-management"]);
const OPENCODE_GO_PLUGIN_ID = "opencode-go-cliproxyapi";
const OPENCODE_GO_PLUGIN_MIN_VERSION = "8.0.0";
const OPENCODE_GO_PLUGIN_BASE_URL = "https://opencode.ai/inference/go/v1";
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
 * Compare normalized CLIProxy release versions.
 * @param left
 * @param right
 */
export function compareCliProxyVersions(left: string | null, right: string | null): number | null {
	if (!left || !right) {
		return null;
	}
	const parse = (value: string): { core: number[]; prerelease: string[] | null } => {
		const normalized = normalizeVersion(value);
		const [versionAndPrerelease] = normalized.split("+", 1);
		const [coreValue, prereleaseValue] = versionAndPrerelease!.split("-", 2);
		return {
			core: coreValue!.split(".").map((segment) => Number(segment)),
			prerelease: prereleaseValue ? prereleaseValue.split(".") : null,
		};
	};
	const leftVersion = parse(left);
	const rightVersion = parse(right);
	const length = Math.max(leftVersion.core.length, rightVersion.core.length);
	for (let index = 0; index < length; index += 1) {
		const leftPart = leftVersion.core[index] ?? 0;
		const rightPart = rightVersion.core[index] ?? 0;
		if (leftPart !== rightPart) {
			return leftPart > rightPart ? 1 : -1;
		}
	}
	if (leftVersion.prerelease === null && rightVersion.prerelease === null) {
		return 0;
	}
	if (leftVersion.prerelease === null) {
		return 1;
	}
	if (rightVersion.prerelease === null) {
		return -1;
	}
	const prereleaseLength = Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length);
	for (let index = 0; index < prereleaseLength; index += 1) {
		const leftPart = leftVersion.prerelease[index];
		const rightPart = rightVersion.prerelease[index];
		if (leftPart === undefined) {
			return -1;
		}
		if (rightPart === undefined) {
			return 1;
		}
		if (leftPart === rightPart) {
			continue;
		}
		const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null;
		const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null;
		if (leftNumber !== null && rightNumber !== null) {
			return leftNumber > rightNumber ? 1 : -1;
		}
		if (leftNumber !== null) {
			return -1;
		}
		if (rightNumber !== null) {
			return 1;
		}
		return leftPart.localeCompare(rightPart) > 0 ? 1 : -1;
	}
	return 0;
}

/**
 * Prefer the concise changelog portion of GitHub release notes. CLIProxy also
 * repeats platform asset documentation in every release, which does not
 * describe what changed in that version.
 * @param source
 */
export function extractCliProxyReleaseNotes(source: string): string {
	const cleaned = source.replace(/<!--[\s\S]*?-->/g, "").trim();
	if (!cleaned) {
		return "";
	}
	const headings = [...cleaned.matchAll(/^##\s+(.+?)\s*$/gm)];
	for (const title of ["changelog", "what's changed"]) {
		const headingIndex = headings.findIndex((heading) => heading[1]?.trim().toLowerCase() === title);
		if (headingIndex < 0) {
			continue;
		}
		const heading = headings[headingIndex]!;
		const start = (heading.index ?? 0) + heading[0].length;
		const end = headings[headingIndex + 1]?.index ?? cleaned.length;
		const section = cleaned.slice(start, end).trim();
		if (section) {
			return section;
		}
	}
	return cleaned;
}

/** GitHub 未认证 REST 配额：每小时 60 次，按出口 IP 共享，耗尽后返回 403。 */
const GITHUB_ANONYMOUS_HOURLY_LIMIT = 60;

/**
 * 版本检查结果缓存时长。
 *
 * 每次打开 CLIProxy 页面都会预取一次最新版本，而 GitHub 未认证配额按出口 IP 共享，
 * 没有缓存时多开几个页面就会耗尽额度。手动检查通过 refresh 绕过缓存。
 */
const UPDATE_CHECK_CACHE_TTL_MS = 5 * 60_000;

/** checkLatestVersion 的调用意图。 */
export interface CliProxyUpdateCheckOptions {
	/** 手动操作（Check 按钮、安装/回滚后的复核）绕过缓存，直接请求 GitHub 并刷新缓存。 */
	readonly refresh?: boolean;
}

interface CliProxyReleaseCache {
	readonly fetchedAt: number;
	readonly releases: readonly CliProxyReleaseInfo[];
}

const EMPTY_RELEASE_MESSAGE = "GitHub 上没有可用的正式版 CLIProxy release";

/**
 * 识别 GitHub 的限流响应，避免把 403 限流当成普通的网关故障。
 * @param response - GitHub 响应
 * @param bodyText - 已读取的响应正文，用于识别 403 的限流文案
 */
function isGitHubRateLimited(response: Response, bodyText: string): boolean {
	if (response.status === 429) {
		return true;
	}
	if (response.status !== 403) {
		return false;
	}
	return response.headers.get("x-ratelimit-remaining") === "0" || /rate limit/i.test(bodyText);
}

/**
 * 按 x-ratelimit-reset 说明配额何时恢复。
 * @param response - GitHub 响应
 */
function describeRateLimitReset(response: Response): string {
	const header = response.headers.get("x-ratelimit-reset");
	if (!header || !/^\d+$/.test(header)) {
		return "请稍后重试";
	}
	const waitSeconds = Number(header) - Math.floor(Date.now() / 1000);
	if (waitSeconds <= 0) {
		return "现在可以重试";
	}
	return `约 ${Math.max(1, Math.ceil(waitSeconds / 60))} 分钟后恢复`;
}

/**
 * 把 GitHub 的非成功响应翻译成可执行说明：限流要说清原因和恢复时间，其余要给状态码。
 * @param response - GitHub 响应
 * @param bodyText - 已读取的响应正文
 */
function cliProxyReleaseResponseError(response: Response, bodyText: string): ApiError {
	if (isGitHubRateLimited(response, bodyText)) {
		return new ApiError(
			502,
			`GitHub API 限流：这台服务器与其它服务共用出口 IP，每小时 ${GITHUB_ANONYMOUS_HOURLY_LIMIT} 次未认证请求额度已用完，${describeRateLimitReset(response)}。请稍后重试。`,
			"rate_limit_exceeded",
		);
	}
	return new ApiError(502, `GitHub 返回 HTTP ${response.status}，暂时无法获取 CLIProxy 版本列表，请稍后重试`);
}

/**
 * 把 fetch 的连接层失败翻译成可执行说明，避免只抛出 "fetch failed"。
 * @param error - fetch 抛出的异常
 */
function cliProxyReleaseFetchError(error: unknown): ApiError {
	const name = isRecord(error) ? error["name"] : undefined;
	if (name === "TimeoutError" || name === "AbortError") {
		return new ApiError(502, "连接 GitHub 超时（15 秒），请确认服务器出网正常后重试");
	}
	const cause = isRecord(error) && isRecord(error["cause"]) ? error["cause"]["message"] : undefined;
	const detail = typeof cause === "string" && cause.length > 0 ? `（${cause}）` : "";
	return new ApiError(502, `无法连接 GitHub，请确认服务器出网正常后重试${detail}`);
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

/**
 * 读取 config.yaml 中由 LiteLLM 托管的 CommandCode 账户。
 * @param userConfig
 */
export function extractManagedCommandCodeAccount(userConfig: Record<string, unknown>): { apiKey: string; label: string } | null {
	const plugins = isRecord(userConfig["plugins"]) ? userConfig["plugins"] : null;
	const accounts = plugins && isRecord(plugins[MANAGED_ACCOUNTS_KEY]) ? plugins[MANAGED_ACCOUNTS_KEY] : null;
	const entry = accounts && isRecord(accounts[COMMANDCODE_ACCOUNT_KEY]) ? accounts[COMMANDCODE_ACCOUNT_KEY] : null;
	const value = entry?.["api-key"];
	const apiKey = typeof value === "string" ? value.trim() : "";
	if (!apiKey) {
		return null;
	}
	const labelValue = entry?.["label"];
	const label = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim() : "CommandCode";
	return { apiKey: apiKey, label: label };
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
 * 判断当前 CLIProxy 版本是否支持动态插件。
 * @param version
 */
export function supportsCliProxyPlugins(version: string | null): boolean {
	if (!version) {
		return false;
	}
	const comparison = compareCliProxyVersions(version, OPENCODE_GO_PLUGIN_MIN_VERSION);
	return comparison !== null && comparison >= 0;
}

/**
 * 只有插件版二进制才能加载托管插件；no-plugin 静态构建一律不注入插件配置。
 * @param version
 * @param artifact
 */
export function shouldEnableCliProxyPlugin(version: string | null, artifact: string | null): boolean {
	return supportsCliProxyPlugins(version) && artifact === "plugin";
}

/**
 * 计算托管 CLIProxy 运行时的发布归档名。
 * @param version
 * @param architecture
 */
export function cliProxyReleaseArchiveName(version: string, architecture: "amd64" | "aarch64"): string {
	return `CLIProxyAPI_${version}_linux_${architecture}${supportsCliProxyPlugins(version) ? "" : "_no-plugin"}.tar.gz`;
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
			"model-prefix": { enabled: true, value: "opencode-go" },
			// CLIProxy 在运行时展开该占位符，不能交给 JavaScript 模板字符串。
			// eslint-disable-next-line no-template-curly-in-string
			"api-keys": [{ value: "${OPENCODE_GO_API_KEY}", name: "Personal" }],
			...entry,
		};
	}
	if (plugins.commandcode) {
		// CommandCode 不接受 api-keys：账户只来自 CPA auth 文件（type: commandcode）。
		const entry = isRecord(configs[COMMANDCODE_PLUGIN_ID]) ? (configs[COMMANDCODE_PLUGIN_ID] as Record<string, unknown>) : {};
		configs[COMMANDCODE_PLUGIN_ID] = {
			enabled: true,
			"base-url": COMMANDCODE_PLUGIN_BASE_URL,
			"model-prefix": { enabled: true, value: "commandcode" },
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

function normalizeVersion(value: string): string {
	const trimmed = value.trim().replace(/^v/, "");
	if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(trimmed)) {
		throw ApiError.badRequest("CLIProxy 版本格式无效");
	}
	return trimmed;
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
	private readonly _runtimeRoot: string;
	private readonly _versionsDir: string;
	private readonly _authDir: string;
	private readonly _logsDir: string;
	private readonly _configPath: string;
	private readonly _pluginDir: string;
	private readonly _currentLink: string;
	private readonly _bootstrapBinary: string;
	private readonly _bootstrapVersion: string;
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
	private _pluginsEnabled = false;
	private _health: CliProxyRuntimeStatus["health"] = "unknown";
	private _operation: string | null = null;
	private _desiredStop = false;
	private _restartTimer: NodeJS.Timeout | null = null;
	private _operationTail: Promise<void> = Promise.resolve();
	private _logSequence = 0;
	private _releaseCache: CliProxyReleaseCache | null = null;
	private _releaseFetch: Promise<readonly CliProxyReleaseInfo[]> | null = null;
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
		this._runtimeRoot = process.env["CLIPROXY_RUNTIME_ROOT"] ?? "/var/lib/litellm/cliproxy";
		this._versionsDir = path.join(this._runtimeRoot, "versions");
		this._authDir = path.join(this._runtimeRoot, "auths");
		this._logsDir = path.join(this._runtimeRoot, "logs");
		this._configPath = path.join(this._runtimeRoot, "config.yaml");
		this._pluginDir = process.env["CLIPROXY_PLUGIN_DIR"] ?? path.join(this._runtimeRoot, "plugins");
		this._currentLink = path.join(this._runtimeRoot, "current");
		this._bootstrapBinary = process.env["CLIPROXY_BOOTSTRAP_BINARY"] ?? "/opt/cliproxy/cli-proxy-api";
		this._bootstrapVersion = normalizeVersion(process.env["CLIPROXY_BOOTSTRAP_VERSION"] ?? "7.2.110");
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
		await Promise.all([
			mkdir(this._runtimeRoot, { recursive: true }),
			mkdir(this._versionsDir, { recursive: true }),
			mkdir(this._authDir, { recursive: true }),
			mkdir(this._logsDir, { recursive: true }),
		]);
		await this._installBootstrapIfNeeded();
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
		await this._ensurePluginArtifact();
		await this._projectConfig();
		if (this._settings.enabled) {
			await this.start();
		}
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
	status(): CliProxyRuntimeStatus {
		const uptime =
			this._startedAt && this._state === "running" ? Math.max(0, Math.floor((Date.now() - this._startedAt.getTime()) / 1000)) : null;
		return {
			available: this._state !== "unavailable",
			enabled: this._settings.enabled,
			state: this._state,
			version: this._currentVersion(),
			installed_versions: this._installedVersionsSync(),
			pid: this._process?.pid ?? null,
			started_at: this._startedAt?.toISOString() ?? null,
			uptime_seconds: uptime,
			restart_count: this._restartCount,
			last_exit_code: this._lastExitCode,
			last_error: this._lastError,
			config_hash: this._configHash,
			health: this._health,
			operation: this._operation,
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
			const pluginsEnabledBefore = this._pluginsEnabled;
			await this._projectConfig();
			if (!next.enabled) {
				this._desiredStop = true;
				await this._stopProcess();
				return;
			}
			if (this._process && pluginsEnabledBefore !== this._pluginsEnabled) {
				this._appendLog(
					"system",
					this._pluginsEnabled ? "已启用 OpenCode Go 插件，重启 CLIProxy" : "已停用 OpenCode Go 插件，重启 CLIProxy",
				);
				await this._restartProcess();
				if (this._state !== "running") {
					throw ApiError.unavailable(this._lastError ?? "CLIProxy 重启后健康检查未通过");
				}
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
		const response = await fetch(`${this.baseUrl}/v1/models`, {
			headers: { Authorization: `Bearer ${this._internalApiKey}` },
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			throw new ApiError(response.status, `CLIProxy 模型列表请求失败: HTTP ${response.status}`);
		}
		const body = (await response.json()) as {
			/**
			 *
			 */
			data?: Array<{
				/**
				 *
				 */
				id?: unknown;
			}>;
		};
		return [...new Set((body.data ?? []).map((item) => item.id).filter((id): id is string => typeof id === "string"))].sort();
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
			await rename(sourcePath, targetPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				throw ApiError.notFound(`trash 中的账户文件不存在: ${filename}`);
			}
			throw error;
		}
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
		const binary = await this._resolveCurrentBinary();
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

	/**
	 * 从 GitHub 拉取正式版列表，并刷新缓存。
	 */
	private async _fetchReleases(): Promise<readonly CliProxyReleaseInfo[]> {
		let response: Response;
		try {
			response = await fetch(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases?per_page=100`, {
				headers: { Accept: "application/vnd.github+json", "User-Agent": "litellm-ts-cliproxy-manager" },
				signal: AbortSignal.timeout(15_000),
			});
		} catch (error) {
			throw cliProxyReleaseFetchError(error);
		}
		if (!response.ok) {
			const bodyText = await response.text().catch(() => "");
			throw cliProxyReleaseResponseError(response, bodyText);
		}
		let body: unknown;
		try {
			body = (await response.json()) as unknown;
		} catch {
			throw new ApiError(502, "GitHub 返回的 CLIProxy release 数据不是有效 JSON，请稍后重试");
		}
		if (!Array.isArray(body)) {
			throw new ApiError(502, "GitHub 返回的 CLIProxy release 数据格式异常，请稍后重试");
		}
		const releases = body
			.flatMap((value): CliProxyReleaseInfo[] => {
				if (!isRecord(value) || value["draft"] === true || value["prerelease"] === true || typeof value["tag_name"] !== "string") {
					return [];
				}
				try {
					const version = normalizeVersion(value["tag_name"]);
					return [
						{
							version: version,
							published_at: typeof value["published_at"] === "string" ? value["published_at"] : null,
							release_url:
								typeof value["html_url"] === "string"
									? value["html_url"]
									: `https://github.com/${RELEASE_REPOSITORY}/releases/tag/v${version}`,
							notes: extractCliProxyReleaseNotes(typeof value["body"] === "string" ? value["body"] : ""),
						},
					];
				} catch {
					return [];
				}
			})
			.sort((left, right) => compareCliProxyVersions(right.version, left.version) ?? 0);
		if (releases.length === 0) {
			throw new ApiError(502, EMPTY_RELEASE_MESSAGE);
		}
		this._releaseCache = { fetchedAt: Date.now(), releases: releases };
		return releases;
	}

	/**
	 * 读取版本列表；TTL 内复用缓存，并发请求合并为一次。
	 */
	private async _releasesWithCache(): Promise<readonly CliProxyReleaseInfo[]> {
		if (this._releaseCache && Date.now() - this._releaseCache.fetchedAt < UPDATE_CHECK_CACHE_TTL_MS) {
			return this._releaseCache.releases;
		}
		if (!this._releaseFetch) {
			this._releaseFetch = this._fetchReleases().finally(() => {
				this._releaseFetch = null;
			});
		}
		return this._releaseFetch;
	}

	/**
	 * 查询 CLIProxy 最新正式版。
	 *
	 * 页面打开时的预取会反复读取 GitHub，而未认证配额按出口 IP 共享，因此默认复用短周期缓存；
	 * 手动检查（Check 按钮、安装/回滚后的复核）通过 refresh 绕过缓存并刷新它。
	 * @param options - refresh 为 true 时强制请求 GitHub
	 */
	async checkLatestVersion(options: CliProxyUpdateCheckOptions = {}): Promise<CliProxyUpdateInfo> {
		const releases = options.refresh === true ? await this._fetchReleases() : await this._releasesWithCache();
		const latest = releases[0]?.version;
		if (latest === undefined) {
			throw new ApiError(502, EMPTY_RELEASE_MESSAGE);
		}
		const current = this._currentVersion();
		const installedVersions = this._installedVersionsSync();
		const relevantVersions = [current, ...installedVersions].filter((version): version is string => version !== null);
		const oldestRelevant = relevantVersions.reduce<string | null>((oldest, version) => {
			if (oldest === null || compareCliProxyVersions(version, oldest) === -1) {
				return version;
			}
			return oldest;
		}, null);
		const relevantReleases =
			oldestRelevant === null
				? releases.slice(0, 20)
				: releases.filter((release) => (compareCliProxyVersions(release.version, oldestRelevant) ?? -1) >= 0);
		return {
			current: current,
			latest: latest,
			update_available: current === null || compareCliProxyVersions(latest, current) === 1,
			releases: relevantReleases,
		};
	}

	/**
	 * @param versionValue
	 */
	async installAndActivate(versionValue?: string): Promise<CliProxyRuntimeStatus> {
		const version = versionValue ? normalizeVersion(versionValue) : (await this.checkLatestVersion()).latest;
		if (this._currentVersion() === version) {
			return this.status();
		}
		await this._serialize("update", async () => {
			this._state = "updating";
			await this._installRelease(version);
			await this._activateVersion(version);
			await this._projectConfig();
			await this._restartProcess();
			this._assertRunning();
		});
		return this.status();
	}

	/**
	 * @param versionValue
	 */
	async rollback(versionValue: string): Promise<CliProxyRuntimeStatus> {
		const version = normalizeVersion(versionValue);
		await access(path.join(this._versionsDir, version, "cli-proxy-api"));
		await this._serialize("rollback", async () => {
			await this._activateVersion(version);
			await this._projectConfig();
			await this._restartProcess();
			this._assertRunning();
		});
		return this.status();
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

	private _artifactMarkerPath(version: string): string {
		return path.join(this._versionsDir, version, ".artifact");
	}

	private async _readArtifactKind(version: string): Promise<string | null> {
		try {
			return (await readFile(this._artifactMarkerPath(version), "utf8")).trim() || null;
		} catch {
			return null;
		}
	}

	private async _pluginFileAvailable(pluginId: string): Promise<boolean> {
		for (const extension of [".so", ".dylib"]) {
			try {
				await access(path.join(this._pluginDir, `${pluginId}${extension}`));
				return true;
			} catch {
				// 继续探测其他平台扩展名。
			}
		}
		return false;
	}

	private async _hasAnyPluginFile(): Promise<boolean> {
		return (await this._pluginFileAvailable(OPENCODE_GO_PLUGIN_ID)) || (await this._pluginFileAvailable(COMMANDCODE_PLUGIN_ID));
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

	private async _ensurePluginArtifact(): Promise<void> {
		const version = this._currentVersion();
		if (!version || !supportsCliProxyPlugins(version)) {
			return;
		}
		if ((await this._readArtifactKind(version)) === "plugin") {
			return;
		}
		if (!(await this._hasAnyPluginFile())) {
			return;
		}
		if (version === this._bootstrapVersion) {
			try {
				await access(this._bootstrapBinary);
				const targetBinary = path.join(this._versionsDir, version, "cli-proxy-api");
				await copyFile(this._bootstrapBinary, targetBinary);
				await chmod(targetBinary, 0o755);
				await writeFile(this._artifactMarkerPath(version), "plugin", { mode: 0o600 });
				this._appendLog("system", `CLIProxy ${version} 已使用镜像内置的插件版二进制`);
				return;
			} catch {
				// 回退到在线安装。
			}
		}
		try {
			await this._installRelease(version, true);
			this._appendLog("system", `CliProxy ${version} 已切换为插件版二进制`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this._appendLog("system", `CliProxy ${version} 插件版二进制安装失败: ${message}`);
		}
	}

	private async _syncManagedCommandCodeAccount(userConfig: Record<string, unknown>): Promise<void> {
		if (!(await this._pluginFileAvailable(COMMANDCODE_PLUGIN_ID))) {
			return;
		}
		const prefix = "commandcode-managed-";
		let existing: string[] = [];
		try {
			existing = (await readdir(this._authDir)).filter((name) => name.startsWith(prefix) && name.endsWith(".json"));
		} catch {
			existing = [];
		}
		const account = extractManagedCommandCodeAccount(userConfig);
		if (!account) {
			await Promise.all(existing.map((name) => unlink(path.join(this._authDir, name)).catch(() => undefined)));
			return;
		}
		const digest = createHash("sha256").update(account.apiKey).digest("hex").slice(0, 12);
		const filename = `${prefix}${digest}.json`;
		const targetPath = path.join(this._authDir, filename);
		const payload = JSON.stringify({ type: "commandcode", api_key: account.apiKey, label: account.label });
		let current: string | null = null;
		try {
			current = await readFile(targetPath, "utf8");
		} catch {
			current = null;
		}
		if (current !== payload) {
			const temporary = path.join(this._authDir, `.${filename}.${randomUUID()}.tmp`);
			await writeFile(temporary, payload, { mode: 0o600 });
			await rename(temporary, targetPath);
		}
		await Promise.all(
			existing.filter((name) => name !== filename).map((name) => unlink(path.join(this._authDir, name)).catch(() => undefined)),
		);
	}

	private async _resolveManagedPlugins(userConfig: Record<string, unknown>): Promise<CliProxyManagedPlugins | null> {
		const version = this._currentVersion();
		if (!version || !supportsCliProxyPlugins(version)) {
			return null;
		}
		if ((await this._readArtifactKind(version)) !== "plugin") {
			return null;
		}
		// 两个插件开关独立：OpenCode Go 需要凭据，CommandCode 只看插件文件
		// （它的账户来自 CPA auth 文件，不经配置）。
		const opencodeGo = (await this._pluginFileAvailable(OPENCODE_GO_PLUGIN_ID)) && this._hasPluginCredential(userConfig);
		const commandcode = await this._pluginFileAvailable(COMMANDCODE_PLUGIN_ID);
		if (!opencodeGo && !commandcode) {
			return null;
		}
		return { dir: this._pluginDir, opencodeGo: opencodeGo, commandcode: commandcode };
	}

	private async _projectConfig(): Promise<void> {
		const userConfig = parseCliProxyUserConfig(this._settings.config_yaml);
		await this._syncManagedCommandCodeAccount(userConfig);
		const plugins = await this._resolveManagedPlugins(userConfig);
		this._pluginsEnabled = plugins !== null;
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

	private async _installBootstrapIfNeeded(): Promise<void> {
		try {
			await access(this._bootstrapBinary);
		} catch {
			this._state = "unavailable";
			this._lastError = `CLIProxy bootstrap binary not found: ${this._bootstrapBinary}`;
			return;
		}
		const targetDir = path.join(this._versionsDir, this._bootstrapVersion);
		const targetBinary = path.join(targetDir, "cli-proxy-api");
		try {
			await access(targetBinary);
		} catch {
			await mkdir(targetDir, { recursive: true });
			await copyFile(this._bootstrapBinary, targetBinary);
			await chmod(targetBinary, 0o755);
		}
		try {
			await readlink(this._currentLink);
		} catch {
			await this._activateVersion(this._bootstrapVersion);
		}
	}

	private async _resolveCurrentBinary(): Promise<string> {
		try {
			const link = await readlink(this._currentLink);
			return path.resolve(this._runtimeRoot, link, "cli-proxy-api");
		} catch {
			throw ApiError.unavailable("CLIProxy 二进制尚未安装");
		}
	}

	private _currentVersion(): string | null {
		try {
			const link = readlinkSync(this._currentLink);
			return path.basename(link);
		} catch {
			return null;
		}
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
	 */
	async persistManagementConfig(): Promise<void> {
		const response = await this.managementRequest("/config.yaml");
		if (!response.ok) {
			throw new ApiError(response.status, `CLIProxy 配置同步失败: HTTP ${response.status}`);
		}
		const parsed = yaml.load(await response.text());
		if (!isRecord(parsed)) {
			throw ApiError.unavailable("CLIProxy 配置同步响应无效");
		}
		const userConfig = sanitizeImportedConfig(parsed);
		await this.saveSettings({
			enabled: this._settings.enabled,
			config_yaml: yaml.dump(userConfig, { noRefs: true, lineWidth: 120, sortKeys: false }),
		});
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

	private _installedVersionsSync(): string[] {
		try {
			const values = readdirSync(this._versionsDir, { withFileTypes: true });
			return values
				.filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+/.test(entry.name))
				.map((entry) => entry.name)
				.sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
		} catch {
			return [];
		}
	}

	private async _activateVersion(version: string): Promise<void> {
		const temporaryLink = `${this._currentLink}.${randomUUID()}.tmp`;
		await symlink(path.relative(this._runtimeRoot, path.join(this._versionsDir, version)), temporaryLink);
		await rename(temporaryLink, this._currentLink).catch(async (error: NodeJS.ErrnoException) => {
			if (error.code !== "EEXIST" && error.code !== "ENOTEMPTY") {
				throw error;
			}
			await unlink(this._currentLink);
			await rename(temporaryLink, this._currentLink);
		});
		this._appendLog("system", `已激活 CLIProxy ${version}`);
	}

	private async _installRelease(version: string, force = false): Promise<void> {
		const targetBinary = path.join(this._versionsDir, version, "cli-proxy-api");
		try {
			await access(targetBinary);
			if (!force) {
				return;
			}
		} catch {
			// Continue with installation.
		}
		const architecture = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "amd64" : null;
		if (!architecture) {
			throw ApiError.badRequest(`不支持的 CPU 架构: ${process.arch}`);
		}
		const archiveName = cliProxyReleaseArchiveName(version, architecture);
		const releaseBase = `https://github.com/${RELEASE_REPOSITORY}/releases/download/v${version}`;
		const [checksumsResponse, archiveResponse] = await Promise.all([
			fetch(`${releaseBase}/checksums.txt`, { signal: AbortSignal.timeout(30_000) }),
			fetch(`${releaseBase}/${archiveName}`, { signal: AbortSignal.timeout(120_000) }),
		]);
		if (!checksumsResponse.ok || !archiveResponse.ok || !archiveResponse.body) {
			throw new ApiError(502, `下载 CLIProxy ${version} 失败`);
		}
		const checksums = await checksumsResponse.text();
		const expected = checksums
			.split(/\r?\n/)
			.map((line) => line.trim().split(/\s+/))
			.find((parts) => parts[1] === archiveName)?.[0];
		if (!expected || !/^[a-f0-9]{64}$/i.test(expected)) {
			throw new ApiError(502, `CLIProxy ${version} 校验文件中缺少目标归档`);
		}
		const staging = path.join(this._runtimeRoot, `.install-${version}-${randomUUID()}`);
		const archivePath = path.join(staging, archiveName);
		await mkdir(staging, { recursive: true });
		const output = createWriteStream(archivePath, { mode: 0o600 });
		await finished(Readable.fromWeb(archiveResponse.body as never).pipe(output));
		const actual = createHash("sha256")
			.update(await readFile(archivePath))
			.digest("hex");
		if (actual.toLowerCase() !== expected.toLowerCase()) {
			throw new ApiError(502, `CLIProxy ${version} SHA256 校验失败`);
		}
		const extractDir = path.join(staging, "extract");
		await mkdir(extractDir, { recursive: true });
		await this._runCommand("tar", ["-xzf", archivePath, "-C", extractDir]);
		const extractedBinary = path.join(extractDir, "cli-proxy-api");
		await access(extractedBinary);
		const targetDir = path.join(this._versionsDir, version);
		await mkdir(targetDir, { recursive: true });
		await copyFile(extractedBinary, targetBinary);
		await chmod(targetBinary, 0o755);
		await writeFile(this._artifactMarkerPath(version), supportsCliProxyPlugins(version) ? "plugin" : "no-plugin", {
			mode: 0o600,
		});
		await this._runCommand(targetBinary, ["-h"]);
		this._appendLog("system", `CLIProxy ${version} 下载并校验完成`);
	}

	private async _runCommand(command: string, args: string[]): Promise<void> {
		await new Promise<void>((resolve, reject) => {
			const child = spawn(command, args, { cwd: this._runtimeRoot, stdio: ["ignore", "pipe", "pipe"] });
			let errorText = "";
			child.stderr.on("data", (chunk: Buffer) => {
				errorText += chunk.toString("utf8");
			});
			child.once("error", reject);
			child.once("exit", (code) => {
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`${command} exited with ${code}: ${errorText.slice(-1_000)}`));
				}
			});
		});
	}

	private async _startProcess(): Promise<void> {
		if (this._process) {
			return;
		}
		if (!this._settings.enabled) {
			this._state = "stopped";
			return;
		}
		const binary = await this._resolveCurrentBinary();
		this._desiredStop = false;
		this._state = "starting";
		this._health = "unknown";
		this._appendLog("system", `启动 CLIProxy ${this._currentVersion() ?? "unknown"}`);
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
			// 子进程仍在运行且已被受管（exit handler 已挂载），不抛错、不失控；
			// 保持 degraded 状态让 status() 如实反映，用户可 restart() 重试。
			this._state = "degraded";
			this._health = "unhealthy";
			this._lastError = "CLIProxy 启动后健康检查超时";
			return;
		}
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
		child.kill("SIGTERM");
		await Promise.race([
			new Promise<void>((resolve) => child.once("exit", () => resolve())),
			new Promise<void>((resolve) =>
				setTimeout(() => {
					if (this._process === child) {
						child.kill("SIGKILL");
					}
					resolve();
				}, STOP_TIMEOUT_MS),
			),
		]);
		if (this._process === child) {
			this._process = null;
		}
		this._startedAt = null;
		this._state = "stopped";
		this._health = "unknown";
	}

	private async _restartProcess(): Promise<void> {
		this._desiredStop = true;
		await this._stopProcess();
		this._desiredStop = false;
		this._restartCount += 1;
		await this._startProcess();
	}

	private async _waitForHealth(timeoutMs: number): Promise<boolean> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			try {
				const response = await fetch(`${this.baseUrl}/healthz`, { signal: AbortSignal.timeout(1_500) });
				if (response.ok) {
					this._health = "healthy";
					return true;
				}
			} catch {
				// Still starting.
			}
			await new Promise((resolve) => setTimeout(resolve, 250));
		}
		this._health = "unhealthy";
		return false;
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
