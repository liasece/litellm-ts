export const inputPolicyOptions = [
	{ value: "untrusted", label: "untrusted", color: "#92400e", background: "#fef3c7", border: "#fcd34d" },
	{ value: "trusted", label: "trusted", color: "#065f46", background: "#d1fae5", border: "#6ee7b7" },
	{ value: "blocked", label: "blocked", color: "#991b1b", background: "#fee2e2", border: "#fca5a5" },
] as const;
export const outputPolicyOptions = inputPolicyOptions.slice(0, 2);
export const toolPolicyStyle = (value: string) => inputPolicyOptions.find((option) => option.value === value) ?? inputPolicyOptions[0];
