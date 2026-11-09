<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiDialog from "../../platform/ui/UiDialog.vue";
import UiIcon from "../../platform/ui/UiIcon.vue";
import UiInput from "../../platform/ui/UiInput.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import UiTag from "../../platform/ui/UiTag.vue";
import type { UiTableActiveFilter, UiTableFilterChoice } from "../../platform/ui/UiTableFilterModels";
import type { UiTableColumn } from "../../platform/ui/UiTypes";
import { privacyKindLabel } from "../../content/logic/PrivacyPlaceholderLogic";
import {
	PRIVACY_ACTION_OPTIONS,
	PRIVACY_FEATURE_GROUPS,
	PRIVACY_KIND_ACTIONS,
	PRIVACY_RANGE_OPTIONS,
	PRIVACY_RULE_MODES,
	PRIVACY_RETENTION_OPTIONS,
	PRIVACY_SCOPE_CONSTRAINTS,
	PRIVACY_TABS,
	PRIVACY_WORD_LENGTHS,
	PRIVACY_WORD_LIMIT,
	privacyBlockedFeatureCount,
	privacyClientLabel,
	privacyCount,
	privacyDisabledFeatureCount,
	privacyKindAction,
	privacyProviderLabel,
	privacyRequestTableRow,
	privacyRuleFrom,
	privacyRuleLabel,
	privacyRuleSignature,
	privacyScopeSummary,
	privacyScopeWithAdded,
	privacyValueTableRow,
	privacyWordValues,
} from "../logic/PrivacyLogic";
import { createPrivacyStore } from "../stores/PrivacyStore";
import type { PrivacyRuleRow } from "../support/PrivacyModels";
import PrivacyBreakdownComponent from "./PrivacyBreakdownComponent.vue";
import "./PrivacyStyles.css";
defineOptions({ name: "PrivacyPageComponent" });
const store = createPrivacyStore(),
	state = store.state;
