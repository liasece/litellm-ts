import Framework03Category01Part1 from "./Framework03Category01Part1.json";
import Framework03Category01Part2 from "./Framework03Category01Part2.json";
import Framework03Category01Part3 from "./Framework03Category01Part3.json";
import Framework03Category01Part4 from "./Framework03Category01Part4.json";
import Framework03Category01Part5 from "./Framework03Category01Part5.json";
import Framework03Category01Part6 from "./Framework03Category01Part6.json";
import Framework03Category01Part7 from "./Framework03Category01Part7.json";
import Framework03Category01Part8 from "./Framework03Category01Part8.json";
import Framework03Category01Part9 from "./Framework03Category01Part9.json";
import Framework03Category01Part10 from "./Framework03Category01Part10.json";
import Framework03Category01Part11 from "./Framework03Category01Part11.json";
import Framework03Category01Part12 from "./Framework03Category01Part12.json";
import Framework03Category02Part1 from "./Framework03Category02Part1.json";
import Framework03Category02Part2 from "./Framework03Category02Part2.json";
import Framework03Category02Part3 from "./Framework03Category02Part3.json";
import Framework03Category02Part4 from "./Framework03Category02Part4.json";
import Framework03Category02Part5 from "./Framework03Category02Part5.json";
import Framework03Category02Part6 from "./Framework03Category02Part6.json";
import Framework03Category02Part7 from "./Framework03Category02Part7.json";
import Framework03Category02Part8 from "./Framework03Category02Part8.json";
import Framework03Category02Part9 from "./Framework03Category02Part9.json";
export default {
	name: "Topic Blocking",
	icon: "shield",
	description:
		"Content filter guardrails that block messages matching specific prohibited topics while allowing legitimate use of related words in context.",
	categories: [
		{
			name: "Insults & Personal Attacks",
			icon: "alert-triangle",
			description: "Detects insults, name-calling, and personal attacks directed at the chatbot, staff, or other people",
			prompts: [
				...Framework03Category01Part1,
				...Framework03Category01Part2,
				...Framework03Category01Part3,
				...Framework03Category01Part4,
				...Framework03Category01Part5,
				...Framework03Category01Part6,
				...Framework03Category01Part7,
				...Framework03Category01Part8,
				...Framework03Category01Part9,
				...Framework03Category01Part10,
				...Framework03Category01Part11,
				...Framework03Category01Part12,
			],
		},
		{
			name: "Financial Advice",
			icon: "dollar-sign",
			description:
				"Blocks requests for personalized financial advice, investment recommendations, or financial planning that should be provided by licensed financial advisors",
			prompts: [
				...Framework03Category02Part1,
				...Framework03Category02Part2,
				...Framework03Category02Part3,
				...Framework03Category02Part4,
				...Framework03Category02Part5,
				...Framework03Category02Part6,
				...Framework03Category02Part7,
				...Framework03Category02Part8,
				...Framework03Category02Part9,
			],
		},
	],
};
