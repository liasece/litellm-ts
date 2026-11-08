<script setup lang="ts">
import { ref } from "vue";
import UiLucideIcon from "../../platform/ui/UiLucideIcon.vue";
import { mcpTextSections } from "../logic/McpToolSchemaLogic";
import { copyToolText } from "../support/ToolClipboardSupport";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { MCPContent } from "../support/McpModels";
defineProps<{ result: MCPContent[] | null; error: string; loading: boolean; duration: number | null }>();
const mode = ref("formatted");
async function copy(value: MCPContent[]) {
	if (await copyToolText(JSON.stringify(value, null, 2))) notificationManager.success("Result copied to clipboard");
	else notificationManager.fromBackend("Failed to copy result");
}
function linkParts(text: string) {
	return text
		.split(/(https?:\/\/[^\s)]+)/g)
		.filter(Boolean)
		.map((part) => ({ text: part, url: /^https?:\/\//.test(part) }));
}
</script>
<template>
	<section class="tools-mcp-result">
		<header>
			<h3>Tool Result</h3>
		</header>
		<div class="tools-mcp-result-body">
			<div v-if="error" class="tools-mcp-call-error">
				<UiLucideIcon name="AlertCircle" :size="16" />
				<div>
					<div class="tools-mcp-call-error-title">
						<h4>Tool Call Failed</h4>
						<span v-if="duration != null">• {{ (duration / 1000).toFixed(2) }}s</span>
					</div>
					<div class="tools-mcp-call-error-message">
						<pre>{{ error }}</pre>
					</div>
				</div>
			</div>
			<template v-else-if="result"
				><div class="tools-mcp-result-stack">
					<div class="tools-mcp-result-bar">
						<div class="tools-mcp-result-bar-status">
							<UiLucideIcon name="CheckCircle" :size="16" />
							<h4>Tool executed successfully</h4>
							<span v-if="duration != null">• {{ (duration / 1000).toFixed(2) }}s</span>
						</div>
						<div class="tools-mcp-result-bar-actions">
							<div class="tools-mcp-result-modes">
								<button type="button" :class="{ active: mode === 'formatted' }" @click="mode = 'formatted'">
									Formatted</button
								><button type="button" :class="{ active: mode === 'json' }" @click="mode = 'json'">JSON</button>
							</div>
							<button
								type="button"
								class="tools-mcp-result-copy"
								aria-label="Copy response"
								title="Copy response"
								@click="copy(result)"
							>
								<UiLucideIcon name="Copy" :size="14" />
							</button>
						</div>
					</div>
					<div class="tools-mcp-result-scroll">
						<div v-if="mode === 'json'" class="tools-mcp-result-json">
							<div>
								<pre>{{ JSON.stringify(result, null, 2) }}</pre>
							</div>
						</div>
						<div v-else class="tools-mcp-result-items">
							<article v-for="(content, index) in result" :key="index" class="tools-mcp-result-item">
								<template v-if="content.type === 'text'"
									><div class="tools-mcp-result-item-header"><span>Text Response</span></div>
									<div class="tools-mcp-result-item-body">
										<div class="tools-mcp-result-content-box">
											<div class="tools-mcp-result-content-inner">
												<template v-for="(section, part) in mcpTextSections(content.text)" :key="part">
													<template v-if="section.text.trim() !== ''">
														<div v-if="section.type === 'heading'" class="tools-mcp-result-heading">
															<h3>{{ section.text.replace(/^#+\s/, "") }}</h3>
														</div>
														<div v-else-if="section.type === 'links'" class="tools-mcp-result-link-box">
															<div>
																<template v-for="(piece, i) in linkParts(section.text)" :key="i"
																	><a
																		v-if="piece.url"
																		:href="piece.text"
																		target="_blank"
																		rel="noopener noreferrer"
																		>{{ piece.text }}</a
																	><template v-else>{{ piece.text }}</template></template
																>
															</div>
														</div>
														<div v-else-if="section.type === 'score'" class="tools-mcp-result-score-box">
															<p>{{ section.text }}</p>
														</div>
														<div v-else class="tools-mcp-result-text-box">
															<div>{{ section.text }}</div>
														</div>
													</template>
												</template>
											</div>
										</div>
									</div></template
								>
								<template v-else-if="content.type === 'image' && content.url"
									><div class="tools-mcp-result-item-header"><span>Image Response</span></div>
									<div class="tools-mcp-result-item-body">
										<div class="tools-mcp-result-image-box"><img :src="content.url" alt="Tool result" /></div></div
								></template>
								<template v-else-if="content.type === 'embedded_resource'"
									><div class="tools-mcp-result-item-header"><span>Embedded Resource</span></div>
									<div class="tools-mcp-result-item-body">
										<div class="tools-mcp-result-resource">
											<UiLucideIcon name="FileText" :size="20" />
											<div>
												<p>Resource Type: {{ content.resource_type }}</p>
												<a v-if="content.url" :href="content.url" target="_blank" rel="noopener noreferrer"
													>View Resource<UiLucideIcon name="ExternalLink" :size="12"
												/></a>
											</div>
										</div></div
								></template>
							</article>
						</div>
					</div></div
			></template>
			<div v-else class="tools-mcp-result-ready">
				<div class="tools-mcp-result-ready-inner">
					<div class="tools-mcp-result-ready-icon"><UiLucideIcon name="Zap" :size="48" /></div>
					<h4>{{ loading ? "Calling Tool..." : "Ready to Call Tool" }}</h4>
					<p>Configure the input parameters and click &quot;Call Tool&quot; to see the results here.</p>
				</div>
			</div>
		</div>
	</section>
</template>
