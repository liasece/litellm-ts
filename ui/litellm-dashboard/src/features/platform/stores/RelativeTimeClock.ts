import { onScopeDispose, readonly, shallowRef } from "vue";

const REFRESH_MS = 30_000;
const now = shallowRef(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;

/**
 * 分钟级相对时间使用的共享时钟。
 *
 * 配额卡通常同时出现很多张，各自起定时器既浪费又会造成同一屏上的倒计时不同步。
 * 30 秒刷新一次足以在跨分钟时及时更新文案，最后一张卡卸载时停止定时器。
 */
export function useRelativeTimeClock() {
	if (++subscribers === 1) {
		now.value = Date.now();
		timer = setInterval(() => {
			now.value = Date.now();
		}, REFRESH_MS);
	}
	onScopeDispose(() => {
		if (--subscribers === 0 && timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	});
	return readonly(now);
}
