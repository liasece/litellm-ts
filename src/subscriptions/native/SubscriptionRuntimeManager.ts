/**
 * 原生订阅运行时管理器。
 *
 * 保留 Dashboard 与旧管理 API 需要的账号、额度、目录、日志、OAuth 会话语义，
 * 但不再启动 Go 子进程、不维护 CPA 配置、不暴露插件管理面。
 */

import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../core/api/ApiError";
import type { ConfigRepository } from "../../repositories/ConfigRepository";
import {
	SUBSCRIPTION_PROVIDERS,
	isSubscriptionProvider,
	type SubscriptionProvider as SubscriptionProviderId,
} from "../SubscriptionProviders";
import { SubscriptionAccountKeys, type KeySubscription, type SavedSubscriptionKey } from "../SubscriptionAccountKeys";
import { SubscriptionAccountStore, defaultSubscriptionAuthDir } from "./accountStore";
import { codexExpiryMs } from "./auth/codexOAuth";
import { disableInvalidAccount, isTerminalRefreshFailure } from "./auth/refreshFailure";
import { SubscriptionAccountScheduler } from "./scheduler";
import { SubscriptionBridge, type SubscriptionProviderLookup } from "./bridge";
import { setSubscriptionRequestHandler } from "../../router/SubscriptionDispatch";
import type {
	SubscriptionAccount,
	SubscriptionCatalogModel,
	SubscriptionLoginSession,
	SubscriptionProviderAdapter,
	SubscriptionSource,
} from "./types";
import { catalogForSource } from "./catalog/catalog";
import { quotaForAccount } from "./quota/quota";
import {
	commandCodeAccountFilename,
	extractManagedCommandCodeAccounts,
	importLegacyManagedConfig,
	parseUserConfig,
	projectCommandCodeAccounts,
	projectSavedKeyAccounts,
	savedKeyAccountFilename,
	serializeUserConfig,
	setManagedCommandCodeAccounts,
	SUBSCRIPTION_SETTINGS_PARAM,
	type ManagedCommandCodeAccount,
} from "./managedAccounts";
import type {
	CliProxyAccountQuota,
	CliProxyAccountSummary,
	CliProxyOAuthProvider,
	CliProxyOAuthSession,
	CliProxyRuntimeStatus,
	CliProxyStoredSettings,
} from "../../cliproxy/CliProxyTypes";

/** 运行时构造依赖。 */
export interface SubscriptionRuntimeOptions {
	/** 账号仓库；缺省按 auth 目录创建。 */
	readonly accounts?: SubscriptionAccountStore;
	/** Provider 适配器集合。 */
	readonly providers: SubscriptionProviderLookup;
	/** 覆盖 auth 目录。 */
	readonly authDir?: string;
	/** 会话亲和有效期。 */
	readonly affinityTtlMs?: number;
}

/** 日志环形缓冲条目。 */
interface RuntimeLog {
	readonly id: number;
	readonly timestamp: string;
	readonly stream: "stdout" | "stderr" | "system" | "oauth";
	readonly message: string;
}

/** OAuth 会话包装。 */
interface OAuthEntry {
	readonly provider: CliProxyOAuthProvider;
	readonly source: SubscriptionSource;
	readonly startedAt: string;
	session: SubscriptionLoginSession;
	finishedAt: string | null;
}

/** 日志最大条数。 */
const MAX_LOGS = 2_000;
/** 后台刷新间隔。 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 原生订阅运行时。
 */
export class SubscriptionRuntimeManager {
	private readonly _repository: ConfigRepository;
	private readonly _accounts: SubscriptionAccountStore;
	private readonly _scheduler: SubscriptionAccountScheduler;
	private readonly _providers: SubscriptionProviderLookup;
	private readonly _bridge: SubscriptionBridge;
	private readonly _accountKeys: SubscriptionAccountKeys;
	private readonly _oauth = new Map<string, OAuthEntry>();
	private readonly _logs: RuntimeLog[] = [];
	private readonly _refreshing = new Set<string>();
	private _settings: CliProxyStoredSettings = { enabled: true, config_yaml: "" };
	private _settingsLoaded = false;
	private _startedAt: string | null = null;
	private _refreshTimer: ReturnType<typeof setInterval> | undefined;
	private readonly _lastBackgroundRefresh = new Map<string, number>();
	private _logId = 0;
	private _lastError: string | null = null;
	private _activeRequestProbe: (() => number) | undefined;
	private _operation: string | null = null;

