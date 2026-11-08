import { computed, reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
import { enrichPolicyStream } from "../api/PolicyEnrichmentStreamApi";
import { normalizeCompetitors } from "../logic/PolicyLogic";
import type { PolicyTemplate, SuggestedTemplate, GuardrailDefinition, TemplateTestEntry } from "../support/PolicyModels";
export function createPolicyAiSuggestionStore(catalog: () => PolicyTemplate[]) {
	const state = reactive({
		examples: [""],
		description: "",
		loading: false,
		suggestions: null as SuggestedTemplate[] | null,
		explanation: null as string | null,
		selected: new Set<string>(),
		model: "",
		models: [] as string[],
		modelsLoading: false,
		showTest: false,
		testInput: "",
		testing: false,
		testResults: null as TemplateTestEntry[] | null,
		overallAction: null as string | null,
		collapsed: new Set<string>(),
		enriched: {} as Record<string, GuardrailDefinition[]>,
		competitors: {} as Record<string, string[]>,
		enriching: false,
		enrichStatus: "",
		brandName: "",
	});
	const selectedTemplates = computed(() => {
			const values = new Map<string, PolicyTemplate>();
			for (const suggestion of state.suggestions ?? []) {
				if (!state.selected.has(suggestion.template_id)) continue;
				const template = suggestion.template ?? catalog().find((t) => t.id === suggestion.template_id);
				if (template?.id) values.set(template.id, template);
			}
			return [...values.values()];
		}),
		definitions = computed(() =>
			selectedTemplates.value.flatMap((t) => (state.enriched[t.id]?.length ? state.enriched[t.id]! : t.guardrailDefinitions)),
		),
		needsEnrichment = computed(() => selectedTemplates.value.some((t) => t.llm_enrichment)),
		generatedCompetitors = computed(() => [
			...new Set(selectedTemplates.value.flatMap((t) => normalizeCompetitors(state.competitors[t.id] ?? []))),
		]),
		hasEnriched = computed(() => selectedTemplates.value.some((t) => !!state.enriched[t.id]?.length)),
		hasInput = computed(() => state.examples.some((e) => !!e.trim()) || !!state.description.trim());
	let controller: AbortController | undefined,
		generation = 0,
		disposed = false;
	async function models() {
		state.modelsLoading = true;
		try {
			const result = await policiesApi.hubModels();
			if (!disposed) state.models = result;
		} catch {
			/* The model dropdown remains empty when no model is available. */
		} finally {
			if (!disposed) state.modelsLoading = false;
		}
	}
	function reset() {
		generation++;
		controller?.abort();
		Object.assign(state, {
			examples: [""],
			description: "",
			loading: false,
			suggestions: null,
			explanation: null,
			selected: new Set(),
			model: "",
			showTest: false,
			testInput: "",
			testing: false,
			testResults: null,
			overallAction: null,
			collapsed: new Set(),
			enriched: {},
			competitors: {},
			enriching: false,
			enrichStatus: "",
			brandName: "",
		});
	}
	async function suggest() {
		if (!hasInput.value || !state.model) return;
		state.loading = true;
		const current = generation;
		try {
			const result = await policiesApi.suggest(state.examples, state.description, state.model);
			if (current !== generation || disposed) return;
			state.suggestions = result.selected_templates;
			state.explanation = result.explanation ?? null;
			state.selected = new Set(result.selected_templates.map((s) => s.template_id));
		} catch {
			if (current === generation && !disposed) {
				state.suggestions = [];
				state.explanation = "Failed to get suggestions. Please try again.";
			}
		} finally {
			if (current === generation && !disposed) state.loading = false;
		}
	}
	function toggle(id: string) {
		const selected = new Set(state.selected);
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
		state.selected = selected;
	}
	function collapse(name: string) {
		const collapsed = new Set(state.collapsed);
		if (collapsed.has(name)) collapsed.delete(name);
		else collapsed.add(name);
		state.collapsed = collapsed;
	}
	function back() {
		Object.assign(state, {
			suggestions: null,
			explanation: null,
			selected: new Set(),
			showTest: false,
			testInput: "",
			testResults: null,
			overallAction: null,
			collapsed: new Set(),
		});
	}
	function useSelected() {
		return selectedTemplates.value.map((t) => ({
			...t,
			...(state.enriched[t.id]?.length ? { guardrailDefinitions: state.enriched[t.id] } : {}),
			...(state.competitors[t.id]?.length ? { discoveredCompetitors: normalizeCompetitors(state.competitors[t.id]!) } : {}),
		}));
	}
	async function test() {
		if (!state.testInput.trim() || !definitions.value.length) return;
		state.testing = true;
		state.testResults = null;
		state.overallAction = null;
		state.collapsed = new Set();
		const current = generation;
		try {
			const result = await policiesApi.testTemplate(definitions.value, state.testInput);
			if (current === generation && !disposed) {
				state.testResults = result.results;
				state.overallAction = result.overall_action;
			}
		} catch {
			if (current === generation && !disposed) {
				state.testResults = [];
				state.overallAction = "error";
			}
		} finally {
			if (current === generation && !disposed) state.testing = false;
		}
	}
	async function enrich() {
		if (!state.model) return;
		const templates = selectedTemplates.value.filter((t) => t.llm_enrichment);
		if (!templates.length) return;
		controller?.abort();
		controller = new AbortController();
		const current = generation;
		state.enriching = true;
		state.enrichStatus = "";
		try {
			for (const template of templates) {
				if (current !== generation || disposed) return;
				state.enrichStatus = "Discovering competitors for " + template.title + "...";
				delete state.enriched[template.id];
				state.competitors[template.id] = [];
				await new Promise<void>((resolve, reject) => {
					let settled = false;
					const settle = (run: () => void) => {
						if (!settled) {
							settled = true;
							run();
						}
					};
					void enrichPolicyStream(
						template.id,
						{ [template.llm_enrichment!.parameter]: state.brandName },
						state.model,
						{
							competitor: (name) => {
								if (current === generation && !disposed)
									state.competitors[template.id] = normalizeCompetitors([
										...(state.competitors[template.id] ?? []),
										name,
									]);
							},
							status: (message) => {
								if (current === generation && !disposed) state.enrichStatus = message;
							},
							done: (result) =>
								settle(() => {
									if (current === generation && !disposed) {
										state.enriched[template.id] = result.guardrailDefinitions;
										state.competitors[template.id] = result.competitors.length
											? normalizeCompetitors(result.competitors)
											: (state.competitors[template.id] ?? []);
									}
									resolve();
								}),
							error: (message) => settle(() => reject(new Error(message))),
						},
						undefined,
						controller?.signal,
					).catch((error) => settle(() => reject(error)));
				});
			}
		} catch {
			/* Keep the original template definitions available when enrichment fails. */
		} finally {
			if (current === generation && !disposed) {
				state.enriching = false;
				state.enrichStatus = "";
			}
		}
	}
	return {
		state,
		selectedTemplates,
		definitions,
		needsEnrichment,
		generatedCompetitors,
		hasEnriched,
		hasInput,
		models,
		reset,
		suggest,
		toggle,
		collapse,
		back,
		useSelected,
		test,
		enrich,
		dispose: () => {
			disposed = true;
			generation++;
			controller?.abort();
		},
	};
}
export type PolicyAiSuggestionStore = ReturnType<typeof createPolicyAiSuggestionStore>;
