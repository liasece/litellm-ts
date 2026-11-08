import type { CapabilityId } from "../support/BuiltinCapabilitiesModels";
export const capabilityPresentation: Array<{ id: CapabilityId; title: string; description: string; notice: string; emptyHint: string }> = [
	{
		id: "image_generation",
		title: "Image Generation & Editing",
		description: "Lets selected models privately create new images or edit attached images through a dedicated image model.",
		notice: "The main model writes the production prompt and chooses create or edit. LiteLLM keeps image bytes private and attaches generated images to Chat and Responses outputs.",
		emptyHint: "No executor configured. Add a model executor to run this capability.",
	},
	{
		id: "vision",
		title: "Vision",
		description: "Lets selected text-only models privately delegate image inspection to a vision-capable model.",
		notice: "Injection requires this global switch and Vision on the requested model. The setting below controls whether an image must already be present.",
		emptyHint: "No executor configured. Add a vision-capable model executor.",
	},
	{
		id: "web",
		title: "Web Search & Fetch",
		description: "Lets selected models privately search the live web and retrieve webpages.",
		notice: "A model executor performs the request through its upstream hosted search. A DeepSeek Search & Fetch executor calls the provider's tools endpoint directly: no worker-model tokens, billed per successful request, and the API key stays in the referenced credential.",
		emptyHint: "No executor configured. Add a model or DeepSeek Search & Fetch executor.",
	},
];
