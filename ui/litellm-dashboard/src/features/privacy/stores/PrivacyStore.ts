/** 脱敏页状态：区间切换、页签切换、分页与开关保存。 */
import { reactive } from "vue";
import { HttpApiError } from "../../platform/api/HttpApiClient";
import notificationManager from "../../notifications/logic/NotificationManager";
import type { UiTableActiveFilter } from "../../platform/ui/UiTableFilterModels";
import type { UiTableSort } from "../../platform/ui/UiTypes";
import { privacyApi } from "../api/PrivacyApi";
import {
	PRIVACY_PAGE_SIZE,
	PRIVACY_WORD_LENGTHS,
	privacyKindAction,
	privacyKindsWithAction,
	privacyRuleFrom,
	privacyRuleSignature,
	privacyRulesWithAdded,
	privacyRulesWithout,
	privacyScopeWithAdded,
	privacyScopeWithout,
	privacyWordValues,
	privacyWordsWithAdded,
	privacyWordsWithout,
} from "../logic/PrivacyLogic";
import type {
	PrivacyApi,
	PrivacyListQuery,
	PrivacyOverview,
	PrivacyRequestRow,
	PrivacyRuleRow,
	PrivacySettings,
	PrivacySettingsPatch,
	PrivacyValueRow,
} from "../support/PrivacyModels";

/**
 * 创建脱敏页 store。
 * @param api - 接口实现（测试可注入）
 */
