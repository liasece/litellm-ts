/**
 * Audio 端点 — 语音合成与转录（桩）
 *
 * 对应 OpenAI 的 /v1/audio/speech 和 /v1/audio/transcriptions 端点。
 * 当前返回 501 Not Implemented。
 * 未来可对接 TTS 和 ASR Provider。
 */

import { post, noAuth, body } from "../core/api/decorators";
import { ApiError } from "../core/api/ApiError";

/** 语音合成请求体 */
interface SpeechRequest {
	/** 输入文本 */
	input: string;
	/** 语音模型 */
	model: string;
	/** 语音名称 */
	voice: string;
	/** 响应格式 */
	response_format?: string;
	/** 语速 */
	speed?: number;
}

/** 转录请求体 */
interface TranscriptionRequest {
	/** 音频文件 */
	file: unknown;
	/** 转录模型 */
	model: string;
	/** 语言 */
	language?: string;
	/** 提示词 */
	prompt?: string;
	/** 响应格式 */
	response_format?: string;
	/** 温度 */
	temperature?: number;
}

/**
 * Audio 控制器（桩）
 *
 * 当前不支持语音功能，所有请求返回 501 Not Implemented。
 */
export class AudioController {
	/**
	 * 语音合成（TTS）
	 * @param _reqBody - 语音合成请求体
	 */
	@noAuth()
	@post("/v1/audio/speech")
	async speech(@body() _reqBody: SpeechRequest): Promise<void> {
		throw ApiError.unavailable("语音合成（TTS）暂未实现，将在后续版本支持");
	}

	/**
	 * 语音转录（ASR）
	 * @param _reqBody - 转录请求体
	 */
	@noAuth()
	@post("/v1/audio/transcriptions")
	async transcribe(@body() _reqBody: TranscriptionRequest): Promise<void> {
		throw ApiError.unavailable("语音转录（ASR）暂未实现，将在后续版本支持");
	}
}
