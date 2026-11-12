/**
 * 在途请求的实时快照表（进程内存，不是数据库表）。
 *
 * 详情页要展示的是「这条流现在长什么样」，而这份内容本来就在执行流的累加器里。过去它需要
 * 每 400ms 整体重写进 `ActiveRequests.metadata`（单次约 15ms 的 jsonb 写放大），页面再每
 * 250ms 轮询修订号、变更时整行回读——一次观看等于每秒 2.5 次大写入加数次大读取，而数据
 * 从未离开过本进程。
 *
 * 这里把同一份快照留在内存：流开始时登记一个 `snapshot()` 闭包，flush 时 publish 最新内容并
 * 通知订阅者，流结束时注销（订阅者收到 null，据此改读最终落库负载）。数据库只保留登记行与
 * 流结束时的最后一次落库，列表、租约、结算和崩溃恢复都走那条路径。
 *
 * 生产是单进程 `node dist/main.js`，内存即真相；将来多副本时需要把这里换成共享通道。
 */

/** 订阅者收到的推送；null 表示这条请求的实时快照已注销（流结束）。 */
export type LiveSnapshotListener = (snapshot: unknown | null) => void;

/** 对外暴露的只读视图。 */
export interface LiveResponseEntry {
	/** 生成当前快照；返回 null 表示还没有可展示的内容。 */
	readonly snapshot: () => unknown | null;
	/** 最近一次 publish 的时间戳。 */
	readonly publishedAt: number;
}

/** 内部条目：除只读视图外还持有最近一次快照与订阅者。 */
interface LiveResponseRecord {
	readonly requestId: string;
	readonly registeredAt: number;
	readonly snapshot: () => unknown | null;
	readonly listeners: Set<LiveSnapshotListener>;
	latest: unknown | null;
	publishedAt: number;
	/** 单调递增的发布序号，供订阅方廉价判断「内存里是否有新内容」。 */
	publishSequence: number;
}

/**
 * 硬上限：单进程同时只有个位数在途流，64 条足够，且把「漏注销」
 * 最坏情况下的内存占用限在几十 MB（单条快照 100–600KB）。
 */
const MAX_ENTRIES = 64;

/** 单条快照的最长存活时间；覆盖任何正常流式请求。 */
const MAX_AGE_MS = 30 * 60 * 1_000;

const records = new Map<string, LiveResponseRecord>();

/** 全局发布序号：订阅方比较它就能知道快照有没有更新，不必序列化正文。 */
let publishCounter = 0;

/**
 * 先订阅、后登记：详情页可能在执行流还没登记快照时就已连上（登记的时机是上游响应返回），
 * 没有这层暂存，这批订阅者会永远收不到推送，只能等结束检查。
 */
const pendingListeners = new Map<string, Set<LiveSnapshotListener>>();

/**
 * 清理超龄条目，并保证条目数不越界。
 * @param now - 当前时间戳
 */
function prune(now: number): void {
	for (const [requestId, record] of records) {
		if (now - record.registeredAt > MAX_AGE_MS) {
			records.delete(requestId);
		}
	}
	while (records.size >= MAX_ENTRIES) {
		const oldest = records.keys().next();
		if (oldest.done === true) {
			return;
		}
		records.delete(oldest.value);
	}
}

/**
 * 登记一条在途请求的实时快照。
 * @param requestId - 请求 ID
 * @param snapshot - 生成当前快照的闭包（复用流式调度器的序列化函数）
 * @returns 注销函数；流结束、异常或客户端断开时调用
 */
export function registerLiveResponse(requestId: string, snapshot: () => unknown | null): () => void {
	if (requestId.length === 0) {
		return () => undefined;
	}
	const now = Date.now();
	prune(now);
	records.delete(requestId);
	const listeners = new Set<LiveSnapshotListener>();
	const pending = pendingListeners.get(requestId);
	if (pending !== undefined) {
		for (const listener of pending) {
			listeners.add(listener);
		}
		pendingListeners.delete(requestId);
	}
	records.set(requestId, {
		requestId: requestId,
		registeredAt: now,
		publishedAt: 0,
		snapshot: snapshot,
		latest: null,
		listeners: listeners,
		publishSequence: 0,
	});
	return () => unregisterLiveResponse(requestId);
}

/**
 * 读取一条在途请求的只读视图。
 * @param requestId - 请求 ID
 */
export function getLiveResponse(requestId: string): LiveResponseEntry | undefined {
	return records.get(requestId);
}

/**
 * 直接取当前快照；没有登记时返回 null（调用方回落到数据库里的内容）。
 * @param requestId - 请求 ID
 */
export function readLiveResponseSnapshot(requestId: string): unknown | null {
	const record = records.get(requestId);
	if (record === undefined) {
		return null;
	}
	try {
		return record.snapshot() ?? null;
	} catch {
		return null;
	}
}

/**
 * 读取某条请求的发布序号；0 表示还没发布过或没有登记。
 *
 * 会话时间线用它判断「内存里有没有新内容」，避免每秒序列化几百 KB 正文。
 * @param requestId - 请求 ID
 */
export function readLiveResponseSequence(requestId: string): number {
	return records.get(requestId)?.publishSequence ?? 0;
}

/**
 * 发布一次快照并通知订阅者。没有登记（流已结束）时忽略。
 * @param requestId - 请求 ID
 * @param snapshot - 最新快照
 */
export function publishLiveResponse(requestId: string, snapshot: unknown | null): void {
	const record = records.get(requestId);
	if (record === undefined) {
		return;
	}
	record.latest = snapshot;
	record.publishedAt = Date.now();
	publishCounter += 1;
	record.publishSequence = publishCounter;
	for (const listener of record.listeners) {
		try {
			listener(snapshot);
		} catch {
			// 单个订阅者出错不能影响其他订阅者与请求本身。
		}
	}
}

/**
 * 订阅实时快照。订阅时不会立刻回调：调用方先自行渲染首帧，之后的变更由 publish 推送。
 * @param requestId - 请求 ID
 * @param listener - 收到新快照；null 表示实时快照已注销
 * @returns 取消订阅函数
 */
export function subscribeLiveResponse(requestId: string, listener: LiveSnapshotListener): () => void {
	const record = records.get(requestId);
	if (record === undefined) {
		let pending = pendingListeners.get(requestId);
		if (pending === undefined) {
			pending = new Set<LiveSnapshotListener>();
			pendingListeners.set(requestId, pending);
		}
		pending.add(listener);
		return () => {
			pendingListeners.get(requestId)?.delete(listener);
			if (pendingListeners.get(requestId)?.size === 0) {
				pendingListeners.delete(requestId);
			}
		};
	}
	record.listeners.add(listener);
	return () => {
		records.get(requestId)?.listeners.delete(listener);
	};
}

/**
 * 注销实时快照：先通知订阅者「实时数据结束」，再删除条目。
 * @param requestId - 请求 ID
 */
export function unregisterLiveResponse(requestId: string): void {
	const record = records.get(requestId);
	if (record === undefined) {
		return;
	}
	records.delete(requestId);
	for (const listener of record.listeners) {
		try {
			listener(null);
		} catch {
			// 同上：订阅者异常不影响注销。
		}
	}
}

/** 当前条目数；用于观测与测试。 */
export function liveResponseCount(): number {
	return records.size;
}

/** 等待登记的订阅者数量；用于观测与测试。 */
export function pendingLiveResponseCount(): number {
	return pendingListeners.size;
}

/** 清空快照表；仅供测试使用。 */
export function resetLiveResponseRegistry(): void {
	records.clear();
	pendingListeners.clear();
	publishCounter = 0;
}
