import { requestBody } from "../logic/PlaygroundRequestLogic";
import {
	applyChatChunk,
	applyResponsesEvent,
	applyAnthropicEvent,
	emptyChatStream,
	emptyResponsesStream,
	finishChatStream,
} from "../logic/PlaygroundStreamEventsLogic";
import { asRecord, records, string } from "../logic/PlaygroundValueLogic";
import type { PlaygroundRequest, PlaygroundCallbacks } from "../support/PlaygroundModels";
import { inferenceHeaders, inferenceRequest, readServerSentEvents } from "./PlaygroundTransportApi";
import { sendA2AMessage } from "./PlaygroundAgentApi";
export async function sendStreamingInference(request: PlaygroundRequest, callbacks: PlaygroundCallbacks): Promise<void> {
	const path =
		request.endpoint === "responses" ? "/responses" : request.endpoint === "anthropic_messages" ? "/v1/messages" : "/chat/completions";
	const protocol = request.endpoint === "anthropic_messages" ? "anthropic" : "openai",
		started = Date.now();
	const response = await inferenceRequest(
		path,
		request.auth,
		protocol,
		{ method: "POST", headers: inferenceHeaders(request.tags), signal: request.signal, body: JSON.stringify(requestBody(request)) },
		request.customBaseUrl,
	);
	const chat = emptyChatStream(),
		responses = emptyResponsesStream(),
		anthropic: { inputTokens?: number } = {};
	let timed = false;
	for await (const frame of readServerSentEvents(response, request.signal)) {
		const meaningful =
			request.endpoint === "responses"
				? applyResponsesEvent(frame, request.model, callbacks, responses)
				: request.endpoint === "anthropic_messages"
					? applyAnthropicEvent(frame, request.model, callbacks, anthropic)
					: applyChatChunk(frame, callbacks, chat);
		if (!timed && meaningful) {
			timed = true;
			callbacks.timing?.(Date.now() - started);
		}
	}
	if (request.endpoint === "chat") finishChatStream(chat, callbacks);
	if (request.endpoint === "chat") callbacks.latency?.(Date.now() - started);
}
function firstImage(payload: unknown): string | null {
	const first = records(asRecord(payload)?.data)[0];
	return string(first?.url) ?? (typeof first?.b64_json === "string" ? "data:image/png;base64," + first.b64_json : null);
}
export async function sendInference(request: PlaygroundRequest, callbacks: PlaygroundCallbacks): Promise<void> {
	if (["chat", "responses", "anthropic_messages"].includes(request.endpoint)) return sendStreamingInference(request, callbacks);
	if (request.endpoint === "a2a_agents") return sendA2AMessage(request, callbacks);
	if (request.endpoint === "image") {
		const response = await inferenceRequest(
			"/images/generations",
			request.auth,
			"openai",
			{
				method: "POST",
				headers: inferenceHeaders(request.tags),
				body: JSON.stringify({ model: request.model, prompt: request.input }),
				signal: request.signal,
			},
			request.customBaseUrl,
		);
		const source = firstImage(await response.json());
		if (!source) throw new Error("No image data found in response");
		callbacks.image?.(source, request.model);
		return;
	}
	if (request.endpoint === "image_edits") {
		for (const file of request.images) {
			const body = new FormData();
			body.set("model", request.model);
			body.set("prompt", request.input);
			body.set("image", file);
			const response = await inferenceRequest(
					"/images/edits",
					request.auth,
					"openai",
					{ method: "POST", headers: inferenceHeaders(request.tags, false), body, signal: request.signal },
					request.customBaseUrl,
				),
				source = firstImage(await response.json());
			if (source) callbacks.image?.(source, request.model);
		}
		return;
	}
	if (request.endpoint === "speech") {
		const response = await inferenceRequest(
			"/audio/speech",
			request.auth,
			"openai",
			{
				method: "POST",
				headers: inferenceHeaders(request.tags),
				signal: request.signal,
				body: JSON.stringify({ model: request.model, input: request.input, voice: request.voice }),
			},
			request.customBaseUrl,
		);
		callbacks.audio?.(URL.createObjectURL(await response.blob()), request.model);
		return;
	}
	if (request.endpoint === "transcription") {
		if (!request.audio) throw new Error("Please upload an audio file for transcription");
		const body = new FormData();
		body.set("model", request.model);
		body.set("file", request.audio);
		const response = await inferenceRequest(
				"/audio/transcriptions",
				request.auth,
				"openai",
				{ method: "POST", headers: inferenceHeaders(request.tags, false), signal: request.signal, body },
				request.customBaseUrl,
			),
			payload = asRecord(await response.json());
		if (typeof payload?.text !== "string" || !payload.text) throw new Error("No transcription text in response");
		callbacks.text(payload.text, request.model);
		return;
	}
	if (request.endpoint === "embeddings") {
		const response = await inferenceRequest(
				"/embeddings",
				request.auth,
				"openai",
				{
					method: "POST",
					headers: inferenceHeaders(request.tags),
					signal: request.signal,
					body: JSON.stringify({ model: request.model, input: request.input }),
				},
				request.customBaseUrl,
			),
			payload = asRecord(await response.json()),
			embedding = records(payload?.data)[0]?.embedding;
		if (!embedding) throw new Error("No embedding returned from server");
		callbacks.embeddings?.(JSON.stringify(embedding), string(payload?.model) ?? request.model);
		return;
	}
	throw new Error("Select a supported endpoint before sending a request");
}
