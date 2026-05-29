/**
 * Image 端点 — 图片生成（桩）
 *
 * 对应 OpenAI 的 /v1/images/generations 端点。
 * 当前返回 501 Not Implemented。
 * 未来可对接 DALL-E、Stable Diffusion 等图片生成 Provider。
 */

import { post, noAuth, body } from "../core/api/decorators";
import { ApiError } from "../core/api/ApiError";

/** 图片生成请求体 */
interface ImageGenerationRequest {
	/** 文本描述 */
	prompt: string;
	/** 生成模型 */
	model?: string;
	/** 生成数量 */
	n?: number;
	/** 图片尺寸 */
	size?: string;
	/** 图片格式 */
	response_format?: string;
	/** 图片风格 */
	style?: string;
	/** 图片质量 */
	quality?: string;
}

/**
 * Image 控制器（桩）
 *
 * 当前不支持图片生成，所有请求返回 501 Not Implemented。
 */
export class ImageController {
	/**
	 * 图片生成
	 * @param _reqBody - 图片生成请求体
	 */
	@noAuth()
	@post("/v1/images/generations")
	async generate(@body() _reqBody: ImageGenerationRequest): Promise<void> {
		throw ApiError.unavailable("图片生成暂未实现，将在后续版本支持");
	}
}
