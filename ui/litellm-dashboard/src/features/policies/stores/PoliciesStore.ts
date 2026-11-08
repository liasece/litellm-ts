import { reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
import { guardrailsApi } from "../../guardrails/api/GuardrailsApi";
import { messageManager } from "../../notifications/logic/MessageManager";
import type { Policy, PolicyAttachment, PolicyTemplate } from "../support/PolicyModels";
import type { GuardrailRecord } from "../../guardrails/support/GuardrailModels";
export function createPoliciesStore() {
	const state = reactive({
		tab: "templates",
		policies: [] as Policy[],
		attachments: [] as PolicyAttachment[],
		guardrails: [] as GuardrailRecord[],
		templates: [] as PolicyTemplate[],
		loading: false,
		attachmentsLoading: false,
		templatesLoading: false,
		selectedId: null as string | null,
		editing: null as Partial<Policy> | null,
		addOpen: false,
		attachmentOpen: false,
		aiOpen: false,
		flowOpen: false,
		deletePolicy: null as Policy | null,
		deleteAttachment: null as string | null,
		deleting: false,
	});
	const controller = new AbortController();
	let generation = 0;
	async function policies() {
		const current = generation;
		state.loading = true;
		try {
			const data = await policiesApi.list(controller.signal);
			if (current === generation) state.policies = data;
		} catch {
			if (current === generation) messageManager.error("Failed to fetch policies");
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	async function attachments() {
		const current = generation;
		state.attachmentsLoading = true;
		try {
			const data = await policiesApi.attachments(controller.signal);
			if (current === generation) state.attachments = data;
		} catch {
			if (current === generation) messageManager.error("Failed to fetch attachments");
		} finally {
			if (current === generation) state.attachmentsLoading = false;
		}
	}
	async function guardrails() {
		const current = generation;
		try {
			const data = await guardrailsApi.list(controller.signal);
			if (current === generation) state.guardrails = data;
		} catch {
			/* The list can still be used without a configured guardrail provider. */
		}
	}
	async function templates() {
		const current = generation;
		state.templatesLoading = true;
		try {
			const data = await policiesApi.templates(controller.signal);
			if (current === generation) state.templates = data;
		} catch {
			if (current === generation) messageManager.error("Failed to fetch policy templates");
		} finally {
			if (current === generation) state.templatesLoading = false;
		}
	}
	async function confirmDeletePolicy() {
		if (!state.deletePolicy) return;
		state.deleting = true;
		const policy = state.deletePolicy;
		try {
			await policiesApi.delete(policy.policy_id);
			messageManager.success('Policy "' + policy.policy_name + '" deleted successfully');
			await policies();
		} catch {
			messageManager.error("Failed to delete policy");
		} finally {
			state.deleting = false;
			state.deletePolicy = null;
		}
	}
	async function confirmDeleteAttachment() {
		if (!state.deleteAttachment) return;
		state.deleting = true;
		try {
			await policiesApi.deleteAttachment(state.deleteAttachment);
			messageManager.success("Attachment deleted successfully");
			void attachments();
		} catch {
			messageManager.error("Failed to delete attachment");
		} finally {
			state.deleting = false;
			state.deleteAttachment = null;
		}
	}
	function add() {
		state.selectedId = null;
		state.editing = null;
		state.addOpen = true;
	}
	function edit(policy: Policy) {
		state.editing = policy;
		state.selectedId = null;
		state.flowOpen = true;
	}
	function closeForm() {
		state.addOpen = false;
		state.editing = null;
	}
	function saved() {
		void policies();
		state.editing = null;
	}
	function dispose() {
		generation++;
		controller.abort();
	}
	return {
		state,
		load: () => Promise.allSettled([policies(), attachments(), guardrails(), templates()]),
		policies,
		attachments,
		guardrails,
		confirmDeletePolicy,
		confirmDeleteAttachment,
		add,
		edit,
		closeForm,
		saved,
		dispose,
	};
}
export type PoliciesStore = ReturnType<typeof createPoliciesStore>;
