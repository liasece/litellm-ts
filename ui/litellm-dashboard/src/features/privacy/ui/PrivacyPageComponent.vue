<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from "vue";
import UiAlert from "../../platform/ui/UiAlert.vue";
import UiButton from "../../platform/ui/UiButton.vue";
import UiCard from "../../platform/ui/UiCard.vue";
import UiSelect from "../../platform/ui/UiSelect.vue";
import UiSpinner from "../../platform/ui/UiSpinner.vue";
import UiSwitch from "../../platform/ui/UiSwitch.vue";
import UiTable from "../../platform/ui/UiTable.vue";
import UiTabs from "../../platform/ui/UiTabs.vue";
import type { UiTableColumn } from "../../platform/ui/UiTypes";
import { PRIVACY_RANGE_OPTIONS, PRIVACY_TABS, privacyCount, privacyRequestTableRow, privacyValueTableRow } from "../logic/PrivacyLogic";
import { createPrivacyStore } from "../stores/PrivacyStore";
import PrivacyBreakdownComponent from "./PrivacyBreakdownComponent.vue";
import "./PrivacyStyles.css";
defineOptions({ name: "PrivacyPageComponent" });
const store = createPrivacyStore(),
	state = store.state;
const summary = computed(() => state.overview?.summary ?? { occurrences: 0, distinctValues: 0, requests: 0, unresolved: 0 });
const rows = computed(() =>
	state.tab === "requests" ? state.requests.map(privacyRequestTableRow) : state.values.map(privacyValueTableRow),
);
const requestColumns: readonly UiTableColumn[] = [
	{ key: "created", label: "时间", width: 168 },
	{ key: "client", label: "客户端", width: 120 },
	{ key: "provider", label: "提供方", width: 132 },
	{ key: "model", label: "模型", width: 180, ellipsis: true },
	{ key: "kinds", label: "类型", width: 220 },
	{ key: "occurrences", label: "处数", width: 88, align: "right" },
	{ key: "values", label: "值数", width: 88, align: "right" },
	{ key: "action", label: "处置", width: 96 },
];
const valueColumns: readonly UiTableColumn[] = [
	{ key: "kind", label: "类型", width: 132 },
	{ key: "hint", label: "提示", width: 200 },
	{ key: "occurrences", label: "出现次数", width: 108, align: "right" },
	{ key: "requests", label: "请求数", width: 96, align: "right" },
	{ key: "clients", label: "客户端", width: 168 },
	{ key: "lastSeen", label: "最近出现", width: 168 },
];
const columns = computed(() => (state.tab === "requests" ? requestColumns : valueColumns));
const empty = computed(() => (state.tab === "requests" ? "所选区间内没有发生脱敏的请求" : "所选区间内没有脱敏值"));
const exhausted = computed(() => (state.tab === "requests" ? state.requestsExhausted : state.valuesExhausted));
const maskingOff = computed(() => state.settings !== null && !state.settings.enabled);
/** 展示用的占位符样例（模板里不能直接写双花括号字面量）。 */
const samplePlaceholder = "{{EMAIL_abcd2fgh}}";
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
					compact
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
	</div>
</template>
