import { reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
import { guardrailsApi } from "../../guardrails/api/GuardrailsApi";
import { messageManager } from "../../notifications/logic/MessageManager";
import { substituteTemplate } from "../logic/PolicyLogic";
import type { GuardrailDefinition, PolicyTemplate } from "../support/PolicyModels";
import type { PoliciesStore } from "./PoliciesStore";
export function createPolicyTemplateStore(page: PoliciesStore) {
	const state = reactive({
		selected: null as PolicyTemplate | null,
		pending: null as PolicyTemplate | null,
		parameterOpen: false,
		selectionOpen: false,
		enriching: false,
		creating: false,
		existingNames: new Set<string>(),
		queue: [] as PolicyTemplate[],
		progress: null as { current: number; total: number } | null,
	});
	let timer: ReturnType<typeof setTimeout> | undefined,
		disposed = false;
	async function proceed(template: PolicyTemplate) {
		try {
			const existing = await guardrailsApi.list();
			if (disposed) return;
			state.existingNames = new Set(existing.map((g) => g.guardrail_name).filter((v): v is string => !!v));
			state.selected = template;
			state.selectionOpen = true;
		} catch {
			if (!disposed) messageManager.error("Failed to load guardrails. Please try again.");
		}
	}
	function use(template: PolicyTemplate) {
		if (template.parameters.length) {
			state.pending = template;
			state.parameterOpen = true;
			return Promise.resolve();
		}
		return proceed(template);
	}
	async function parameters(values: Record<string, string>, options?: { model?: string; competitors?: string[] }) {
		if (!state.pending) return;
		state.enriching = true;
		try {
			let template = state.pending;
			if (template.llm_enrichment) {
				const result = await policiesApi.enrich(template.id, values, options?.model, options?.competitors);
				template = { ...template, guardrailDefinitions: result.guardrailDefinitions, discoveredCompetitors: result.competitors };
			}
			if (disposed) return;
			template = substituteTemplate(template, values);
			state.parameterOpen = false;
			state.pending = null;
			await proceed(template);
		} catch {
			if (!disposed) messageManager.error("Failed to configure template. Please try again.");
		} finally {
			state.enriching = false;
		}
	}
	async function confirm(definitions: GuardrailDefinition[]) {
		if (!state.selected) return;
		state.creating = true;
		const template = state.selected,
			created: string[] = [],
			failed: string[] = [];
		try {
			for (const definition of definitions) {
				try {
					await guardrailsApi.create(definition);
					created.push(definition.guardrail_name);
				} catch {
					failed.push(definition.guardrail_name);
				}
			}
			await page.guardrails();
			if (disposed) return;
			state.selectionOpen = false;
			page.state.editing = template.templateData;
			page.state.addOpen = true;
			page.state.tab = "policies";
			messageManager.success(
				created.length
					? "Created " + created.length + " guardrail" + (created.length > 1 ? "s" : "") + "! Complete the policy form to save."
					: "Template ready! Complete the policy form to save.",
			);
			if (failed.length)
				messageManager.warning(
					"Failed to create " + failed.length + " guardrail(s): " + failed.join(", ") + ". You may need to create them manually.",
				);
			const next = state.queue.shift();
			if (next) {
				if (state.progress) state.progress.current++;
				timer = setTimeout(() => {
					if (!disposed) void use(next);
				}, 500);
			} else state.progress = null;
		} catch {
			state.queue = [];
			state.progress = null;
			messageManager.error("Failed to create guardrails. Please try again.");
		} finally {
			state.creating = false;
		}
	}
	function select(templates: PolicyTemplate[]) {
		page.state.aiOpen = false;
		if (!templates.length) return;
		const [first, ...rest] = templates;
		state.queue = rest;
		state.progress = templates.length > 1 ? { current: 1, total: templates.length } : null;
		void use(first!);
	}
	function cancelSelection() {
		state.selectionOpen = false;
		state.selected = null;
		state.queue = [];
		state.progress = null;
		clearTimeout(timer);
	}
	function cancelParameters() {
		state.parameterOpen = false;
		state.pending = null;
	}
	function dispose() {
		disposed = true;
		clearTimeout(timer);
	}
	return { state, use, parameters, confirm, select, cancelSelection, cancelParameters, dispose };
}
