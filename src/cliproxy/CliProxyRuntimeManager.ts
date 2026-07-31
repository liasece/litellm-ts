/* eslint-disable jsdoc/check-alignment, jsdoc/require-throws */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, readdirSync, readlinkSync } from "node:fs";
import { access, chmod, copyFile, mkdir, open, readFile, readlink, rename, symlink, unlink, writeFile } from "node:fs/promises";
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
	type CliProxyRuntimeStatus,
	type CliProxyStoredSettings,
} from "./CliProxyTypes";
import { buildCliProxyQuotaRequests, normalizeCliProxyQuota, type CliProxyQuotaRequest } from "./CliProxyQuota";

const MAX_LOG_ENTRIES = 4_000;
const MAX_OAUTH_OUTPUT_LINES = 500;
const STOP_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 15_000;
const MAX_OAUTH_SESSIONS = 32;
const RELEASE_REPOSITORY = "router-for-me/CLIProxyAPI";
const RESERVED_CONFIG_KEYS = new Set(["host", "port", "auth-dir", "api-keys", "remote-management"]);
const SENSITIVE_LOG_PATTERN =
	/(authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret)(["':=\s]+)([^\s,"'}]+)/gi;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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
		internalApiKey: string;
	},
): Record<string, unknown> {
	return {
		...userConfig,
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
}

function sanitizeImportedConfig(value: Record<string, unknown>): Record<string, unknown> {
	const result = { ...value };
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
	private _health: CliProxyRuntimeStatus["health"] = "unknown";
	private _operation: string | null = null;
	private _desiredStop = false;
	private _restartTimer: NodeJS.Timeout | null = null;
	private _operationTail: Promise<void> = Promise.resolve();
	private _logSequence = 0;
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
	 *
	 */
	async listAccounts(): Promise<CliProxyAccountSummary[]> {
		const files = await this._listManagedAuthFiles();
		return files
			.flatMap((value): CliProxyAccountSummary[] => {
				const authIndex = this._stringField(value, "auth_index", "authIndex");
				const filename = this._stringField(value, "name", "filename");
				if (!authIndex || !filename) {
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
				const safeLine = this._sanitizeLog(line);
				const current = this._oauthSessions.get(id);
				if (!current) {
					continue;
				}
				const output = [...current.snapshot.output, safeLine].slice(-MAX_OAUTH_OUTPUT_LINES);
				current.snapshot = { ...current.snapshot, output: output };
				this._appendLog("oauth", `[${provider}] ${safeLine}`);
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
	 *
	 */
	async checkLatestVersion(): Promise<{
		/**
		 *
		 */
		current: string | null; /**
		 *
		 */
		latest: string; /**
		 *
		 */
		update_available: boolean;
	}> {
		const response = await fetch(`https://api.github.com/repos/${RELEASE_REPOSITORY}/releases/latest`, {
			headers: { Accept: "application/vnd.github+json", "User-Agent": "litellm-ts-cliproxy-manager" },
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok) {
			throw new ApiError(502, `获取 CLIProxy 最新版本失败: HTTP ${response.status}`);
		}
		const body = (await response.json()) as {
			/**
			 *
			 */
			tag_name?: unknown;
		};
		if (typeof body.tag_name !== "string") {
			throw new ApiError(502, "CLIProxy release 响应缺少 tag_name");
		}
		const latest = normalizeVersion(body.tag_name);
		const current = this._currentVersion();
		return {
			current: current,
			latest: latest,
			update_available: current === null || compareCliProxyVersions(latest, current) === 1,
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

	private async _projectConfig(): Promise<void> {
		const userConfig = parseCliProxyUserConfig(this._settings.config_yaml);
		const projected = buildCliProxyProjection(userConfig, {
			port: this._port,
			authDir: this._authDir,
			internalApiKey: this._internalApiKey,
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

	private async _installRelease(version: string): Promise<void> {
		const targetBinary = path.join(this._versionsDir, version, "cli-proxy-api");
		try {
			await access(targetBinary);
			return;
		} catch {
			// Continue with installation.
		}
		const architecture = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "amd64" : null;
		if (!architecture) {
			throw ApiError.badRequest(`不支持的 CPU 架构: ${process.arch}`);
		}
		const archiveName = `CLIProxyAPI_${version}_linux_${architecture}_no-plugin.tar.gz`;
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

	private _sanitizeLog(message: string): string {
		return message.replace(SENSITIVE_LOG_PATTERN, (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`);
	}

	private _appendLog(stream: CliProxyLogEntry["stream"], message: string): void {
		this._logSequence += 1;
		this._logs.push({
			id: this._logSequence,
			timestamp: new Date().toISOString(),
			stream: stream,
			message: this._sanitizeLog(message),
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