	constructor(repository: ConfigRepository, masterKey: string | undefined, options: SubscriptionRuntimeOptions) {
		this._repository = repository;
		this._accounts = options.accounts ?? new SubscriptionAccountStore({ authDir: options.authDir ?? defaultSubscriptionAuthDir() });
		this._scheduler = new SubscriptionAccountScheduler({
			affinityTtlMs: options.affinityTtlMs,
			loadAccounts: (source) => this._accounts.list(source),
		});
		this._providers = options.providers;
		this._bridge = new SubscriptionBridge({
			accounts: this._accounts,
			scheduler: this._scheduler,
			providers: this._providers,
			isEnabled: () => this._settings.enabled,
		});
		this._accountKeys = new SubscriptionAccountKeys(repository, masterKey);
		// 执行处理器必须在监听前就可用；设置与账号投影可以稍后在 warmUp 中完成。
		setSubscriptionRequestHandler((request, options) => this._bridge.execute(request, options));
	}

	/** 账号仓库（管理面直接使用）。 */
	get accounts(): SubscriptionAccountStore {
		return this._accounts;
	}

	/** 当前设置。 */
	get settings(): CliProxyStoredSettings {
		return this._settings;
	}

	/** 用户 YAML 配置对象。 */
	get userConfig(): Record<string, unknown> {
		try {
			return parseUserConfig(this._settings.config_yaml);
		} catch {
			return {};
		}
	}

	/** 执行桥。 */
	get bridge(): SubscriptionBridge {
		return this._bridge;
	}

	/**
	 * 注册在途请求探针。
	 * @param probe - 返回在途请求数
	 */
	setActiveRequestProbe(probe: () => number): void {
		this._activeRequestProbe = probe;
	}

	/**
	 * 初始化：加载设置、投影托管账号、注册执行处理器并启动后台刷新。
	 */
	async initialize(): Promise<void> {
		await this._accounts.ensureDirectories();
		await this._loadSettings();
		await this._projectManagedAccounts();
		this._startedAt = new Date().toISOString();
		this.appendSystemLog("原生订阅运行时已启动");
		this._refreshTimer = setInterval(() => {
			void this._refreshExpiringAccounts();
		}, REFRESH_INTERVAL_MS);
		this._refreshTimer.unref();
		void this._refreshExpiringAccounts();
	}

	/**
	 * 关闭：注销处理器与定时器。
	 */
	shutdown(): void {
		if (this._refreshTimer !== undefined) {
			clearInterval(this._refreshTimer);
			this._refreshTimer = undefined;
		}
		setSubscriptionRequestHandler(undefined);
		this.appendSystemLog("原生订阅运行时已停止");
	}

	/**
	 * 运行时状态。
	 */
	status(): CliProxyRuntimeStatus {
		const active = this._activeRequestProbe?.() ?? 0;
		return {
			available: true,
			engine: "subscriptions",
			enabled: this._settings.enabled,
			state: this._settings.enabled ? "running" : "stopped",
			version: "native",
			installed_versions: [],
			pid: process.pid,
			started_at: this._startedAt,
			uptime_seconds: this._startedAt === null ? null : Math.max(0, Math.floor((Date.now() - Date.parse(this._startedAt)) / 1000)),
			restart_count: 0,
			last_exit_code: null,
			last_error: this._lastError,
			config_hash: null,
			health: this._settings.enabled ? "healthy" : "unknown",
			draining: false,
			in_flight_requests: active,
			operation: this._operation,
		};
	}

	/**
	 * 更新启用状态与用户 YAML；不再投影 CPA 配置。
	 * @param settings - 新设置
	 */
	async saveSettings(settings: CliProxyStoredSettings): Promise<CliProxyRuntimeStatus> {
		const next: CliProxyStoredSettings = {
			enabled: settings.enabled !== false,
			config_yaml: settings.config_yaml ?? "",
		};
		// 校验 YAML，避免把损坏的配置持久化。
		parseUserConfig(next.config_yaml);
		await this._repository.upsertParam(SUBSCRIPTION_SETTINGS_PARAM, next);
		this._settings = next;
		this._settingsLoaded = true;
		await this._projectManagedAccounts();
		this.appendSystemLog(`订阅运行时已${next.enabled ? "启用" : "停用"}`);
		return this.status();
	}

