import Framework05Category01Part1 from "./Framework05Category01Part1.json";
import Framework05Category02Part1 from "./Framework05Category02Part1.json";
import Framework05Category03Part1 from "./Framework05Category03Part1.json";
import Framework05Category04Part1 from "./Framework05Category04Part1.json";
import Framework05Category05Part1 from "./Framework05Category05Part1.json";
import Framework05Category06Part1 from "./Framework05Category06Part1.json";
import Framework05Category07Part1 from "./Framework05Category07Part1.json";
export default {
	name: "Canadian PII (PIPEDA)",
	icon: "shield",
	description:
		"Canadian PII detection under PIPEDA and provincial privacy legislation — masks SIN, OHIP, driver's licence, passport, immigration docs, bank accounts, and postal codes.",
	categories: [
		{
			name: "Social Insurance Number (SIN)",
			icon: "shield",
			description:
				"Detects Canadian Social Insurance Numbers — 9-digit federal identifiers protected under the Privacy Act and PIPEDA.",
			prompts: [...Framework05Category01Part1],
		},
		{
			name: "Ontario Health Insurance (OHIP)",
			icon: "heart",
			description:
				"Detects Ontario Health Insurance Plan numbers — protected under PHIPA (Personal Health Information Protection Act).",
			prompts: [...Framework05Category02Part1],
		},
		{
			name: "Ontario Driver's Licence",
			icon: "credit-card",
			description: "Detects Ontario driver's licence numbers — protected under the Highway Traffic Act and PIPEDA.",
			prompts: [...Framework05Category03Part1],
		},
		{
			name: "Canadian Passport",
			icon: "globe",
			description: "Detects Canadian passport numbers — protected under the Canadian Passport Order and PIPEDA.",
			prompts: [...Framework05Category04Part1],
		},
		{
			name: "IRCC Immigration Documents",
			icon: "file-text",
			description:
				"Detects Canadian immigration document numbers (UCI, work/study permits, IMM forms) — protected under IRPA and PIPEDA.",
			prompts: [...Framework05Category05Part1],
		},
		{
			name: "Canadian Bank Account",
			icon: "dollar-sign",
			description:
				"Detects Canadian bank account routing information (transit-institution-account format) — protected under the Bank Act and PIPEDA.",
			prompts: [...Framework05Category06Part1],
		},
		{
			name: "Canadian Postal Code",
			icon: "map-pin",
			description:
				"Detects Canadian postal codes (A1A 1A1 format) — considered PII when combined with other identifiers under PIPEDA.",
			prompts: [...Framework05Category07Part1],
		},
	],
};
