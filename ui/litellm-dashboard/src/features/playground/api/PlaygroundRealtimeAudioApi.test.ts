import { describe, expect, it } from "vitest";
import { resamplePcm16, encodePcm16, decodePcm16 } from "./PlaygroundRealtimeAudioApi";
import { realtimeSession, realtimeUrl } from "../stores/PlaygroundRealtimeStore";
describe("Realtime voice contract", () => {
	it("resamples microphone audio to 24k PCM16 with clipping and round trips binary frames", () => {
		const pcm = resamplePcm16(new Float32Array([-2, -0.5, 0, 0.5, 2, 0]), 48000);
		expect(Array.from(pcm)).toEqual([-32768, 0, 32767]);
		const decoded = decodePcm16(encodePcm16(pcm));
		expect(Array.from(decoded)).toEqual([-1, 0, 32767 / 32768]);
	});
	it("uses server VAD only while recording and builds the realtime websocket URL", () => {
		expect(realtimeSession("alloy", true).session.turn_detection).toEqual({ type: "server_vad" });
		expect(realtimeSession("alloy").session.turn_detection).toBeNull();
		const url = new URL(realtimeUrl("model name", "https://proxy.example.test/base"));
		expect(url.protocol).toBe("wss:");
		expect(url.pathname).toBe("/base/v1/realtime");
		expect(url.searchParams.get("model")).toBe("model name");
	});
});