export function createPrivacyStore(api: PrivacyApi = privacyApi) {
	const state = reactive({
		rangeDays: 7,
		tab: "requests",
		overview: null as PrivacyOverview | null,
		requests: [] as PrivacyRequestRow[],
		values: [] as PrivacyValueRow[],
		requestsExhausted: false,
		valuesExhausted: false,
		requestFilters: [] as UiTableActiveFilter[],
		valueFilters: [] as UiTableActiveFilter[],
		requestSort: { key: "created", order: "desc" as "asc" | "desc" },
		valueSort: { key: "occurrences", order: "desc" as "asc" | "desc" },
		settings: null as PrivacySettings | null,
		loading: true,
		loadingMore: false,
		saving: false,
		error: null as Error | null,
	});
	let generation = 0;
	let disposed = false;
	let controller: AbortController | null = null;

	/**
	 * 取当前页签的数据。
	 */
	function activeRows(): number {
		return state.tab === "requests" ? state.requests.length : state.values.length;
	}

	/**
	 * 是否还有更多。
	 */
	function exhausted(): boolean {
		return state.tab === "requests" ? state.requestsExhausted : state.valuesExhausted;
	}

	/**
	 * 记录错误。
	 * @param error - 原始错误
	 */
	function fail(error: unknown): void {
		if (error instanceof HttpApiError) {
			notificationManager.fromBackend(error.message);
		}
		state.error = error instanceof Error ? error : new Error(String(error));
		state.loading = false;
		state.loadingMore = false;
	}

	/**
	 * 当前页签的筛选条件。
	 */
	function currentFilters(): readonly UiTableActiveFilter[] {
		return state.tab === "requests" ? state.requestFilters : state.valueFilters;
	}

	/**
	 * 当前页签的排序。
	 */
	function currentSort(): { key: string; order: "asc" | "desc" } {
		return state.tab === "requests" ? state.requestSort : state.valueSort;
	}

	/**
	 * 读取当前页签某个筛选字段的值。
	 * @param key - 字段键
	 */
	function filterValue(key: string): string | undefined {
		const value = currentFilters()
			.find((filter) => filter.key === key)
			?.value.trim();
		return value ? value : undefined;
	}

	/**
	 * 组装服务端列表查询。
	 * @param offset - 偏移
	 */
	function listQuery(offset: number): PrivacyListQuery {
		const sort = currentSort();
		return {
			days: state.rangeDays,
			limit: PRIVACY_PAGE_SIZE,
			offset: offset,
			client: filterValue("client"),
			provider: filterValue("provider"),
			kind: filterValue("kind"),
			model: filterValue("model"),
			action: filterValue("action"),
			sort: sort.key,
			order: sort.order,
		};
	}

	/**
	 * 拉取当前页签的一页；offset 为 0 时替换列表，否则追加。
	 * @param offset - 偏移
	 * @param signal - 取消信号
	 * @param current - 请求代次
	 */
	async function fetchActivePage(offset: number, current: number, signal?: AbortSignal): Promise<void> {
		const query = listQuery(offset);
		if (state.tab === "requests") {
			const page = await api.requests(query, signal);
			if (disposed || current !== generation) return;
			state.requests = offset === 0 ? [...page.rows] : [...state.requests, ...page.rows];
			state.requestsExhausted = !page.hasMore;
		} else {
			const page = await api.values(query, signal);
			if (disposed || current !== generation) return;
			state.values = offset === 0 ? [...page.rows] : [...state.values, ...page.rows];
			state.valuesExhausted = !page.hasMore;
		}
	}

	/**
	 * 拉取概览与当前页签的首页数据。
	 */
	async function load(): Promise<void> {
		const current = ++generation;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		state.loading = state.overview === null;
		state.error = null;
		try {
			const [overview, settings] = await Promise.all([api.overview(state.rangeDays, request.signal), api.settings(request.signal)]);
			if (disposed || current !== generation) return;
			state.overview = overview;
			state.settings = settings;
			await fetchActivePage(0, current, request.signal);
			state.loading = false;
		} catch (error: unknown) {
			if (disposed || current !== generation || request.signal.aborted) return;
			fail(error);
		} finally {
			if (controller === request) controller = null;
		}
	}

	/**
	 * 追加下一页。
	 */
	async function loadMore(): Promise<void> {
		if (state.loading || state.loadingMore || exhausted()) return;
		const current = generation;
		state.loadingMore = true;
		try {
			await fetchActivePage(activeRows(), current);
		} catch (error: unknown) {
			if (disposed || current !== generation) return;
			fail(error);
		} finally {
			if (!disposed && current === generation) state.loadingMore = false;
		}
	}

	/**
	 * 清空当前页签的列表与「已加载完」状态。
	 */
	function resetActiveRows(): void {
		if (state.tab === "requests") {
			state.requests = [];
			state.requestsExhausted = false;
		} else {
			state.values = [];
			state.valuesExhausted = false;
		}
	}

	/**
	 * 筛选或排序变化后，从第一页重新加载当前页签。
	 */
	async function reloadList(): Promise<void> {
		const current = ++generation;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		state.loading = true;
		state.error = null;
		try {
			await fetchActivePage(0, current, request.signal);
			if (disposed || current !== generation) return;
			state.loading = false;
		} catch (error: unknown) {
			if (disposed || current !== generation || request.signal.aborted) return;
			fail(error);
		} finally {
			if (controller === request) controller = null;
		}
	}

	/**
	 * 合并一列表头发来的筛选条件；同名字段以新值为准，空值表示移除。
	 * @param entries - 表头筛选结果
	 */
	function applyFilters(entries: readonly UiTableActiveFilter[]): void {
		const current = state.tab === "requests" ? state.requestFilters : state.valueFilters;
		const next = current.filter((filter) => !entries.some((entry) => entry.key === filter.key));
		for (const entry of entries) {
			const value = entry.value.trim();
			if (value) next.push({ ...entry, value: value, text: entry.text.trim() || value });
		}
		if (state.tab === "requests") state.requestFilters = next;
		else state.valueFilters = next;
		resetActiveRows();
		void reloadList();
	}

	/**
	 * 移除一个表头筛选条件。
	 * @param key - 字段键
	 */
	function removeFilter(key: string): void {
		if (state.tab === "requests") state.requestFilters = state.requestFilters.filter((filter) => filter.key !== key);
		else state.valueFilters = state.valueFilters.filter((filter) => filter.key !== key);
		resetActiveRows();
		void reloadList();
	}

	/**
	 * 清空当前页签的筛选条件。
	 */
	function clearFilters(): void {
		if (state.tab === "requests") state.requestFilters = [];
		else state.valueFilters = [];
		resetActiveRows();
		void reloadList();
	}

	/**
	 * 更新当前页签排序；取消排序时回到该列表的默认顺序。
	 * @param sort - 表头排序状态
	 */
	function setSort(sort: UiTableSort): void {
		const fallback = state.tab === "requests" ? "created" : "occurrences";
		const next: { key: string; order: "asc" | "desc" } = {
			key: sort.order ? sort.key : fallback,
			order: sort.order ?? "desc",
		};
		const current = currentSort();
		if (current.key === next.key && current.order === next.order) return;
		if (state.tab === "requests") state.requestSort = next;
		else state.valueSort = next;
		resetActiveRows();
		void reloadList();
	}

	/**
	 * 切换统计区间。
	 * @param days - 天数
	 */
	function setRange(days: number): void {
		if (state.rangeDays === days) return;
		state.rangeDays = days;
		state.requests = [];
		state.values = [];
		state.requestsExhausted = false;
		state.valuesExhausted = false;
		void load();
	}

	/**
	 * 切换明细页签。
	 * @param key - 页签键
	 */
	function setTab(key: string): void {
		if (state.tab === key) return;
		state.tab = key;
		const empty = key === "requests" ? state.requests.length === 0 : state.values.length === 0;
		if (!empty) return;
		if (state.overview === null) void load();
		else void reloadList();
	}

	/**
	 * 保存配置补丁：成功后用返回值替换本地快照，失败时回滚到保存前的配置。
	 * @param patch - 要写入的配置
	 */
	async function savePatch(patch: PrivacySettingsPatch): Promise<void> {
		if (state.saving || state.settings === null) return;
		const previous = state.settings;
		state.saving = true;
		try {
			const settings = await api.updateSettings(patch);
			if (disposed) return;
			state.settings = settings;
			state.error = null;
		} catch (error: unknown) {
			if (disposed) return;
			if (error instanceof HttpApiError) {
				notificationManager.fromBackend(error.message);
			}
			state.settings = previous;
			state.error = error instanceof Error ? error : new Error(String(error));
		} finally {
			if (!disposed) state.saving = false;
		}
	}

	/**
	 * 打开或关闭脱敏。
	 * @param enabled - 是否开启
	 */
	async function setEnabled(enabled: boolean): Promise<void> {
		if (state.settings === null || state.settings.enabled === enabled) return;
		await savePatch({ enabled: enabled });
	}

	/**
	 * 设置单个过滤特性的处置。
	 * @param kind - 类型标识
	 * @param action - 替换 / 仅统计 / 关闭
	 */
	async function setKindAction(kind: string, action: string): Promise<void> {
		if (state.settings === null || privacyKindAction(state.settings.kinds, kind) === action) return;
		await savePatch({ kinds: privacyKindsWithAction(state.settings.kinds, kind, action) });
	}

	/**
	 * 打开或关闭「网关自身配置的凭据」精确匹配。
	 * @param enabled - 是否开启
	 */
	async function setMaskConfiguredSecrets(enabled: boolean): Promise<void> {
		if (state.settings === null || state.settings.maskConfiguredSecrets === enabled) return;
		await savePatch({ mask_configured_secrets: enabled });
	}

	/**
	 * 设置全局处置（某一类没有单独指定时使用）。
	 * @param action - 替换 / 仅统计
	 */
	async function setAction(action: string): Promise<void> {
		if (state.settings === null || state.settings.action === action) return;
		if (action !== "mask" && action !== "warn") return;
		await savePatch({ action: action });
	}

	/**
	 * 设置脱敏异常时的处置。
	 * @param enabled - true 表示拒绝请求
	 */
	async function setFailClosed(enabled: boolean): Promise<void> {
		if (state.settings === null || state.settings.failClosed === enabled) return;
		await savePatch({ fail_closed: enabled });
	}

	/**
	 * 设置统计保留天数。
	 * @param days - 天数
	 */
	async function setRetentionDays(days: number): Promise<void> {
		if (state.settings === null || state.settings.retentionDays === days) return;
		if (!Number.isFinite(days) || days < 1 || days > 365) return;
		await savePatch({ retention_days: Math.round(days) });
	}

	/**
	 * 追加一个自定义词条。
	 * @param value - 词条内容
	 */
	async function addCustomWord(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = privacyWordValues(state.settings.customWords);
		const next = privacyWordsWithAdded(current, value, PRIVACY_WORD_LENGTHS.custom);
		if (next === current) return;
		await savePatch({ custom_words: next });
	}

	/**
	 * 移除一个自定义词条。
	 * @param value - 词条内容
	 */
	async function removeCustomWord(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = privacyWordValues(state.settings.customWords);
		const next = privacyWordsWithout(current, value);
		if (next === current) return;
		await savePatch({ custom_words: next });
	}

	/**
	 * 追加一个白名单值。
	 * @param value - 值内容
	 */
	async function addNeverMask(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = [...state.settings.neverMask];
		const next = privacyWordsWithAdded(current, value, PRIVACY_WORD_LENGTHS.allowlist);
		if (next === current) return;
		await savePatch({ never_mask: next });
	}

	/**
	 * 移除一个白名单值。
	 * @param value - 值内容
	 */
	async function removeNeverMask(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = [...state.settings.neverMask];
		const next = privacyWordsWithout(current, value);
		if (next === current) return;
		await savePatch({ never_mask: next });
	}

	/**
	 * 打开或关闭「凭据类用同形态假值替换」。
	 * @param enabled - 是否开启
	 */
	async function setShape(enabled: boolean): Promise<void> {
		if (state.settings === null || state.settings.shape === enabled) return;
		await savePatch({ shape: enabled });
	}

	/**
	 * 追加一条用户规则；校验不通过或重复时忽略。
	 * @param kind - 类型名
	 * @param mode - 匹配方式
	 * @param expression - 前缀或正则
	 */
	async function addRule(kind: string, mode: "prefix" | "regex", expression: string): Promise<void> {
		if (state.settings === null) return;
		const rule = privacyRuleFrom(kind, mode, expression);
		if (rule === null) return;
		const next = privacyRulesWithAdded(state.settings.rules, rule);
		if (next === state.settings.rules) return;
		await savePatch({ rules: next });
	}

	/**
	 * 追加一个生效提供方。
	 * @param value - 提供方标识（可以是子串，如 opencode）
	 */
	async function addProvider(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = state.settings.providers;
		const next = privacyScopeWithAdded(current, value);
		if (next === current) return;
		await savePatch({ providers: next });
	}

	/**
	 * 移除一个生效提供方。
	 * @param value - 提供方标识
	 */
	async function removeProvider(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = state.settings.providers;
		const next = privacyScopeWithout(current, value);
		if (next === current) return;
		await savePatch({ providers: next });
	}

	/**
	 * 追加一个生效模型。
	 * @param value - 模型标识（模型组名或上游模型串的子串）
	 */
	async function addModel(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = state.settings.models;
		const next = privacyScopeWithAdded(current, value);
		if (next === current) return;
		await savePatch({ models: next });
	}

	/**
	 * 移除一个生效模型。
	 * @param value - 模型标识
	 */
	async function removeModel(value: string): Promise<void> {
		if (state.settings === null) return;
		const current = state.settings.models;
		const next = privacyScopeWithout(current, value);
		if (next === current) return;
		await savePatch({ models: next });
	}

	/**
	 * 删除一条用户规则。
	 * @param rule - 规则
	 */
	async function removeRule(rule: PrivacyRuleRow): Promise<void> {
		if (state.settings === null) return;
		const next = privacyRulesWithout(state.settings.rules, privacyRuleSignature(rule));
		if (next === state.settings.rules) return;
		await savePatch({ rules: next });
	}

	/**
	 * 组件挂载时调用。
	 */
	function initialize(): void {
		if (disposed) return;
		void load();
	}

	/**
	 * 组件卸载时调用。
	 */
	function dispose(): void {
		disposed = true;
		generation++;
		controller?.abort();
	}

	return {
		state,
		initialize,
		dispose,
		load,
		loadMore,
		setRange,
		setTab,
		applyFilters,
		removeFilter,
		clearFilters,
		setSort,
		setEnabled,
		setKindAction,
		setMaskConfiguredSecrets,
		setAction,
		setFailClosed,
		setRetentionDays,
		addCustomWord,
		removeCustomWord,
		addNeverMask,
		removeNeverMask,
		setShape,
		addRule,
		removeRule,
		addProvider,
		removeProvider,
		addModel,
		removeModel,
	};
}
