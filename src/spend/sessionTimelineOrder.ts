import type { SessionTimelineItem } from "./sessionTimeline";

/** Records message precedence from request snapshots without retaining their payloads. */
export class SessionTimelineOrder {
	private _successors = new Map<number, Set<number>>();

	/**
	 * 复制已记录的消息顺序关系。
	 *
	 * 进行中请求的叠加层需要沿用已落库事件之间的先后关系才能正确排序，但叠加层每次都
	 * 重新计算，不能改动已提交的顺序状态，因此复制一份关系表给叠加层使用。
	 */
	public fork(): SessionTimelineOrder {
		const fork = new SessionTimelineOrder();
		for (const [index, successors] of this._successors) {
			fork._successors.set(index, new Set(successors));
		}
		return fork;
	}

	/**
	 * Connect visible occurrences in their original request/response order.
	 * @param indices - Rendered event positions belonging to one request snapshot.
	 */
	public addSequence(indices: readonly number[]): void {
		for (let index = 1; index < indices.length; index += 1) {
			const before = indices[index - 1]!;
			const after = indices[index]!;
			if (before === after) {
				continue;
			}
			let successors = this._successors.get(before);
			if (!successors) {
				successors = new Set();
				this._successors.set(before, successors);
			}
			successors.add(after);
		}
	}

	/**
	 * Follow request history first; only unrelated ready events compete by time.
	 * A heap keeps long sessions at O((events + links) log events).
	 * @param items - Unique render events accumulated by the timeline builder.
	 */
	public order(items: readonly SessionTimelineItem[]): SessionTimelineItem[] {
		const indegrees = new Uint32Array(items.length);
		for (const successors of this._successors.values()) {
			for (const index of successors) {
				indegrees[index]! += 1;
			}
		}
		const times = items.map((item) => {
			const time = Date.parse(item.timestamp);
			return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
		});
		const compare = (left: number, right: number): number => {
			if (times[left] !== times[right]) {
				return times[left]! < times[right]! ? -1 : 1;
			}
			return left - right;
		};
		const ready: number[] = [];
		const push = (index: number): void => {
			let position = ready.length;
			ready.push(index);
			while (position > 0) {
				const parent = (position - 1) >>> 1;
				if (compare(ready[parent]!, index) <= 0) {
					break;
				}
				ready[position] = ready[parent]!;
				position = parent;
			}
			ready[position] = index;
		};
		const pop = (): number => {
			const first = ready[0]!;
			const last = ready.pop()!;
			if (ready.length > 0) {
				let position = 0;
				while (position * 2 + 1 < ready.length) {
					let child = position * 2 + 1;
					if (child + 1 < ready.length && compare(ready[child + 1]!, ready[child]!) < 0) {
						child += 1;
					}
					if (compare(last, ready[child]!) <= 0) {
						break;
					}
					ready[position] = ready[child]!;
					position = child;
				}
				ready[position] = last;
			}
			return first;
		};
		for (let index = 0; index < items.length; index += 1) {
			if (indegrees[index] === 0) {
				push(index);
			}
		}
		const emitted = new Uint8Array(items.length);
		const ordered: SessionTimelineItem[] = [];
		let cycleFallback: number[] | undefined;
		let fallbackIndex = 0;
		while (ordered.length < items.length) {
			if (ready.length === 0) {
				// Contradictory snapshots can form a cycle. Break only the blocked
				// boundary by time, then continue respecting the remaining links.
				cycleFallback ??= items.map((_item, index) => index).sort(compare);
				while (emitted[cycleFallback[fallbackIndex]!] === 1) {
					fallbackIndex += 1;
				}
				push(cycleFallback[fallbackIndex]!);
			}
			const index = pop();
			emitted[index] = 1;
			ordered.push(items[index]!);
			for (const successor of this._successors.get(index) ?? []) {
				if (emitted[successor]) {
					continue;
				}
				indegrees[successor]! -= 1;
				if (indegrees[successor] === 0) {
					push(successor);
				}
			}
		}
		return ordered;
	}
}
