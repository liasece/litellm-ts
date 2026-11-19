/**
 * 定时刷新调度器：页面可见时才排下一次，请求在途时不叠加，通知到达时合并成一次
 * 尽快执行的刷新。
 *
 * 日志页与上游额度页共用这一份；环境可注入，测试用假定时器就能确定性地覆盖暂停与合并。
 */
export interface RefreshSchedulerEnvironment {
	now: () => number;
	hidden: () => boolean;
	setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}
const browserEnvironment: RefreshSchedulerEnvironment = {
	now: () => Date.now(),
	hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
	setTimer: (callback, delay) => setTimeout(callback, delay),
	clearTimer: (timer) => clearTimeout(timer),
};

export function createRefreshScheduler(
	refresh: () => Promise<unknown>,
	initialInterval: number,
	environment: RefreshSchedulerEnvironment = browserEnvironment,
) {
	let interval = initialInterval;
	let stopped = true;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let timerAt = Infinity;
	let lastRequestAt = environment.now();
	let inFlight = false;
	let pending = false;
	function cancelTimer(): void {
		if (timer !== null) environment.clearTimer(timer);
		timer = null;
		timerAt = Infinity;
	}
	function arm(at: number): void {
		if (stopped || inFlight) return;
		const due = Math.max(at, environment.now());
		if (timer !== null && timerAt <= due) return;
		cancelTimer();
		timerAt = due;
		timer = environment.setTimer(run, due - environment.now());
	}
	function run(): void {
		timer = null;
		timerAt = Infinity;
		if (stopped || inFlight || environment.hidden()) return;
		inFlight = true;
		pending = false;
		lastRequestAt = environment.now();
		void Promise.resolve()
			.then(refresh)
			.catch(() => undefined)
			.finally(() => {
				inFlight = false;
				if (!stopped) arm(lastRequestAt + (pending ? 500 : interval));
			});
	}
	function signal(): void {
		if (stopped) return;
		pending = true;
		arm(lastRequestAt + 500);
	}
	return {
		start(): void {
			if (!stopped) return;
			stopped = false;
			pending = false;
			lastRequestAt = environment.now();
			arm(lastRequestAt + interval);
		},
		stop(): void {
			stopped = true;
			pending = false;
			cancelTimer();
		},
		signal,
		wake(): void {
			if (!stopped && !environment.hidden()) arm(lastRequestAt + (pending ? 500 : interval));
		},
		setInterval(value: number): void {
			interval = value;
			cancelTimer();
			if (!stopped) arm(lastRequestAt + (pending ? 500 : interval));
		},
	};
}
