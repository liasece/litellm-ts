import Framework01Category01Part1 from "./Framework01Category01Part1.json";
import Framework01Category02Part1 from "./Framework01Category02Part1.json";
import Framework01Category03Part1 from "./Framework01Category03Part1.json";
import Framework01Category04Part1 from "./Framework01Category04Part1.json";
import Framework01Category05Part1 from "./Framework01Category05Part1.json";
import Framework01Category06Part1 from "./Framework01Category06Part1.json";
import Framework01Category07Part1 from "./Framework01Category07Part1.json";
export default {
	name: "EU AI Act",
	icon: "shield",
	description: "Article 5 prohibited AI practices under the European Union AI Act.",
	categories: [
		{
			name: "Subliminal or Manipulative Techniques",
			icon: "lock",
			description: "AI that tries to subtly influence decisions or behaviour beyond a person's conscious awareness is prohibited.",
			prompts: [...Framework01Category01Part1],
		},
		{
			name: "Exploiting Vulnerabilities",
			icon: "brain",
			description:
				"AI must not take advantage of vulnerabilities due to age, disability, economic or social status in ways that distort behaviour and cause harm.",
			prompts: [...Framework01Category02Part1],
		},
		{
			name: "Social Scoring & Classification",
			icon: "bar-chart",
			description:
				"AI systems that evaluate or score people based on social behaviour or personal traits — leading to unfavourable treatment — are prohibited.",
			prompts: [...Framework01Category03Part1],
		},
		{
			name: "Risk Assessment for Predicting Criminality",
			icon: "scale",
			description:
				"AI cannot make risk predictions about whether a person might commit a crime based solely on profiling or personality traits.",
			prompts: [...Framework01Category04Part1],
		},
		{
			name: "Facial Image Scraping for Databases",
			icon: "search",
			description: "AI may not create or expand biometric databases by scraping images from the internet or CCTV footage.",
			prompts: [...Framework01Category05Part1],
		},
		{
			name: "Emotion Recognition in Workplace & Education",
			icon: "smile",
			description: "AI systems that infer people's emotions in workplaces or schools are forbidden (except medical/safety cases).",
			prompts: [...Framework01Category06Part1],
		},
		{
			name: "Biometric Categorisation of Sensitive Traits",
			icon: "fingerprint",
			description: "AI must not categorise individuals based on race, religion, sexual orientation, etc., from biometric data.",
			prompts: [...Framework01Category07Part1],
		},
	],
};
