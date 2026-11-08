import Framework06Category01Part1 from "./Framework06Category01Part1.json";
import Framework06Category02Part1 from "./Framework06Category02Part1.json";
import Framework06Category03Part1 from "./Framework06Category03Part1.json";
export default {
	name: "Canadian PII (FIPPA)",
	icon: "graduation-cap",
	description:
		"Ontario FIPPA institutional identifier detection — masks University of Toronto student/employee numbers, UTORid logins, and TCard campus IDs.",
	categories: [
		{
			name: "UofT Student/Employee Number",
			icon: "graduation-cap",
			description:
				"Detects University of Toronto student and employee numbers (10-digit, prefix '10') — protected under Ontario FIPPA.",
			prompts: [...Framework06Category01Part1],
		},
		{
			name: "UTORid Login",
			icon: "log-in",
			description: "Detects University of Toronto UTORid login identifiers — protected under Ontario FIPPA.",
			prompts: [...Framework06Category02Part1],
		},
		{
			name: "TCard Campus ID",
			icon: "credit-card",
			description: "Detects University of Toronto TCard campus ID card numbers (16-digit) — protected under Ontario FIPPA.",
			prompts: [...Framework06Category03Part1],
		},
	],
};