	/**
	 * 只切换启用状态。
	 * @param enabled - 是否启用
	 */
	async setEnabled(enabled: boolean): Promise<CliProxyRuntimeStatus> {
		return this.saveSettings({ enabled: enabled, config_yaml: this._settings.config_yaml });
	}

	/**
	 * 列出账号（含回收站）。
	 * @param options - 过滤
	 */
	async listAccounts(options: { includeTrashed?: boolean } = {}): Promise<CliProxyAccountSummary[]> {
		const active = await this._accounts.list();
		const result: CliProxyAccountSummary[] = [];
		for (const account of active) {
			result.push(await this._summary(account));
		}
		if (options.includeTrashed) {
			for (const account of await this._accounts.listTrashed()) {
				result.push(await this._summary(account, true));
			}
		}
		return result.sort((left, right) => left.filename.localeCompare(right.filename));
	}

	/**
	 * 更新账号禁用/权重。
	 * @param filename - 文件名
	 * @param patch - 变更
	 */
	async updateAccount(filename: string, patch: { disabled?: boolean; weight?: number | null }): Promise<void> {
		const account = await this._accountByFilename(filename);
		if (patch.disabled !== undefined) {
			await this._accounts.setDisabled(account.fileName, patch.disabled);
			if (!patch.disabled) {
				await this._accounts.patchRaw(account.fileName, {
					status: null,
					last_error: null,
					refresh_failures: null,
				});
			}
		}
		if (patch.weight !== undefined) {
			if (patch.weight !== null && (!Number.isFinite(patch.weight) || patch.weight < 0 || patch.weight > 1_000_000)) {
				throw ApiError.badRequest("订阅账号权重必须在 0-1000000 之间");
			}
			await this._accounts.setWeight(account.fileName, patch.weight);
		}
		this._scheduler.reset();
		this.appendSystemLog(`订阅账号 ${account.fileName} 已更新`);
	}

	/**
	 * 移入回收站。
	 * @param filename - 文件名
	 */
	async trashAccount(filename: string): Promise<void> {
		const account = await this._accountByFilename(filename);
		await this._accounts.archive(account.fileName);
		this._scheduler.reset();
		this.appendSystemLog(`订阅账号 ${account.fileName} 已移入回收站`);
	}

	/**
	 * 从回收站恢复。
	 * @param filename - `.trash/<ts>-<name>` 或原始文件名
	 */
	async restoreAccount(filename: string): Promise<void> {
		if (filename.includes("\0") || filename.includes("..")) {
			throw ApiError.badRequest("订阅账号文件名无效");
		}
		const base = path.basename(filename);
		const original = base.replace(/^\d+-/, "");
		await this._accounts.restore(original);
		this._scheduler.reset();
		this.appendSystemLog(`订阅账号 ${original} 已恢复`);
	}

	/**
	 * 查询账号额度。
	 * @param authIndex - 账号 ID
	 */
	async getAccountQuota(authIndex: string): Promise<CliProxyAccountQuota> {
		const account = (await this._accounts.list()).find((candidate) => candidate.id === authIndex);
		if (!account) {
			throw ApiError.notFound("订阅账号不存在");
		}
		const adapter = this._adapter(account.source);
		const credential = await adapter.auth.ensureCredential(account);
		return quotaForAccount(account.source, account, credential);
	}

	/**
	 * 列出某个订阅 Provider 的模型。
	 * @param provider - 公开 provider
	 */
	async listSubscriptionModels(provider: SubscriptionProviderId): Promise<string[]> {
		const source = SUBSCRIPTION_PROVIDERS[provider].source;
		const models = this._providers.get(source) ? await this._providers.get(source)!.catalog() : catalogForSource(source);
		return models.map((model) => model.id).sort();
	}

	/**
	 * 列出全部订阅模型。
	 */
	async listModels(): Promise<string[]> {
		const result = new Set<string>();
		for (const source of Object.keys(SUBSCRIPTION_PROVIDERS) as SubscriptionProviderId[]) {
			try {
				for (const model of await this.listSubscriptionModels(source)) {
					result.add(model);
				}
			} catch (error) {
				this.appendSystemLog(`模型目录刷新失败（${source}）：${messageOf(error)}`);
			}
		}
		return [...result].sort();
	}

	/**
	 * 列出单个 Provider 的模型元数据。
	 * @param provider - 公开 provider
	 */
	async catalog(provider: SubscriptionProviderId): Promise<readonly SubscriptionCatalogModel[]> {
		return this._adapter(SUBSCRIPTION_PROVIDERS[provider].source).catalog();
	}