const summary = computed(() => state.overview?.summary ?? { occurrences: 0, distinctValues: 0, requests: 0, unresolved: 0 });
const rows = computed(() =>
	state.tab === "requests" ? state.requests.map(privacyRequestTableRow) : state.values.map(privacyValueTableRow),
);
/** 从概览分布生成筛选候选值。 */
function filterChoices(rows: ReadonlyArray<{ readonly name: string }>, label: (value: string) => string): UiTableFilterChoice[] {
	return rows.filter((row) => row.name.trim().length > 0).map((row) => ({ value: row.name, label: label(row.name) }));
}
const clientFilterOptions = computed(() => filterChoices(state.overview?.byClient ?? [], privacyClientLabel));
const providerFilterOptions = computed(() => filterChoices(state.overview?.byProvider ?? [], privacyProviderLabel));
const kindFilterOptions = computed(() => filterChoices(state.overview?.byKind ?? [], privacyKindLabel));
const actionFilterOptions: readonly UiTableFilterChoice[] = [
	{ value: "mask", label: "已替换" },
	{ value: "warn", label: "仅记录" },
];
const requestColumns = computed<readonly UiTableColumn[]>(() => [
	{ key: "created", label: "时间", width: 168, sortable: true, initialSortOrder: "desc" },
	{
		key: "client",
		label: "客户端",
		width: 120,
		sortable: true,
		filters: [{ key: "client", label: "客户端", control: { kind: "select", options: clientFilterOptions.value, searchable: true } }],
	},
	{
		key: "provider",
		label: "提供方",
		width: 132,
		sortable: true,
		filters: [
			{ key: "provider", label: "提供方", control: { kind: "select", options: providerFilterOptions.value, searchable: true } },
		],
	},
	{
		key: "model",
		label: "模型",
		width: 180,
		ellipsis: true,
		sortable: true,
		filters: [{ key: "model", label: "模型", control: { kind: "text", placeholder: "包含…" } }],
	},
	{
		key: "kinds",
		label: "类型",
		width: 220,
		filters: [{ key: "kind", label: "类型", control: { kind: "select", options: kindFilterOptions.value, searchable: true } }],
	},
	{ key: "occurrences", label: "处数", width: 88, align: "right", sortable: true, initialSortOrder: "desc" },
	{ key: "values", label: "值数", width: 88, align: "right", sortable: true, initialSortOrder: "desc" },
	{
		key: "action",
		label: "处置",
		width: 96,
		sortable: true,
		filters: [{ key: "action", label: "处置", control: { kind: "select", options: actionFilterOptions } }],
	},
]);
const valueColumns = computed<readonly UiTableColumn[]>(() => [
	{
		key: "kind",
		label: "类型",
		width: 132,
		sortable: true,
		filters: [{ key: "kind", label: "类型", control: { kind: "select", options: kindFilterOptions.value, searchable: true } }],
	},
	{ key: "hint", label: "提示", width: 200, sortable: true },
	{ key: "occurrences", label: "出现次数", width: 108, align: "right", sortable: true, initialSortOrder: "desc" },
	{ key: "requests", label: "请求数", width: 96, align: "right", sortable: true, initialSortOrder: "desc" },
	{
		key: "clients",
		label: "客户端",
		width: 168,
		sortable: true,
		filters: [{ key: "client", label: "客户端", control: { kind: "select", options: clientFilterOptions.value, searchable: true } }],
	},
	{ key: "lastSeen", label: "最近出现", width: 168, sortable: true, initialSortOrder: "desc" },
]);
const columns = computed(() => (state.tab === "requests" ? requestColumns.value : valueColumns.value));
const activeFilters = computed<readonly UiTableActiveFilter[]>(() =>
	state.tab === "requests" ? state.requestFilters : state.valueFilters,
);
const sort = computed(() => (state.tab === "requests" ? state.requestSort : state.valueSort));
const empty = computed(() => (state.tab === "requests" ? "所选区间内没有发生脱敏的请求" : "所选区间内没有脱敏值"));
const exhausted = computed(() => (state.tab === "requests" ? state.requestsExhausted : state.valuesExhausted));
const maskingOff = computed(() => state.settings !== null && !state.settings.enabled);
/** 展示用的占位符样例（模板里不能直接写双花括号字面量）。 */
const samplePlaceholder = "{{EMAIL_abcd2fgh}}";
/** 设置对话框是否打开 */
const settingsOpen = ref(false);
const customWordDraft = ref("");
const neverMaskDraft = ref("");
const ruleKindDraft = ref("");
const ruleModeDraft = ref("prefix");
const ruleExpressionDraft = ref("");
const customWords = computed(() => privacyWordValues(state.settings?.customWords ?? []));
const neverMask = computed(() => [...(state.settings?.neverMask ?? [])]);
const rules = computed(() => [...(state.settings?.rules ?? [])]);
const providerDraft = ref("");
const modelDraft = ref("");
const scopeProviders = computed(() => state.settings?.providers ?? []);
const scopeModels = computed(() => state.settings?.models ?? []);
const canAddProvider = computed(
	() =>
		state.settings !== null &&
		!state.saving &&
		privacyScopeWithAdded(scopeProviders.value, providerDraft.value) !== scopeProviders.value,
);
const canAddModel = computed(
	() => state.settings !== null && !state.saving && privacyScopeWithAdded(scopeModels.value, modelDraft.value) !== scopeModels.value,
);

/**
 * 提交一个生效提供方。
 */
async function submitProvider(): Promise<void> {
	if (!canAddProvider.value) return;
	const value = providerDraft.value;
	providerDraft.value = "";
	await store.addProvider(value);
}

/**
 * 提交一个生效模型。
 */
async function submitModel(): Promise<void> {
	if (!canAddModel.value) return;
	const value = modelDraft.value;
	modelDraft.value = "";
	await store.addModel(value);
}

const canAddCustomWord = computed(
	() =>
		state.settings !== null &&
		!state.saving &&
		customWords.value.length < PRIVACY_WORD_LIMIT &&
		customWordDraft.value.trim().length >= PRIVACY_WORD_LENGTHS.custom,
);
const canAddRule = computed(
	() =>
		state.settings !== null &&
		!state.saving &&
		privacyRuleFrom(ruleKindDraft.value, ruleModeDraft.value === "regex" ? "regex" : "prefix", ruleExpressionDraft.value) !== null,
);
const canAddNeverMask = computed(
	() =>
		state.settings !== null &&
		!state.saving &&
		neverMask.value.length < PRIVACY_WORD_LIMIT &&
		neverMaskDraft.value.trim().length >= PRIVACY_WORD_LENGTHS.allowlist,
);

/**
 * 提交自定义词条输入框。
 */
async function submitCustomWord(): Promise<void> {
	if (!canAddCustomWord.value) return;
	const value = customWordDraft.value;
	customWordDraft.value = "";
	await store.addCustomWord(value);
}

/**
 * 提交白名单输入框。
 */
