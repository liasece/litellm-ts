import { onScopeDispose, readonly, shallowRef } from "vue";

const TICK_MS = 1_000;
const now = shallowRef(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 秒级共享时钟：同一页可能同时有多条模型在冷却，每张标签各起一个定时器会浪费，
 * 还会让同一屏的倒计时在秒边界上错开。最后一个冷却标签卸载时停止。
 */
export function useModelCooldownClock() {
	if (++subscribers === 1) {
		now.value = Date.now();
		timer = setInterval(() => {
			now.value = Date.now();
		}, TICK_MS);
	}
	onScopeDispose(() => {
		if (--subscribers === 0 && timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	});
	return readonly(now);
}
