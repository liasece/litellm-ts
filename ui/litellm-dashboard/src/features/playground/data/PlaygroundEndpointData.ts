import type { EndpointType, PlaygroundModel } from "../support/PlaygroundModels";
export const endpointOptions = [
	{ value: "chat", label: "/v1/chat/completions" },
	{ value: "responses", label: "/v1/responses" },
	{ value: "anthropic_messages", label: "/v1/messages" },
	{ value: "image", label: "/v1/images/generations" },
	{ value: "embeddings", label: "/v1/embeddings" },
	{ value: "speech", label: "/v1/audio/speech" },
	{ value: "transcription", label: "/v1/audio/transcriptions" },
	{ value: "realtime", label: "/v1/realtime" },
] as const;
export const voiceOptions = [
	{ value: "alloy", label: "Alloy - Professional and confident" },
	{ value: "ash", label: "Ash - Casual and relaxed" },
	{ value: "ballad", label: "Ballad - Smooth and melodic" },
	{ value: "coral", label: "Coral - Warm and engaging" },
	{ value: "echo", label: "Echo - Friendly and conversational" },
	{ value: "fable", label: "Fable - Wise and measured" },
	{ value: "nova", label: "Nova - Friendly and conversational" },
	{ value: "onyx", label: "Onyx - Deep and authoritative" },
	{ value: "sage", label: "Sage - Wise and measured" },
	{ value: "shimmer", label: "Shimmer - Bright and cheerful" },
] as const;
const modeMapping: Record<string, EndpointType> = {
	image_generation: "image",
	video_generation: "video",
	chat: "chat",
	responses: "responses",
	anthropic_messages: "anthropic_messages",
	audio_speech: "speech",
	audio_transcription: "transcription",
	embedding: "embeddings",
	realtime: "realtime",
};
export const endpointForMode = (mode: string | undefined): EndpointType => modeMapping[mode ?? ""] ?? "chat";
export function modelOptions(models: PlaygroundModel[], endpoint?: EndpointType) {
	const candidates = models.filter(
		(model) =>
			!endpoint ||
			!model.mode ||
			endpointForMode(model.mode) === endpoint ||
			(["responses", "anthropic_messages"].includes(endpoint) && endpointForMode(model.mode) === "chat"),
	);
	const seen = new Set<string>();
	return [...candidates]
		.sort((a, b) => Number(b.type === "alias") - Number(a.type === "alias") || a.model_group.localeCompare(b.model_group))
		.flatMap((model) => {
			if (seen.has(model.model_group)) return [];
			seen.add(model.model_group);
			return [{ value: model.model_group, label: (model.type === "alias" ? "Alias: " : "模型: ") + model.model_group }];
		});
}
