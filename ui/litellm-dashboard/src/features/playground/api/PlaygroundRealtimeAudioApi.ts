export function resamplePcm16(input: Float32Array, sourceRate: number, targetRate = 24000): Int16Array {
	const ratio = sourceRate / targetRate,
		length = sourceRate === targetRate ? input.length : Math.round(input.length / ratio),
		pcm = new Int16Array(length);
	for (let i = 0; i < length; i++) {
		const value = Math.max(-1, Math.min(1, input[Math.round(i * ratio)] ?? 0));
		pcm[i] = value < 0 ? value * 0x8000 : value * 0x7fff;
	}
	return pcm;
}
export function encodePcm16(samples: Int16Array) {
	const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
	let binary = "";
	for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
	return btoa(binary);
}
export function decodePcm16(base64: string) {
	const binary = atob(base64),
		bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
	const pcm = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2)),
		result = new Float32Array(pcm.length);
	for (let index = 0; index < pcm.length; index++) result[index] = pcm[index] / 32768;
	return result;
}
export function createRealtimeAudio() {
	let context: AudioContext | undefined,
		stream: MediaStream | undefined,
		processor: ScriptProcessorNode | undefined,
		source: MediaStreamAudioSourceNode | undefined,
		nextPlay = 0,
		epoch = 0;
	const playing = new Set<AudioBufferSourceNode>();
	function initialize() {
		context ??= new AudioContext({ sampleRate: 24000 });
		if (context.state === "suspended") void context.resume();
		return context;
	}
	function play(base64: string) {
		const ctx = initialize(),
			samples = decodePcm16(base64);
		if (!samples.length) return;
		const buffer = ctx.createBuffer(1, samples.length, 24000);
		buffer.getChannelData(0).set(samples);
		const node = ctx.createBufferSource();
		node.buffer = buffer;
		node.connect(ctx.destination);
		playing.add(node);
		node.onended = () => {
			playing.delete(node);
			node.disconnect();
		};
		const start = Math.max(ctx.currentTime, nextPlay);
		node.start(start);
		nextPlay = start + buffer.duration;
	}
	function stopRecording() {
		epoch++;
		processor?.disconnect();
		processor = undefined;
		source?.disconnect();
		source = undefined;
		stream?.getTracks().forEach((track) => track.stop());
		stream = undefined;
	}
	async function record(send: (audio: string) => void) {
		stopRecording();
		const current = epoch,
			media = await navigator.mediaDevices.getUserMedia({ audio: true });
		if (current !== epoch) {
			media.getTracks().forEach((track) => track.stop());
			return false;
		}
		stream = media;
		const ctx = initialize();
		source = ctx.createMediaStreamSource(media);
		processor = ctx.createScriptProcessor(4096, 1, 1);
		processor.onaudioprocess = (event) => send(encodePcm16(resamplePcm16(event.inputBuffer.getChannelData(0), ctx.sampleRate)));
		source.connect(processor);
		processor.connect(ctx.destination);
		return true;
	}
	function dispose() {
		stopRecording();
		for (const node of playing) {
			try {
				node.stop();
			} catch {
				/* Already ended. */
			}
			node.disconnect();
		}
		playing.clear();
		void context?.close();
		context = undefined;
		nextPlay = 0;
	}
	return { initialize, play, record, stopRecording, dispose };
}
