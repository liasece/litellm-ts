import Framework02Category01Part1 from "./Framework02Category01Part1.json";
import Framework02Category02Part1 from "./Framework02Category02Part1.json";
import Framework02Category03Part1 from "./Framework02Category03Part1.json";
import Framework02Category04Part1 from "./Framework02Category04Part1.json";
export default {
	name: "GDPR",
	icon: "lock",
	description: "General Data Protection Regulation — data privacy and protection requirements.",
	categories: [
		{
			name: "Right to Erasure",
			icon: "trash-2",
			description:
				"Individuals have the right to request deletion of their personal data when it is no longer necessary for the purpose it was collected.",
			prompts: [...Framework02Category01Part1],
		},
		{
			name: "Consent & Lawful Basis",
			icon: "check-circle",
			description:
				"Processing personal data requires a lawful basis such as consent, which must be freely given, specific, informed, and unambiguous.",
			prompts: [...Framework02Category02Part1],
		},
		{
			name: "Data Minimisation",
			icon: "trending-down",
			description: "Personal data collected must be adequate, relevant, and limited to what is necessary for the stated purpose.",
			prompts: [...Framework02Category03Part1],
		},
		{
			name: "Automated Decision-Making",
			icon: "bot",
			description:
				"Individuals have the right not to be subject to decisions based solely on automated processing that produce legal or similarly significant effects.",
			prompts: [...Framework02Category04Part1],
		},
	],
};
