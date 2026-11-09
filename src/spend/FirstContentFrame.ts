/**
 * 首个内容帧写回下游的时刻（Dashboard TTFT 的终点）。
 *
 * 流式请求的 TTFT 只有在「第一个内容帧真正写给客户端」时才成立：上游先到的 chunk 可能被过滤
 * （例如只有 usage）、客户端可能已经断开、能力分支还要等 agent loop 收尾才整体写出。这个时刻
 * 一旦确定就不会再变，因此记录的同时立即补写进 `LiteLLM_ActiveRequests.completion_start_time`：
 * 外界在整条流还没结束时就能从日志列表/详情读到 TTFT，不必等最终 SpendLog 落账。
 *
 * 最终 SpendLog 必须复用这里返回的时间戳，保证「进行中」与「落账后」的 TTFT 一致。补写失败只
 * 影响实时展示，不向请求路径抛错（Journal 内部吞掉错误），计费与最终日志仍由 trackSpendLog 负责。
 */
import type { Request } from "express";

declare global {
	namespace Express {
		interface Request {
			/** 首个内容帧写回下游的时刻；由 `markFirstContentFrame` 写入一次。 */
			litellmFirstContentFrameAt?: Date;
		}
	}
}

/**
 * 记录首个内容帧写回下游的时刻，并立即把 TTFT 补写进在途日志行。
 * @param req - 当前请求；同一请求的后续调用只返回首次记录的时间
 * @param at - 该帧实际写出的时刻，默认为调用时的当前时间
 * @returns 首次记录的时间戳，供最终 SpendLog 复用
 */
export function markFirstContentFrame(req: Request, at: Date = new Date()): Date {
	const recorded = req.litellmFirstContentFrameAt;
	if (recorded !== undefined) {
		return recorded;
	}
	req.litellmFirstContentFrameAt = at;
	req.activeRequestJournal?.markCompletionStart(at);
	return at;
}
