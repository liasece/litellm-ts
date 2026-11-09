import { shallowReactive } from "vue";
import type { PlaygroundAuth } from "../support/PlaygroundModels";
import { inferenceUrl } from "../api/PlaygroundTransportApi";
import { createRealtimeAudio } from "../api/PlaygroundRealtimeAudioApi";
import { asRecord, records, json } from "../logic/PlaygroundValueLogic";
export function realtimeSession(voice: string, recording = false) {
	return {
		type: "session.update",
		session: {
			modalities: ["text", "audio"],
			voice,
			input_audio_format: "pcm16",
			output_audio_format: "pcm16",
			input_audio_transcription: { model: "gpt-4o-mini-transcribe" },
			turn_detection: recording ? { type: "server_vad" } : null,
		},
	};
}
export function realtimeUrl(model: string, base?: string) {
	const url = new URL(inferenceUrl("/v1/realtime", base));
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("model", model);
	return url.href;
}
export function createPlaygroundRealtimeStore(options: {
	auth: () => PlaygroundAuth;
	model: () => string;
	baseUrl: () => string | undefined;
	socket?: (url: string, protocols: string[]) => WebSocket;
	audio?: ReturnType<typeof createRealtimeAudio>;
}) {
	const state = shallowReactive({
			messages: [] as { role: "user" | "assistant" | "status"; content: string; id: string }[],
			input: "",
			connected: false,
			connecting: false,
			recording: false,
			voice: "alloy",
		}),
		audio = options.audio ?? createRealtimeAudio();
	let socket: WebSocket | undefined,
		generation = 0;
	function append(role: "user" | "assistant" | "status", content: string) {
		state.messages = [...state.messages, { role, content, id: crypto.randomUUID() }];
	}
	function assistant(text: string) {
		const last = state.messages.at(-1);
		if (last?.role === "assistant") state.messages = [...state.messages.slice(0, -1), { ...last, content: last.content + text }];
		else append("assistant", text);
	}
	function send(value: unknown) {
		if (socket?.readyState === WebSocket.OPEN) socket.send(json(value));
	}
	function connect() {
		if (socket) return;
		if (!options.model()) {
			append("status", "Please select a model first");
			return;
		}
		state.connecting = true;
		const current = ++generation;
		try {
			audio.initialize();
			const auth = options.auth(),
				ws = (options.socket ?? ((url, protocols) => new WebSocket(url, protocols)))(
					realtimeUrl(options.model(), options.baseUrl()),
					auth.kind === "virtual-key" ? ["realtime", "openai-insecure-api-key." + auth.apiKey] : ["realtime"],
				);
			socket = ws;
			ws.onopen = () => {
				if (generation !== current) return;
				state.connected = true;
				state.connecting = false;
				append("status", "Connected to realtime API");
			};
			ws.onmessage = async (event) => {
				try {
					const raw =
						event.data instanceof Blob
							? await event.data.text()
							: event.data instanceof ArrayBuffer
								? new TextDecoder().decode(event.data)
								: event.data;
					if (generation !== current || typeof raw !== "string") return;
					const data = asRecord(JSON.parse(raw));
					if (!data) return;
					switch (data.type) {
						case "session.created":
							send(realtimeSession(state.voice));
							break;
						case "response.audio.delta":
							if (typeof data.delta === "string") audio.play(data.delta);
							break;
						case "response.audio_transcript.delta":
						case "response.text.delta":
							if (typeof data.delta === "string") assistant(data.delta);
							break;
						case "conversation.item.input_audio_transcription.completed":
							if (typeof data.transcript === "string") append("user", data.transcript);
							break;
						case "response.done": {
							const last = state.messages.at(-1);
							if (last?.role === "assistant" && last.content) break;
							const text = records(asRecord(data.response)?.output)
								.flatMap((item) => records(item.content))
								.map((item) => item.text || item.transcript)
								.filter((value): value is string => typeof value === "string")
								.join("");
							if (text) append("assistant", text);
							break;
						}
						case "error":
							append("status", "Error: " + (asRecord(data.error)?.message || json(data.error)));
							break;
					}
				} catch {
					/* Unsupported server frames do not disturb the session. */
				}
			};
			ws.onerror = () => {
				if (generation !== current) return;
				append("status", "WebSocket error");
				state.connected = false;
				state.connecting = false;
				stopRecording();
			};
			ws.onclose = () => {
				if (generation !== current) return;
				append("status", "Disconnected");
				state.connected = false;
				state.connecting = false;
				socket = undefined;
				stopRecording();
				audio.dispose();
			};
		} catch (error) {
			state.connecting = false;
			append("status", "Connection failed: " + (error instanceof Error ? error.message : String(error)));
			audio.dispose();
		}
	}
	async function startRecording() {
		if (socket?.readyState !== WebSocket.OPEN) return;
		send(realtimeSession(state.voice, true));
		const current = generation;
		try {
			if ((await audio.record((value) => send({ type: "input_audio_buffer.append", audio: value }))) && current === generation) {
				state.recording = true;
				append("status", "🎙️ Listening...");
			}
		} catch (error) {
			append("status", "Microphone error: " + (error instanceof Error ? error.message : String(error)));
		}
	}
	function stopRecording() {
		audio.stopRecording();
		state.recording = false;
	}
	function sendText() {
		const text = state.input.trim();
		if (!text || socket?.readyState !== WebSocket.OPEN) return;
		append("user", text);
		state.input = "";
		send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
		send({ type: "response.create" });
	}
	function disconnect() {
		generation++;
		const ws = socket;
		socket = undefined;
		ws?.close();
		stopRecording();
		audio.dispose();
		state.connected = false;
		state.connecting = false;
		if (ws) append("status", "Disconnected");
	}
	return { state, connect, disconnect, startRecording, stopRecording, sendText, dispose: disconnect };
}
