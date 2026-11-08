import { onScopeDispose, readonly, shallowRef } from "vue";
const now = shallowRef(Date.now());
let subscribers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
export function useLiveDurationClock() {
	if (++subscribers === 1) {
		now.value = Date.now();
		timer = setInterval(() => {
			now.value = Date.now();
		}, 1000);
	}
	onScopeDispose(() => {
		if (--subscribers === 0 && timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	});
	return readonly(now);
}
