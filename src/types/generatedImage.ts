/**
 * 内置图像生成返回给上游调用方的图片形态。
 *
 * 放在独立叶子文件里：`db/schema/imageCompletions.ts` 要按它给 jsonb 列标注类型，而 schema 一旦
 * 依赖 capability 实现，仓储（schema 的使用者）就会被卷进 capabilitiy 的依赖环。
 */

/**
 *
 */
export interface BuiltinGeneratedImage {
	/**
	 *
	 */
	readonly id: string;
	/**
	 *
	 */
	readonly action: "create" | "edit";
	/**
	 *
	 */
	readonly ref: string;
	/**
	 *
	 */
	readonly b64Json: string;
	/**
	 *
	 */
	readonly mediaType: string;
	/**
	 *
	 */
	readonly outputFormat: "png" | "jpeg" | "webp";
	/**
	 *
	 */
	readonly prompt: string;
	/**
	 *
	 */
	readonly model: string;
	/**
	 *
	 */
	readonly size?: string;
	/**
	 *
	 */
	readonly quality?: string;
	/**
	 *
	 */
	readonly background?: string;
}