async function submitRule(): Promise<void> {
	if (!canAddRule.value) return;
	const kind = ruleKindDraft.value;
	const mode = ruleModeDraft.value === "regex" ? "regex" : "prefix";
	const expression = ruleExpressionDraft.value;
	ruleExpressionDraft.value = "";
	await store.addRule(kind, mode, expression);
}

async function removeRule(rule: PrivacyRuleRow): Promise<void> {
	await store.removeRule(rule);
}

async function submitNeverMask(): Promise<void> {
	if (!canAddNeverMask.value) return;
	const value = neverMaskDraft.value;
	neverMaskDraft.value = "";
	await store.addNeverMask(value);
}
onMounted(store.initialize);
onBeforeUnmount(store.dispose);
</script>
<template>
	<div class="privacy-page">
		<div class="privacy-header">
			<div>
				<h1>脱敏</h1>
				<p>
					网关在请求发往上游之前，把密钥、口令、邮箱、手机号、证件号、银行卡号等敏感值替换成
					<span class="privacy-token" title="已脱敏占位符：这是占位符，不是原文。">{{ samplePlaceholder }}</span>
					这样的确定性占位符；响应回到客户端时再还原成原文。占位符带虚线底色，出现在日志、会话和 JSON
					视图里时都不是真实内容。本页只保存处数、值指纹（不可逆的 8 位哈希）、长度和前 3 个字符，不保存原文，也不提供原文对照。
				</p>
			</div>
			<div class="privacy-header__controls">
				<UiButton size="small" aria-label="打开脱敏设置" @click="settingsOpen = true">
					<template #icon><UiIcon name="SettingOutlined" :size="14" /></template>
					设置
				</UiButton>
				<label class="privacy-switch">
					<UiSwitch
						:model-value="state.settings?.enabled ?? true"
						:loading="state.saving"
						:disabled="state.settings === null"
						label="脱敏保护"
						@update:model-value="store.setEnabled"
					/>
					<span>{{ state.settings?.enabled === false ? "脱敏已关闭" : "脱敏保护已开启" }}</span>
				</label>
				<UiSelect
					:model-value="state.rangeDays"
					:options="PRIVACY_RANGE_OPTIONS"
					aria-label="统计区间"
					@update:model-value="store.setRange(Number($event))"
				/>
			</div>
		</div>

		<UiAlert v-if="maskingOff" type="warning" title="脱敏已关闭">
			当前所有请求都会原样转发给上游，日志与会话里可能直接出现密钥、邮箱、手机号等原文。重新打开开关后从下一个请求开始生效。
		</UiAlert>
		<UiAlert v-if="summary.unresolved > 0" type="warning" title="有占位符未能还原">
			本次统计区间内有 {{ privacyCount(summary.unresolved) }}
			处占位符没有对应的原文可还原（通常是客户端提前断开、或占位符被上游改写）。这些位置会保留占位符原文返回给客户端。
		</UiAlert>
		<UiAlert v-if="state.error" type="error" title="加载脱敏数据失败">{{ state.error.message || "请稍后重试" }}</UiAlert>

		<div class="privacy-kpis">
			<UiCard class="privacy-kpi">
				<div class="privacy-kpi__label">已替换</div>
				<div class="privacy-kpi__value">{{ privacyCount(summary.occurrences) }}</div>
				<div class="privacy-kpi__hint">处敏感内容 · 所选区间</div>
			</UiCard>
			<UiCard class="privacy-kpi">
				<div class="privacy-kpi__label">不同的值</div>
				<div class="privacy-kpi__value">{{ privacyCount(summary.distinctValues) }}</div>
				<div class="privacy-kpi__hint">按「类型 + 指纹」去重</div>
			</UiCard>
			<UiCard class="privacy-kpi">
				<div class="privacy-kpi__label">涉及请求</div>
				<div class="privacy-kpi__value">{{ privacyCount(summary.requests) }}</div>
				<div class="privacy-kpi__hint">只统计真正命中敏感内容的请求</div>
			</UiCard>
			<UiCard class="privacy-kpi" :class="{ 'privacy-kpi--warn': summary.unresolved > 0 }">
				<div class="privacy-kpi__label">未还原占位符</div>
				<div class="privacy-kpi__value">{{ privacyCount(summary.unresolved) }}</div>
				<div class="privacy-kpi__hint">正常情况下应为 0</div>
			</UiCard>
		</div>

		<div v-if="state.loading && state.overview === null" class="privacy-loading">
			<UiSpinner />
			<p>正在加载脱敏统计…</p>
		</div>

		<template v-else-if="state.overview">
			<div class="privacy-breakdowns">
				<UiCard title="按客户端">
					<PrivacyBreakdownComponent
						dimension="client"
						:rows="state.overview.byClient"
						empty-text="所选区间内没有可归因到客户端的脱敏请求"
					/>
				</UiCard>
				<UiCard title="按提供方">
					<PrivacyBreakdownComponent dimension="provider" :rows="state.overview.byProvider" empty-text="所选区间内没有脱敏请求" />
				</UiCard>
				<UiCard title="按类型">
					<PrivacyBreakdownComponent dimension="kind" :rows="state.overview.byKind" empty-text="所选区间内没有识别到敏感内容" />
				</UiCard>
			</div>

			<UiCard class="privacy-details">
				<div class="privacy-details__head">
					<UiTabs :model-value="state.tab" :items="PRIVACY_TABS" aria-label="明细视图" @update:model-value="store.setTab" />
					<span class="privacy-details__count">已加载 {{ privacyCount(rows.length) }} 条</span>
				</div>
				<UiTable
					:columns="columns"
					:rows="rows"
					row-key="id"
					:loading="state.loading"
					:empty-text="empty"
					:min-width="state.tab === 'requests' ? 1080 : 880"
					:body-max-height="520"
					:sort-by="sort.key"
					:sort-order="sort.order"
					:active-filters="activeFilters"
					manual-sort
					fixed-layout
					sticky-header
					@sort="store.setSort"
					@filter-change="store.applyFilters"
					@remove-filter="store.removeFilter"
					@clear-filters="store.clearFilters"
				/>
				<div v-if="!exhausted && rows.length > 0" class="privacy-more">
					<UiButton :loading="state.loadingMore" @click="store.loadMore">加载更多</UiButton>
				</div>
			</UiCard>

			<p class="privacy-footnote">
				统计只保留派生信息，默认保留 {{ state.settings?.retentionDays ?? 30 }} 天；值以
				<strong>类型 + 8 位指纹</strong>
				归并，指纹由本机密钥派生，无法反推原文。需要临时查看某个密钥的原文时，请使用该密钥自己的管理入口，本页不提供原文。
			</p>
		</template>
		<UiDialog v-model:open="settingsOpen" class="privacy-settings-dialog" title="脱敏设置" :width="880" aria-label="脱敏设置">
			<div class="privacy-dialog">
				<section class="privacy-dialog__section">
					<div class="privacy-features__head">
						<div>
							<h2>生效范围</h2>
							<p>
								只对最终发往上游的提供方与模型生效：路由、重试与 fallback
								之后按实际去向判定。留空表示不限，条目按包含匹配（写
								<code>opencode</code> 可命中 <code>opencode-go</code>）。
							</p>
						</div>
						<span class="privacy-features__summary">{{
							privacyScopeSummary(state.settings?.providers ?? [], state.settings?.models ?? [])
						}}</span>
					</div>
					<div class="privacy-setting-row privacy-setting-row--stack">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">提供方</span>
							<span class="privacy-feature-row__desc">
								匹配 provider 标识或上游模型里的插件段，例如 opencode、cliproxy、deepseek；最多
								{{ PRIVACY_SCOPE_CONSTRAINTS.maxCount }} 条
							</span>
						</div>
						<div class="privacy-words">
							<div class="privacy-words__add">
								<UiInput
									v-model="providerDraft"
									size="small"
									placeholder="输入提供方后回车"
									:disabled="state.settings === null || state.saving"
									@keydown.enter.prevent="submitProvider"
								/>
								<UiButton size="small" :disabled="!canAddProvider" @click="submitProvider">添加</UiButton>
							</div>
							<div v-if="scopeProviders.length" class="privacy-words__list">
								<UiTag
									v-for="provider in scopeProviders"
									:key="provider"
									closable
									@close="store.removeProvider(provider)"
									>{{ provider }}</UiTag
								>
							</div>
							<p v-else class="privacy-words__empty">不限提供方</p>
						</div>
					</div>
					<div class="privacy-setting-row privacy-setting-row--stack">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">模型</span>
							<span class="privacy-feature-row__desc">
								匹配模型组名或上游模型串，例如 opencode-go/deepseek-v4.1-flash；两个列表都填时需同时命中
							</span>
						</div>
						<div class="privacy-words">
							<div class="privacy-words__add">
								<UiInput
									v-model="modelDraft"
									size="small"
									placeholder="输入模型后回车"
									:disabled="state.settings === null || state.saving"
									@keydown.enter.prevent="submitModel"
								/>
								<UiButton size="small" :disabled="!canAddModel" @click="submitModel">添加</UiButton>
							</div>
							<div v-if="scopeModels.length" class="privacy-words__list">
								<UiTag v-for="model in scopeModels" :key="model" closable @close="store.removeModel(model)">{{
									model
								}}</UiTag>
							</div>
							<p v-else class="privacy-words__empty">不限模型</p>
						</div>
					</div>
				</section>
				<section class="privacy-dialog__section">
					<div class="privacy-features__head">
						<div>
							<h2>过滤特性</h2>
							<p>逐项决定哪一类内容在发往上游之前被替换成占位符。「仅统计」只计数不替换，「关闭」完全不识别也不计数。</p>
						</div>
						<span class="privacy-features__summary">
							{{ privacyDisabledFeatureCount(state.settings?.kinds ?? {}) }} 项未在替换<template
								v-if="privacyBlockedFeatureCount(state.settings?.kinds ?? {}) > 0"
								>，{{ privacyBlockedFeatureCount(state.settings?.kinds ?? {}) }} 项会拒绝请求</template
							>
						</span>
					</div>
					<div v-for="group in PRIVACY_FEATURE_GROUPS" :key="group.title" class="privacy-feature-group">
						<div class="privacy-feature-group__title">
							{{ group.title }}
							<span class="privacy-feature-group__note">{{ group.note }}</span>
						</div>
						<div v-for="feature in group.features" :key="feature.kind" class="privacy-feature-row">
							<div class="privacy-feature-row__label">
								<span class="privacy-feature-row__name">{{ privacyKindLabel(feature.kind) }}</span>
								<span class="privacy-feature-row__desc">{{ feature.description }}</span>
							</div>
							<UiSelect
								:model-value="state.settings ? privacyKindAction(state.settings.kinds, feature.kind) : 'mask'"
								:options="PRIVACY_KIND_ACTIONS"
								:disabled="state.settings === null || state.saving"
								size="small"
								:aria-label="privacyKindLabel(feature.kind) + ' 的处置'"
								@update:model-value="store.setKindAction(feature.kind, String($event))"
							/>
						</div>
					</div>
					<div class="privacy-feature-row privacy-feature-row--switch">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">网关自身配置的凭据</span>
							<span class="privacy-feature-row__desc">精确匹配本网关配置里的 provider 密钥等，命中后整段替换</span>
						</div>
						<UiSwitch
							:model-value="state.settings?.maskConfiguredSecrets ?? true"
							:disabled="state.settings === null || state.saving"
							label="脱敏网关凭据"
							@update:model-value="store.setMaskConfiguredSecrets"
						/>
					</div>
				</section>
				<section class="privacy-dialog__section">
					<div class="privacy-features__head">
						<div>
							<h2>策略与保留</h2>
							<p>没有单独指定的类型按全局处置处理；白名单里的值一律不替换；统计只保存类型、指纹、长度和前 3 个字符。</p>
						</div>
					</div>
					<div class="privacy-setting-row">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">全局处置</span>
							<span class="privacy-feature-row__desc">某一类没有单独指定时，按这里的处置执行</span>
						</div>
						<UiSelect
							:model-value="state.settings?.action ?? 'mask'"
							:options="PRIVACY_ACTION_OPTIONS"
							:disabled="state.settings === null || state.saving"
							size="small"
							aria-label="全局处置"
							@update:model-value="store.setAction(String($event))"
						/>
					</div>
					<div class="privacy-setting-row privacy-setting-row--stack">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">自定义词条</span>
							<span class="privacy-feature-row__desc">
								管理员维护的敏感词，命中后按自定义类型替换；不分大小写，最多 {{ PRIVACY_WORD_LIMIT }} 条，每条 2-256 个字符
							</span>
						</div>
						<div class="privacy-words">
							<div class="privacy-words__add">
								<UiInput
									v-model="customWordDraft"
									size="small"
									placeholder="输入词条后回车"
									:disabled="state.settings === null || state.saving"
									@keydown.enter.prevent="submitCustomWord"
								/>
								<UiButton size="small" :disabled="!canAddCustomWord" @click="submitCustomWord">添加</UiButton>
							</div>
							<div v-if="customWords.length" class="privacy-words__list">
								<UiTag v-for="word in customWords" :key="word" closable @close="store.removeCustomWord(word)">{{
									word
								}}</UiTag>
							</div>
							<p v-else class="privacy-words__empty">还没有自定义词条</p>
						</div>
					</div>
					<div class="privacy-setting-row privacy-setting-row--stack">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">白名单</span>
							<span class="privacy-feature-row__desc">
								这些值永远不替换（例如公司域名、内网主机名）；不分大小写，最多 {{ PRIVACY_WORD_LIMIT }} 条
							</span>
						</div>
						<div class="privacy-words">
							<div class="privacy-words__add">
								<UiInput
									v-model="neverMaskDraft"
									size="small"
									placeholder="输入不脱敏的值后回车"
									:disabled="state.settings === null || state.saving"
									@keydown.enter.prevent="submitNeverMask"
								/>
								<UiButton size="small" :disabled="!canAddNeverMask" @click="submitNeverMask">添加</UiButton>
							</div>
							<div v-if="neverMask.length" class="privacy-words__list">
								<UiTag v-for="word in neverMask" :key="word" closable @close="store.removeNeverMask(word)">{{
									word
								}}</UiTag>
							</div>
							<p v-else class="privacy-words__empty">白名单为空</p>
						</div>
					</div>
					<div class="privacy-setting-row privacy-setting-row--stack">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">用户规则</span>
							<span class="privacy-feature-row__desc">
								按前缀或正则识别自定义格式，命中后按你指定的类型替换（例如 ACME- 开头的工单号）；最多 50 条
							</span>
						</div>
						<div class="privacy-words">
							<div class="privacy-words__add privacy-words__add--rule">
								<UiInput
									v-model="ruleKindDraft"
									size="small"
									placeholder="类型，如 TICKET"
									:disabled="state.settings === null || state.saving"
									@keydown.enter.prevent="submitRule"
								/>
								<UiSelect
									:model-value="ruleModeDraft"
									:options="PRIVACY_RULE_MODES"
									:disabled="state.settings === null || state.saving"
									size="small"
									aria-label="规则的匹配方式"
									@update:model-value="ruleModeDraft = String($event)"
								/>
								<UiInput
									v-model="ruleExpressionDraft"
									size="small"
									:placeholder="ruleModeDraft === 'regex' ? '正则，如 org_[a-z0-9]{12}' : '前缀，如 ACME-'"
									:disabled="state.settings === null || state.saving"
									@keydown.enter.prevent="submitRule"
								/>
								<UiButton size="small" :disabled="!canAddRule" @click="submitRule">添加</UiButton>
							</div>
							<div v-if="rules.length" class="privacy-words__list">
								<UiTag v-for="rule in rules" :key="privacyRuleSignature(rule)" closable @close="removeRule(rule)">{{
									privacyRuleLabel(rule)
								}}</UiTag>
							</div>
							<p v-else class="privacy-words__empty">还没有自定义规则</p>
						</div>
					</div>
					<div class="privacy-setting-row">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">凭据换同形态假值</span>
							<span class="privacy-feature-row__desc">
								开启后密钥、令牌类不再写成占位符，而是换成长度与字符类别相同的假值，避免上游校验值格式时判错
							</span>
						</div>
						<UiSwitch
							:model-value="state.settings?.shape ?? false"
							:disabled="state.settings === null || state.saving"
							label="凭据换同形态假值"
							@update:model-value="store.setShape"
						/>
					</div>
					<div class="privacy-setting-row">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">脱敏失败时拒绝请求</span>
							<span class="privacy-feature-row__desc">
								开启时，识别或替换出错会直接拒绝请求；关闭时按原文转发并在日志里记一次失败
							</span>
						</div>
						<UiSwitch
							:model-value="state.settings?.failClosed ?? true"
							:disabled="state.settings === null || state.saving"
							label="脱敏失败时拒绝请求"
							@update:model-value="store.setFailClosed"
						/>
					</div>
					<div class="privacy-setting-row">
						<div class="privacy-feature-row__label">
							<span class="privacy-feature-row__name">统计保留</span>
							<span class="privacy-feature-row__desc">超过保留期的明细会自动清理；概览按所选区间即时聚合</span>
						</div>
						<UiSelect
							:model-value="String(state.settings?.retentionDays ?? 30)"
							:options="PRIVACY_RETENTION_OPTIONS"
							:disabled="state.settings === null || state.saving"
							size="small"
							aria-label="统计保留天数"
							@update:model-value="store.setRetentionDays(Number($event))"
						/>
					</div>
				</section>
			</div>
			<template #footer><UiButton @click="settingsOpen = false">关闭</UiButton></template>
		</UiDialog>
	</div>
</template>