	/**
	 * 读取日志。
	 * @param after - 只返回 id 大于该值的日志
	 */
	logs(after = 0): { entries: RuntimeLog[]; cursor: number } {
		const entries = this._logs.filter((entry) => entry.id > after);
		return { entries: entries, cursor: this._logs.at(-1)?.id ?? after };
	}

	/**
	 * 追加系统日志。
	 * @param message - 内容
	 * @param stream - 日志流
	 */
	appendSystemLog(message: string, stream: RuntimeLog["stream"] = "system"): void {
		this._logId += 1;
		this._logs.push({ id: this._logId, timestamp: new Date().toISOString(), stream: stream, message: message });
		if (this._logs.length > MAX_LOGS) {
			this._logs.splice(0, this._logs.length - MAX_LOGS);
		}
	}

	/**
	 * 列出保存的 API key。
	 * @param provider - key 来源
	 */
	async listSavedKeys(provider: KeySubscription): Promise<SavedSubscriptionKey[]> {
		await this._accountKeys.load();
		const archived = await this._archivedFilenames();
		return this._accountKeys
			.list()
			.filter((entry) => entry.provider === provider && !archived.has(savedKeyAccountFilename(provider, entry.id)));
	}

	/**
	 * 保存/轮换 API key。
	 * @param provider - key 来源
	 * @param id - 记录 ID
	 * @param label - 展示名
	 * @param key - 新 key
	 */
	async saveSubscriptionKey(
		provider: KeySubscription,
		id: string | undefined,
		label: string,
		key?: string,
	): Promise<SavedSubscriptionKey[]> {
		await this._accountKeys.load();
		if (key) {
			const duplicate = await this._accounts.hasApiKey(provider, key.trim());
			if (duplicate) {
				throw ApiError.conflict("该订阅账号已存在");
			}
		}
		await this._accountKeys.save(provider, id, label, key);
		await projectSavedKeyAccounts(this._accounts.authDir, this._accountKeys);
		this._scheduler.reset();
		this.appendSystemLog(`订阅密钥 ${label} 已保存`);
		return this.listSavedKeys(provider);
	}

	/**
	 * 撤销 API key：归档 auth 文件，保留加密记录以便恢复。
	 * @param provider - key 来源
	 * @param id - 记录 ID
	 */
	async revokeSubscriptionKey(provider: KeySubscription, id: string): Promise<void> {
		await this._accountKeys.load();
		const entry = this._accountKeys.list().find((record) => record.id === id && record.provider === provider);
		if (!entry) {
			throw ApiError.notFound("订阅账号不存在");
		}
		await this._accounts.archive(savedKeyAccountFilename(provider, entry.id));
		this._scheduler.reset();
		this.appendSystemLog(`订阅密钥 ${entry.label} 已移入回收站`);
	}

	/**
	 * 列出托管的 CommandCode 账户。
	 */
	async listCommandCodeAccounts(): Promise<{ index: number; label: string; filename: string }[]> {
		return extractManagedCommandCodeAccounts(this.userConfig).map((account, index) => ({
			index: index,
			label: account.label,
			filename: commandCodeAccountFilename(account.apiKey),
		}));
	}

	/**
	 * 新增 CommandCode 账户。
	 * @param key - API key
	 * @param label - 展示名
	 */
	async addCommandCodeAccount(key: unknown, label?: unknown): Promise<{ index: number; label: string; filename: string }[]> {
		const account = normalizeCommandCodeAccount(key, label);
		const config = this.userConfig;
		if (extractManagedCommandCodeAccounts(config).some((entry) => entry.apiKey === account.apiKey)) {
			throw ApiError.conflict("该 CommandCode API key 已存在");
		}
		const entries = commandCodeEntries(config);
		entries.push({ "api-key": account.apiKey, label: account.label });
		await this._saveCommandCodeEntries(config, entries);
		return this.listCommandCodeAccounts();
	}

