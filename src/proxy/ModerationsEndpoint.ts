/**
 * Moderations 端点 — 内容审核（桩）
 *
 * 对应 OpenAI 的 /v1/moderations 端点。
 * 当前返回默认通过（flagged: false），不做实际审核。
 * 未来可对接 Azure Content Safety 等审核服务。
 */

import { post, noAuth, body } from "../core/api/decorators";

/** 审核分类得分 */
interface ModerationCategoryScores {
	sexual: number;
	hate: number;
	harassment: number;
	"self-harm": number;
	"sexual/minors": number;
	hate_threatening: number;
	"violence/graphic": number;
	"self-harm/intent": number;
	"self-harm/instruction": number;
	harassment_threatening: number;
	violence: number;
}

/** 审核分类结果 */
interface ModerationCategories {
	sexual: boolean;
	hate: boolean;
	harassment: boolean;
	"self-harm": boolean;
	"sexual/minors": boolean;
	hate_threatening: boolean;
	"violence/graphic": boolean;
	"self-harm/intent": boolean;
	"self-harm/instruction": boolean;
	harassment_threatening: boolean;
	violence: boolean;
}

/** 单条审核结果 */
interface ModerationResult {
	/** 是否被标记 */
	flagged: boolean;
	/** 各分类的布尔结果 */
	categories: ModerationCategories;
	/** 各分类的得分 */
	category_scores: ModerationCategoryScores;
}

/** 审核 API 请求体 */
interface ModerationRequest {
	/** 待审核的输入文本（字符串或数组） */
	input: string | string[];
	/** 模型名称（桩实现忽略此字段） */
	model?: string;
}

/** 审核 API 响应 */
interface ModerationResponse {
	/** 唯一标识符 */
	id: string;
	/** 模型名称 */
	model: string;
	/** 审核结果列表 */
	results: ModerationResult[];
}

/** 默认审核结果（全部通过） */
const DEFAULT_CATEGORIES: ModerationCategories = {
	sexual: false,
	hate: false,
	harassment: false,
	"self-harm": false,
	"sexual/minors": false,
	hate_threatening: false,
	"violence/graphic": false,
	"self-harm/intent": false,
	"self-harm/instruction": false,
	harassment_threatening: false,
	violence: false,
};

/** 默认审核得分（全部 0） */
const DEFAULT_SCORES: ModerationCategoryScores = {
	sexual: 0,
	hate: 0,
	harassment: 0,
	"self-harm": 0,
	"sexual/minors": 0,
	hate_threatening: 0,
	"violence/graphic": 0,
	"self-harm/intent": 0,
	"self-harm/instruction": 0,
	harassment_threatening: 0,
	violence: 0,
};

/**
 * Moderations 控制器（桩）
 *
 * 当前总是返回未标记（flagged: false）。
 * 部署真实审核服务后替换实现即可。
 */
export class ModerationsController {
	/**
	 * 内容审核
	 * @param reqBody - 审核请求体
	 * @returns 审核结果（当前总是放行）
	 */
	@noAuth()
	@post("/v1/moderations")
	async moderate(@body() reqBody: ModerationRequest): Promise<ModerationResponse> {
		const input = reqBody.input;
		const inputs = Array.isArray(input) ? input : [input];

		const results: ModerationResult[] = inputs.map(() => ({
			flagged: false,
			categories: { ...DEFAULT_CATEGORIES },
			category_scores: { ...DEFAULT_SCORES },
		}));

		return {
			id: `mod-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			model: reqBody.model ?? "text-moderation-stub",
			results: results,
		};
	}
}
