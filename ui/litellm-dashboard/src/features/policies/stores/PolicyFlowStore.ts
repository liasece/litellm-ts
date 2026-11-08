import { reactive } from "vue";
import { policiesApi } from "../api/PoliciesApi";
import { derivePipeline, errorText } from "../logic/PolicyLogic";
import { messageManager } from "../../notifications/logic/MessageManager";
import { notificationManager } from "../../notifications/logic/NotificationManager";
import type { Policy, PolicyVersionStatus } from "../support/PolicyModels";
export function createPolicyFlowStore(callbacks: { selected: (policy: Policy) => void; saved: () => void; back: () => void }) {
	const state = reactive({
		name: "",
		description: "",
		pipeline: derivePipeline(),
		editing: null as Partial<Policy> | null,
		versions: [] as Policy[],
		versionsLoading: false,
		creatingVersion: false,
		updatingStatus: false,
		saving: false,
		showTest: false,
	});
	let disposed = false,
		versionGeneration = 0;
	async function versions() {
		const name = state.editing?.policy_name,
			current = ++versionGeneration;
		if (!name) {
			state.versions = [];
			return;
		}
		state.versionsLoading = true;
		try {
			const result = await policiesApi.versions(name);
			if (!disposed && current === versionGeneration) state.versions = result;
		} catch {
			if (!disposed && current === versionGeneration) state.versions = [];
		} finally {
			if (!disposed && current === versionGeneration) state.versionsLoading = false;
		}
	}
	function sync(policy: Partial<Policy> | null) {
		const previous = state.editing?.policy_name;
		state.editing = policy;
		state.name = policy?.policy_name || "";
		state.description = policy?.description || "";
		state.pipeline = derivePipeline(policy);
		if (previous !== policy?.policy_name) void versions();
	}
	async function newVersion() {
		if (!state.editing?.policy_name) return;
		state.creatingVersion = true;
		try {
			const policy = await policiesApi.createVersion(state.editing.policy_name);
			if (disposed) return;
			notificationManager.success("New draft version created");
			callbacks.selected(policy);
			await versions();
		} catch (error) {
			notificationManager.fromBackend("Failed to create version: " + errorText(error));
		} finally {
			state.creatingVersion = false;
		}
	}
	async function setStatus(status: Exclude<PolicyVersionStatus, "draft">) {
		if (!state.editing?.policy_id) return;
		state.updatingStatus = true;
		try {
			const policy = await policiesApi.setStatus(state.editing.policy_id, status);
			if (disposed) return;
			notificationManager.success(
				status === "published"
					? "Version published. You can test it in the Playground by selecting this version in the Policies dropdown."
					: "Version promoted to production",
			);
			await versions();
			callbacks.selected(policy);
		} catch (error) {
			notificationManager.fromBackend(
				(status === "published" ? "Failed to publish: " : "Failed to promote to production: ") + errorText(error),
			);
		} finally {
			state.updatingStatus = false;
		}
	}
	async function save() {
		if (!state.name.trim()) {
			messageManager.error("Please enter a policy name");
			return false;
		}
		if (state.pipeline.steps.some((s) => !s.guardrail)) {
			messageManager.error("Please select a guardrail for all steps");
			return false;
		}
		state.saving = true;
		const editingId = state.editing?.policy_id;
		try {
			const body = {
				policy_name: state.name,
				description: state.description || undefined,
				guardrails_add: state.pipeline.steps.map((s) => s.guardrail).filter(Boolean),
				guardrails_remove: [],
				pipeline: state.pipeline,
			};
			if (editingId) await policiesApi.update(editingId, body);
			else await policiesApi.create(body);
			if (disposed) return false;
			notificationManager.success(editingId ? "Policy updated successfully" : "Policy created successfully");
			callbacks.saved();
			if (!editingId) callbacks.back();
			return true;
		} catch (error) {
			notificationManager.fromBackend("Failed to save policy: " + errorText(error));
			return false;
		} finally {
			state.saving = false;
		}
	}
	return {
		state,
		sync,
		versions,
		newVersion,
		setStatus,
		save,
		dispose: () => {
			disposed = true;
			versionGeneration++;
		},
	};
}
