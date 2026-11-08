import Framework08Category01Part1 from "./Framework08Category01Part1.json";
import Framework08Category02Part1 from "./Framework08Category02Part1.json";
import Framework08Category03Part1 from "./Framework08Category03Part1.json";
export default {
	name: "Airline Brand Protection",
	icon: "plane",
	description: "Destination vs competitor intent — avoid answering competitor comparison questions.",
	categories: [
		{
			name: "Destination Intent",
			icon: "✈️",
			description: "User is asking about a travel destination, not a competitor airline.",
			prompts: [...Framework08Category01Part1],
		},
		{
			name: "Competitor Comparison",
			icon: "⚠️",
			description: "Direct comparison between airlines.",
			prompts: [...Framework08Category02Part1],
		},
		{
			name: "Ambiguous Entity",
			icon: "❓",
			description: "Could refer to airline or country.",
			prompts: [...Framework08Category03Part1],
		},
	],
};
