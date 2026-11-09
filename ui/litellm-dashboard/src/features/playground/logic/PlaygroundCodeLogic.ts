import type { PlaygroundMessage as MessageType } from "../support/PlaygroundModels";
import { generateImageCode } from "../data/PlaygroundImageCodeData";
import { EndpointType } from "../support/PlaygroundModels";

interface CodeGenMetadata {
	tags?: string[];
}

export interface GenerateCodeParams {
	apiKeySource: "session" | "custom";
	accessToken: string | null;
	apiKey: string;
	inputMessage: string;
	chatHistory: MessageType[];
	selectedTags: string[];
	selectedVoice?: string;
	endpointType: string;
	selectedModel: string | undefined;
	selectedSdk: "openai" | "azure";
	proxySettings?: {
		PROXY_BASE_URL?: string;
		LITELLM_UI_API_DOC_BASE_URL?: string | null;
	};
}

export const generateCodeSnippet = (params: GenerateCodeParams): string => {
	const {
		apiKeySource,
		accessToken,
		apiKey,
		inputMessage,
		chatHistory,
		selectedTags,
		selectedVoice,
		endpointType,
		selectedModel,
		selectedSdk,
		proxySettings,
	} = params;
	const effectiveApiKey = apiKeySource === "session" ? accessToken : apiKey;

	// Determine base URL with priority: LITELLM_UI_API_DOC_BASE_URL > PROXY_BASE_URL > window.location.origin
	let apiBase = window.location.origin;
	const customDocBaseUrl = proxySettings?.LITELLM_UI_API_DOC_BASE_URL;
	if (customDocBaseUrl && customDocBaseUrl.trim()) {
		apiBase = customDocBaseUrl;
	} else if (proxySettings?.PROXY_BASE_URL) {
		apiBase = proxySettings.PROXY_BASE_URL;
	}

	// Always get the input message early on, regardless of what happens later
	const userPrompt = inputMessage || "Your prompt here"; // Fallback if inputMessage is empty

	// Safely escape the prompt to prevent issues with quotes
	const safePrompt = userPrompt.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");

	const messages = chatHistory.filter((msg) => !msg.isImage).map(({ role, content }) => ({ role, content }));

	const metadata: CodeGenMetadata = {};
	if (selectedTags.length > 0) metadata.tags = selectedTags;

	const modelNameForCode = selectedModel || "your-model-name";

	const clientInitialization =
		selectedSdk === "azure"
			? `import openai

client = openai.AzureOpenAI(
	api_key="${effectiveApiKey || "YOUR_LITELLM_API_KEY"}",
	azure_endpoint="${apiBase}",
	api_version="2024-02-01"
)`
			: `import openai

client = openai.OpenAI(
	api_key="${effectiveApiKey || "YOUR_LITELLM_API_KEY"}",
	base_url="${apiBase}"
)`;

	let endpointSpecificCode;
	switch (endpointType) {
		case EndpointType.CHAT: {
			const metadataIsNotEmpty = Object.keys(metadata).length > 0;
			let extraBodyCode = "";
			if (metadataIsNotEmpty) {
				const extraBodyObject = { metadata };
				const extraBodyString = JSON.stringify(extraBodyObject, null, 2);
				const indentedExtraBodyString = extraBodyString
					.split("\n")
					.map((line) => " ".repeat(4) + line)
					.join("\n")
					.trim();

				extraBodyCode = `,\n    extra_body=${indentedExtraBodyString}`;
			}

			// Create example for chat completions with optional image support
			const messagesExample = messages.length > 0 ? messages : [{ role: "user", content: userPrompt }];

			endpointSpecificCode = `
import base64

# Helper function to encode images to base64
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

# Example with text only
response = client.chat.completions.create(
    model="${modelNameForCode}",
    messages=${JSON.stringify(messagesExample, null, 4)}${extraBodyCode}
)

print(response)

# Example with image or PDF (uncomment and provide file path to use)
# base64_file = encode_image("path/to/your/file.jpg")  # or .pdf
# response_with_file = client.chat.completions.create(
#     model="${modelNameForCode}",
#     messages=[
#         {
#             "role": "user",
#             "content": [
#                 {
#                     "type": "text",
#                     "text": "${safePrompt}"
#                 },
#                 {
#                     "type": "image_url",
#                     "image_url": {
#                         "url": f"data:image/jpeg;base64,{base64_file}"  # or data:application/pdf;base64,{base64_file}
#                     }
#                 }
#             ]
#         }
#     ]${extraBodyCode}
# )
# print(response_with_file)
`;
			break;
		}
		case EndpointType.RESPONSES: {
			const metadataIsNotEmpty = Object.keys(metadata).length > 0;
			let extraBodyCode = "";
			if (metadataIsNotEmpty) {
				const extraBodyObject = { metadata };
				const extraBodyString = JSON.stringify(extraBodyObject, null, 2);
				const indentedExtraBodyString = extraBodyString
					.split("\n")
					.map((line) => " ".repeat(4) + line)
					.join("\n")
					.trim();

				extraBodyCode = `,\n    extra_body=${indentedExtraBodyString}`;
			}

			// Create example for responses API with optional image support
			const inputExample = messages.length > 0 ? messages : [{ role: "user", content: userPrompt }];

			endpointSpecificCode = `
import base64

# Helper function to encode images to base64
def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

# Example with text only
response = client.responses.create(
    model="${modelNameForCode}",
    input=${JSON.stringify(inputExample, null, 4)}${extraBodyCode}
)

print(response.output_text)

# Example with image or PDF (uncomment and provide file path to use)
# base64_file = encode_image("path/to/your/file.jpg")  # or .pdf
# response_with_file = client.responses.create(
#     model="${modelNameForCode}",
#     input=[
#         {
#             "role": "user",
#             "content": [
#                 {"type": "input_text", "text": "${safePrompt}"},
#                 {
#                     "type": "input_image",
#                     "image_url": f"data:image/jpeg;base64,{base64_file}",  # or data:application/pdf;base64,{base64_file}
#                 },
#             ],
#         }
#     ]${extraBodyCode}
# )
# print(response_with_file.output_text)
`;
			break;
		}
		case EndpointType.IMAGE:
			endpointSpecificCode = generateImageCode({ selectedSdk, modelNameForCode, inputMessage, safePrompt });
			break;
		case EndpointType.EMBEDDINGS:
			endpointSpecificCode = `
response = client.embeddings.create(
	input="${inputMessage || "Your string here"}",
	model="${modelNameForCode}",
	encoding_format="base64" # or "float"
)

print(response.data[0].embedding)
`;
			break;
		case EndpointType.TRANSCRIPTION:
			endpointSpecificCode = `
# Open the audio file
audio_file = open("path/to/your/audio/file.mp3", "rb")

# Make the transcription request
response = client.audio.transcriptions.create(
	model="${modelNameForCode}",
	file=audio_file${inputMessage ? `,\n	prompt="${inputMessage.replace(/"/g, '\\"')}"` : ""}
)

print(response.text)
`;
			break;
		case EndpointType.SPEECH:
			endpointSpecificCode = `
# Make the text-to-speech request
response = client.audio.speech.create(
	model="${modelNameForCode}",
	input="${inputMessage || "Your text to convert to speech here"}",
	voice="${selectedVoice}"  # Options: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer
)

# Save the audio to a file
output_filename = "output_speech.mp3"
response.stream_to_file(output_filename)
print(f"Audio saved to {output_filename}")

# Optional: Customize response format and speed
# response = client.audio.speech.create(
#     model="${modelNameForCode}",
#     input="${inputMessage || "Your text to convert to speech here"}",
#     voice="alloy",
#     response_format="mp3",  # Options: mp3, opus, aac, flac, wav, pcm
#     speed=1.0  # Range: 0.25 to 4.0
# )
# response.stream_to_file("output_speech.mp3")
`;
			break;
		default:
			endpointSpecificCode = "\n# Code generation for this endpoint is not implemented yet.";
	}

	const finalCode = `${clientInitialization}\n${endpointSpecificCode}`;

	return finalCode;
};
