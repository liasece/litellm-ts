<script setup lang="ts">
import UiLucideIcon from "../../../platform/ui/UiLucideIcon.vue";
import type { UsageQuotaMetrics } from "../support/ApplicationUsageModels";
import { usageTone } from "../logic/ApplicationUsageLogic";
defineProps<{ kind: "users" | "teams"; total: number | null; used: number; remaining: number | null; metrics: UsageQuotaMetrics }>();
</script>
<template>
	<section :class="['application-usage-quota', 'tone-' + usageTone(metrics)]">
		<header>
			<UiLucideIcon :name="kind === 'users' ? 'Users' : 'UserCheck'" :size="12" /><strong>{{
				kind === "users" ? "Users" : "Teams"
			}}</strong
			><span :class="'tone-' + usageTone(metrics)">{{
				metrics.isOverLimit ? "Over limit" : metrics.isNearLimit ? "Near limit" : "OK"
			}}</span>
		</header>
		<div>
			<span>Used:</span><strong>{{ used }}/{{ total }}</strong>
		</div>
		<div>
			<span>Remaining:</span><strong :class="'quota-text-' + usageTone(metrics)">{{ remaining }}</strong>
		</div>
		<div>
			<span>Usage:</span><strong>{{ Math.round(metrics.usagePercentage) }}%</strong>
		</div>
		<div class="application-usage-progress">
			<div :class="usageTone(metrics)" :style="{ width: Math.min(metrics.usagePercentage, 100) + '%' }" />
		</div>
	</section>
</template>