	/**
	 * 修改 CommandCode 账户。
	 * @param index - 配置数组下标
	 * @param patch - key/label
	 */
	async updateCommandCodeAccount(
		index: number,
		patch: { apiKey?: unknown; label?: unknown },
	): Promise<{ index: number; label: string; filename: string }[]> {
		const config = this.userConfig;
		const entries = commandCodeEntries(config);
		if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
			throw ApiError.notFound("CommandCode 账户不存在");
		}
		const entry = entries[index]!;
		if (patch.apiKey !== undefined) {
			const account = normalizeCommandCodeAccount(patch.apiKey, entry["label"]);
			if (entries.some((candidate, position) => position !== index && candidate["api-key"] === account.apiKey)) {
				throw ApiError.conflict("该 CommandCode API key 已存在");
			}
			entry["api-key"] = account.apiKey;
		}
		if (patch.label !== undefined) {
			entry["label"] = normalizeCommandCodeAccount(entry["api-key"], patch.label).label;
		}
		await this._saveCommandCodeEntries(config, entries);
		return this.listCommandCodeAccounts();
	}

	/**
	 * 删除 CommandCode 账户。
	 * @param index - 配置数组下标
	 */
	async deleteCommandCodeAccount(index: number): Promise<{ index: number; label: string; filename: string }[]> {
		const config = this.userConfig;
		const entries = commandCodeEntries(config);
		if (!Number.isInteger(index) || index < 0 || index >= entries.length) {
			throw ApiError.notFound("CommandCode 账户不存在");
		}
		entries.splice(index, 1);
		await this._saveCommandCodeEntries(config, entries);
		return this.listCommandCodeAccounts();
	}

	/**
	 * 启动 OAuth 登录。
	 * @param provider - 公开登录来源
	 */
	async startOAuth(provider: CliProxyOAuthProvider): Promise<CliProxyOAuthSession> {
		const source = oauthSource(provider);
		const adapter = this._adapter(source);
		const auth = adapter.auth;
		const start =
			provider === "codex-device"
				? ((auth as SubscriptionAuthHandlerWithDevice).startDeviceLogin ?? auth.startLogin)
				: auth.startLogin;
		if (!start) {
			throw ApiError.badRequest(`${adapter.displayName} 不支持交互式登录`);
		}
		const session = await start.call(auth);
		this._oauth.set(session.id, {
			provider: provider,
			source: source,
			startedAt: new Date().toISOString(),
			session: session,
			finishedAt: null,
		});
		this._pruneOAuth();
		return this._oauthView(session.id);
	}

	/**
	 * 查询 OAuth 会话。
	 * @param id - 会话 ID
	 */
	async getOAuthSession(id: string): Promise<CliProxyOAuthSession> {
		const entry = this._oauth.get(id);
		if (!entry) {
			throw ApiError.notFound("OAuth 会话不存在");
		}
		const auth = this._adapter(entry.source).auth;
		if (entry.session.state === "pending" && auth.pollLogin) {
			entry.session = await auth.pollLogin(id);
			if (entry.session.state !== "pending" && entry.finishedAt === null) {
				entry.finishedAt = new Date().toISOString();
				if (entry.session.state === "success") {
					this._scheduler.reset();
				}
				this.appendSystemLog(`OAuth ${entry.provider} ${entry.session.state === "success" ? "成功" : "失败"}`, "oauth");
			}
		}
		return this._oauthView(id);
	}

	/**
	 * 向 OAuth 会话提交输入。
	 * @param id - 会话 ID
	 * @param input - 用户输入
	 */
	async sendOAuthInput(id: string, input: string): Promise<CliProxyOAuthSession> {
		const entry = this._oauth.get(id);
		if (!entry) {
			throw ApiError.notFound("OAuth 会话不存在");
		}
		const auth = this._adapter(entry.source).auth;
		if (!auth.submitLoginInput) {
			throw ApiError.badRequest("当前登录流程不接受输入");
		}
		entry.session = await auth.submitLoginInput(id, input);
		if (entry.session.state !== "pending" && entry.finishedAt === null) {
			entry.finishedAt = new Date().toISOString();
		}
		return this._oauthView(id);
	}

	/**
	 * 交给桥接层执行原始操作（图片/WS 等 passthrough 端点使用）。
	 */
	get providerLookup(): SubscriptionProviderLookup {
		return this._providers;
	}

	private _adapter(source: SubscriptionSource): SubscriptionProviderAdapter {
		const adapter = this._providers.get(source);
		if (!adapter) {
			throw ApiError.unavailable(`订阅 Provider 未启用：${source}`);
		}
		return adapter;
	}

	private async _summary(account: SubscriptionAccount, trashed = false): Promise<CliProxyAccountSummary> {
		let modifiedAt = new Date().toISOString();
		try {
			modifiedAt = (await stat(account.path)).mtime.toISOString();
		} catch {
			// 文件在列举与 stat 之间消失时保留当前时间。
		}
		return {
			auth_index: account.id,
			filename: trashed ? `.trash/${path.basename(account.path)}` : account.fileName,
			provider: account.source,
			email: account.email ?? null,
			label: account.label ?? null,
			disabled: account.disabled,
			weight: account.raw["weight"] === undefined ? null : account.weight,
			priority: account.priority ?? 0,
			status: account.status ?? null,
			last_error: account.lastError ?? null,
			refresh_failures: account.refreshFailures ?? 0,
			rate_limit: this._bridge.rateLimit(account.id) ?? null,
			modified_at: modifiedAt,
		};
	}

	private async _accountByFilename(filename: string): Promise<SubscriptionAccount> {
		if (filename.startsWith(".trash/") || filename.includes("/") || filename.includes("..")) {
			throw ApiError.badRequest("订阅账号文件名无效");
		}
		const account = await this._accounts.findByFileName(filename);
		if (!account) {
			throw ApiError.notFound("订阅账号不存在");
		}
		return account;
	}

	private async _archivedFilenames(): Promise<Set<string>> {
		const names = await readdir(this._accounts.trashDir).catch(() => [] as string[]);
		return new Set(names.map((name) => name.replace(/^\d+-/, "")));
	}

	private async _loadSettings(): Promise<void> {
		if (this._settingsLoaded) {
			return;
		}
		const stored = await this._repository.getParam(SUBSCRIPTION_SETTINGS_PARAM);
		if (stored && typeof stored["enabled"] === "boolean") {
			this._settings = {
				enabled: stored["enabled"],
				config_yaml: typeof stored["config_yaml"] === "string" ? stored["config_yaml"] : "",
			};
		} else {
			const legacy = await importLegacyManagedConfig(this._accounts.authDir);
			if (legacy !== undefined) {
				this._settings = { enabled: true, config_yaml: legacy };
				await this._repository.upsertParam(SUBSCRIPTION_SETTINGS_PARAM, this._settings);
			}
		}
		this._settingsLoaded = true;
	}

	private async _projectManagedAccounts(): Promise<void> {
		await projectCommandCodeAccounts(this._accounts.authDir, extractManagedCommandCodeAccounts(this.userConfig));
		await projectSavedKeyAccounts(this._accounts.authDir, this._accountKeys);
	}

	private async _saveCommandCodeEntries(config: Record<string, unknown>, entries: Record<string, unknown>[]): Promise<void> {
		setManagedCommandCodeAccounts(config, entries);
		await this.saveSettings({ enabled: this._settings.enabled, config_yaml: serializeUserConfig(config) });
	}

	private async _refreshExpiringAccounts(): Promise<void> {
		for (const adapter of this._providers.list()) {
			let accounts: readonly SubscriptionAccount[];
			try {
				accounts = await this._accounts.list(adapter.source);
			} catch {
				continue;
			}
			for (const account of accounts) {
				if (account.disabled || this._refreshing.has(account.id)) {
					continue;
				}
				const now = Date.now();
				const lead = this._refreshLeadMs(account);
				const expiry = this._refreshExpiry(account);
				if (expiry !== undefined) {
					if (expiry - now > lead) {
						continue;
					}
				} else if (now - (this._lastBackgroundRefresh.get(account.id) ?? 0) < 30 * 60 * 1000) {
					// 没有到期字段的账号按较慢节奏刷新，避免每个 tick 都打 token 端点。
					continue;
				}
				this._lastBackgroundRefresh.set(account.id, now);
				this._refreshing.add(account.id);
				const refresh = adapter.auth.refreshForRequest
					? adapter.auth.refreshForRequest(account, {})
					: adapter.auth.refresh(account);
				void refresh
					.catch(async (error: unknown) => {
						if (isTerminalRefreshFailure(error)) {
							await disableInvalidAccount(this._accounts, account, error).catch(() => undefined);
							this.appendSystemLog(`账号凭据已失效，已自动禁用（${account.fileName}）：${messageOf(error)}`);
							return;
						}
						this.appendSystemLog(`凭据刷新失败（${account.fileName}）：${messageOf(error)}`);
					})
					.finally(() => this._refreshing.delete(account.id));
			}
		}
	}

	/**
	 * 该账号的后台刷新提前量。
	 * @param account - 账号
	 */
	private _refreshLeadMs(account: SubscriptionAccount): number {
		if (account.source === "codex") {
			return account.raw["use_siwc"] === true ? 5 * 60 * 1000 : 96 * 60 * 60 * 1000;
		}
		return 10 * 60 * 1000;
	}

	/**
	 * 计算后台刷新应参考的到期时间；Codex SIWC 需要看嵌套分区。
	 * @param account - 账号
	 */
	private _refreshExpiry(account: SubscriptionAccount): number | undefined {
		if (account.source === "codex" && account.raw["use_siwc"] === true) {
			const siwc = account.raw["siwc"];
			if (siwc && typeof siwc === "object" && !Array.isArray(siwc)) {
				const expiry = codexExpiryMs(siwc as Record<string, unknown>);
				if (expiry !== undefined) {
					return expiry;
				}
			}
		}
		return account.expiresAt;
	}

	private _oauthView(id: string): CliProxyOAuthSession {
		const entry = this._oauth.get(id);
		if (!entry) {
			throw ApiError.notFound("OAuth 会话不存在");
		}
		const state = entry.session.state === "success" ? "succeeded" : entry.session.state === "error" ? "failed" : "running";
		return {
			id: id,
			provider: entry.provider,
			state: state,
			started_at: entry.startedAt,
			finished_at: entry.finishedAt,
			exit_code: state === "succeeded" ? 0 : state === "failed" ? 1 : null,
			output: [...entry.session.output],
		};
	}

	private _pruneOAuth(): void {
		if (this._oauth.size <= 32) {
			return;
		}
		for (const [id, entry] of this._oauth) {
			if (entry.session.state !== "pending") {
				this._oauth.delete(id);
			}
			if (this._oauth.size <= 32) {
				return;
			}
		}
	}
}

