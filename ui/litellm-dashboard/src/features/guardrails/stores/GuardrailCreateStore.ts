import { validateGuardrailFields } from "../logic/GuardrailFieldValidationLogic";
import { computed, reactive, ref } from "vue";
import { guardrailsApi } from "../api/GuardrailsApi";
import {
	getGuardrailProviders,
	populateGuardrailProviders,
	populateGuardrailProviderMap,
	shouldRenderContentFilterConfigSettings,
	shouldRenderPIIConfigSettings,
	guardrail_provider_map,
} from "../logic/GuardrailProviderLogic";
import {
	buildGuardrailCreatePayload,
	GuardrailDraftError,
	emptyGuardrailContent,
	emptyToolPermissions,
	type GuardrailEndpointDraft,
} from "../logic/GuardrailCreateLogic";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { GuardrailProviderParameters, GuardrailUiSettings } from "../support/GuardrailModels";
import type { GuardrailPreset } from "../data/GuardrailGardenPresets";
export function createGuardrailCreateStore(authorized: () => boolean, api = guardrailsApi) {
	const values = ref<Record<string, unknown>>({ mode: "pre_call", default_on: false }),
		settings = ref<GuardrailUiSettings | null>(null),
		providers = ref<GuardrailProviderParameters | null>(null),
		content = reactive(emptyGuardrailContent()),
		permissions = ref(emptyToolPermissions()),
		pii = reactive({ entities: [] as string[], actions: {} as Record<string, string> }),
		endpoint = reactive<GuardrailEndpointDraft>({
			type: "",
			endSessionAfterNFails: undefined,
			onViolation: "warn",
			message: "",
			open: false,
		}),
		state = reactive({ step: 0, pending: false, loading: false, errors: {} as Record<string, string> }),
		provider = computed(() => (typeof values.value.provider === "string" ? values.value.provider : null)),
		providerOptions = computed(() => {
			void providers.value;
			return Object.entries(getGuardrailProviders()).map(([value, label]) => ({ value, label }));
		}),
		steps = computed(() =>
			shouldRenderContentFilterConfigSettings(provider.value)
				? ["Basic Info", "Topics", "Patterns", "Keywords", "Endpoint Settings (Optional)"]
				: shouldRenderPIIConfigSettings(provider.value)
					? ["Basic Info", "PII Configuration"]
					: ["Basic Info", "Provider Configuration"],
		);
	let generation = 0,
		disposed = false;
	async function load() {
		if (!authorized()) return;
		const current = ++generation;
		state.loading = true;
		try {
			const result = await Promise.all([api.settings(), api.providers()]);
			if (!disposed && current === generation) {
				settings.value = result[0];
				providers.value = result[1];
				populateGuardrailProviders(result[1]);
				populateGuardrailProviderMap(result[1]);
			}
		} catch {
			if (!disposed && current === generation) notificationManager.fromBackend("Failed to load guardrail configuration");
		} finally {
			if (!disposed && current === generation) state.loading = false;
		}
	}
	function chooseProvider(value: string) {
		values.value.provider = value;
		values.value.config = undefined;
		values.value.presidio_analyzer_api_base = undefined;
		values.value.presidio_anonymizer_api_base = undefined;
		if (value === "BlockCodeExecution") values.value.confidence_threshold = 0.5;
		pii.entities = [];
		pii.actions = {};
		Object.assign(content, emptyGuardrailContent());
		permissions.value = emptyToolPermissions();
	}
	function applyPreset(preset: GuardrailPreset) {
		values.value = {
			...values.value,
			provider: preset.provider,
			guardrail_name: preset.guardrailNameSuggestion,
			mode: preset.mode,
			default_on: preset.defaultOn,
		};
		if (preset.provider === "BlockCodeExecution") values.value.confidence_threshold = 0.5;
		const category = settings.value?.content_filter_settings?.content_categories?.find((row) => row.name === preset.categoryName);
		if (category)
			content.categories = [
				{
					id: "category-" + Date.now(),
					category: category.name,
					display_name: category.display_name,
					action: category.default_action === "MASK" ? "MASK" : "BLOCK",
					severity_threshold: "medium",
				},
			];
	}
	function validateBasic() {
		const errors: Record<string, string> = {};
		if (values.value.guardrail_name == null || values.value.guardrail_name === "")
			errors.guardrail_name = "Please enter a guardrail name";
		if (!values.value.provider) errors.provider = "Please select a provider";
		if (!values.value.mode || (Array.isArray(values.value.mode) && !values.value.mode.length)) errors.mode = "Please select a mode";
		if (provider.value === "PresidioPII")
			for (const key of ["presidio_analyzer_api_base", "presidio_anonymizer_api_base"])
				if (!values.value[key]) errors[key] = key + " is required";
		state.errors = errors;
		return !Object.keys(errors).length;
	}
	function next() {
		if (state.step === 0 && !validateBasic()) return false;
		if (state.step === 1 && shouldRenderPIIConfigSettings(provider.value) && !pii.entities.length) {
			notificationManager.fromBackend("Please select at least one PII entity to continue");
			return false;
		}
		state.step++;
		return true;
	}
	function reset() {
		values.value = { mode: "pre_call", default_on: false };
		pii.entities = [];
		pii.actions = {};
		content.patterns = [];
		content.keywords = [];
		content.categories = [];
		content.pendingCategory = "";
		permissions.value = emptyToolPermissions();
		Object.assign(endpoint, { type: "", endSessionAfterNFails: undefined, onViolation: "warn", message: "", open: false });
		state.step = 0;
		state.errors = {};
	}
	async function save() {
		if (
			!shouldRenderContentFilterConfigSettings(provider.value) &&
			!shouldRenderPIIConfigSettings(provider.value) &&
			guardrail_provider_map[provider.value ?? ""] !== "tool_permission"
		) {
			const optional = providers.value?.[guardrail_provider_map[provider.value ?? ""]?.toLowerCase()]?.optional_params?.fields;
			if (optional) {
				const nested =
					values.value.optional_params && typeof values.value.optional_params === "object"
						? (values.value.optional_params as Record<string, unknown>)
						: {};
				state.errors = validateGuardrailFields(nested, optional);
				if (Object.keys(state.errors).length) return false;
			}
		}
		state.pending = true;
		try {
			const payload = buildGuardrailCreatePayload(
				values.value,
				providers.value,
				content,
				pii.entities,
				pii.actions,
				permissions.value,
				endpoint,
			);
			if (!authorized()) throw new Error("No access token available");
			await api.create(payload);
			notificationManager.success("Guardrail created successfully");
			reset();
			return true;
		} catch (error) {
			notificationManager.fromBackend(
				error instanceof GuardrailDraftError
					? error.message
					: "Failed to create guardrail: " + (error instanceof Error ? error.message : String(error)),
			);
			return false;
		} finally {
			state.pending = false;
		}
	}
	return {
		values,
		settings,
		providers,
		content,
		permissions,
		pii,
		endpoint,
		state,
		provider,
		providerOptions,
		steps,
		load,
		chooseProvider,
		applyPreset,
		next,
		reset,
		save,
		isToolPermission: computed(() => guardrail_provider_map[provider.value ?? ""] === "tool_permission"),
		dispose() {
			disposed = true;
			++generation;
		},
	};
}
