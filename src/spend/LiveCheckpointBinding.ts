/**
 * 把一条流式请求的「内存实时快照」与「流结束时的一次落库」绑在一起。
 *
 * 流式过程中详情页要的是这条流当前长什么样，内容本来就在执行流的累加器里；把它整体写进
 * `ActiveRequests.metadata` 再读回来只是在原地打转（单次重写约 15ms，一个被观看的流每
 * 400ms 一次）。这里把序列化结果直接发布到进程内存（LiveResponseRegistry），只保留流结束
 * 时的一次落库，用于崩溃恢复与「刚结束、还没结算」的短暂窗口。
 *
 * 返回的对象形状就是流式调度器的配置项：`serialize`、`write`、`onDispose`，调用方直接
 * `new StreamingCheckpointScheduler(bindLiveCheckpoint(...))`。
 */

import {
	publishLiveResponse,
	registerLiveResponse,
	unregisterLiveResponse,
} from "./LiveResponseRegistry";
import type { StreamingCheckpointWriteOptions } from "./StreamingCheckpointScheduler";

/**
 * 绑定一条流的实时快照。
 * @template T - checkpoint 负载类型
 * @param requestId - 请求 ID
 * @param serialize - 生成当前快照；返回 null 表示还没有可展示内容
 * @param persistFinal - 流结束时的落库动作（应当幂等、失败只记录不抛出）
 */
export function bindLiveCheckpoint<T>(
	requestId: string,
	serialize: () => T | null,
	persistFinal: (checkpoint: T) => Promise<unknown>,
): {
	serialize: () => T | null;
	write: (checkpoint: T, options: StreamingCheckpointWriteOptions) => void | Promise<unknown>;
	onDispose: () => void;
} {
	registerLiveResponse(requestId, serialize);
	return {
		serialize: serialize,
		write: (checkpoint: T, options: StreamingCheckpointWriteOptions): void | Promise<unknown> => {
			// 先发布到内存：订阅中的详情页在 400ms 窗口结束时立刻拿到新内容，不经过数据库。
			publishLiveResponse(requestId, checkpoint);
			if (!options.final) {
				return undefined;
			}
			return persistFinal(checkpoint);
		},
		onDispose: (): void => {
			unregisterLiveResponse(requestId);
		},
	};
}
