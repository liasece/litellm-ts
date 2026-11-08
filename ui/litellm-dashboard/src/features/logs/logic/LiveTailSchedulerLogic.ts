export interface LiveTailSchedulerEnvironment {
	now: () => number;
	hidden: () => boolean;
	setTimer: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	clearTimer: (timer: ReturnType<typeof setTimeout>) => void;
}
const browserEnvironment: LiveTailSchedulerEnvironment = {
	now: () => Date.now(),
	hidden: () => typeof document !== "undefined" && document.visibilityState === "hidden",
	setTimer: (callback, delay) => setTimeout(callback, delay),
	clearTimer: (timer) => clearTimeout(timer),
};

export function createLiveTailScheduler(
	refresh: () => Promise<unknown>,
	initialInterval: number,
	environment: LiveTailSchedulerEnvironment = browserEnvironment,
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
