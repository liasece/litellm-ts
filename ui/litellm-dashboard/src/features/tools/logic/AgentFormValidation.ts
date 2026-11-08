import { AGENT_FORM_CONFIG } from "../support/AgentFieldSupport";
import type { AgentTypeInfo } from "../support/AgentModels";
export function agentEditErrors(draft: Record<string, unknown>, dynamic?: AgentTypeInfo): Record<string, string> {
	const errors: Record<string, string> = {};
	if (!draft.agent_name) errors.agent_name = "Please enter a unique agent name";
	if (dynamic) {
		for (const field of dynamic.credential_fields)
			if (field.required && !draft[field.key]) errors[field.key] = "Please enter " + field.label;
	} else {
		for (const field of AGENT_FORM_CONFIG.basic.fields)
			if (field.required && !draft[field.name]) errors[field.name] = "Please enter " + field.label.toLowerCase();
		if (Array.isArray(draft.skills))
			draft.skills.forEach((value, index) => {
				if (value && typeof value === "object") {
					const skill = value as Record<string, unknown>;
					for (const field of ["id", "name", "description", "tags"])
						if (!skill[field] || (Array.isArray(skill[field]) && !skill[field].length))
							errors["skills." + index + "." + field] = "Required";
				}
			});
		if (Array.isArray(draft.static_headers))
			draft.static_headers.forEach((value, index) => {
				if (value && typeof value === "object") {
					const header = value as Record<string, unknown>;
					if (!header.header) errors["static_headers." + index + ".header"] = "Header name required";
					if (!header.value) errors["static_headers." + index + ".value"] = "Value required";
				}
			});
	}
	return errors;
}