/** 带设备码登录的扩展鉴权接口。 */
interface SubscriptionAuthHandlerWithDevice {
	startDeviceLogin?: () => Promise<SubscriptionLoginSession>;
}

/**
 * 登录来源到账号来源。
 * @param provider - 公开登录来源
 * @throws {ApiError} 不支持的 OAuth Provider
 */
function oauthSource(provider: CliProxyOAuthProvider): SubscriptionSource {
	switch (provider) {
		case "codex":
		case "codex-device":
			return "codex";
		case "claude":
			return "claude";
		case "antigravity":
			return "antigravity";
		case "kimi":
			return "kimi";
		case "xai":
			return "xai";
		default:
			throw ApiError.badRequest("不支持的 OAuth Provider");
	}
}

/**
 * 归一化 CommandCode 账户。
 * @param keyValue - API key
 * @param labelValue - label
 * @throws {ApiError} key 不是字符串或为空
 */
function normalizeCommandCodeAccount(keyValue: unknown, labelValue: unknown): ManagedCommandCodeAccount {
	if (typeof keyValue !== "string") {
		throw ApiError.badRequest("CommandCode API key 必须是字符串");
	}
	const apiKey = keyValue.trim();
	if (!apiKey || apiKey.length > 8_192 || [...apiKey].some((character) => character.charCodeAt(0) < 0x20)) {
		throw ApiError.badRequest("请填写有效的 CommandCode API key");
	}
	const label = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim() : "CommandCode";
	if (label.length > 256) {
		throw ApiError.badRequest("CommandCode 账户名称过长");
	}
	return { apiKey: apiKey, label: label };
}

/**
 * 读取 CommandCode 原始条目。
 * @param config - 用户配置
 */
function commandCodeEntries(config: Record<string, unknown>): Record<string, unknown>[] {
	const plugins = config["plugins"];
	if (!isPlainRecord(plugins)) {
		return [];
	}
	const managed = plugins["managed-accounts"];
	if (!isPlainRecord(managed)) {
		return [];
	}
	const raw = managed["commandcode"];
	if (Array.isArray(raw)) {
		return raw.filter(isPlainRecord).map((entry) => ({ ...entry }));
	}
	return isPlainRecord(raw) ? [{ ...raw }] : [];
}

/**
 * 普通对象判定。
 * @param value - 待判定值
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 错误转文本。
 * @param error - 错误
 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * 公开 provider 校验。
 * @param value - 待判定值
 * @throws {ApiError} 不是订阅 Provider
 */
export function assertSubscriptionProvider(value: string): SubscriptionProviderId {
	if (!isSubscriptionProvider(value)) {
		throw ApiError.notFound("未知订阅 Provider");
	}
	return value;
}
