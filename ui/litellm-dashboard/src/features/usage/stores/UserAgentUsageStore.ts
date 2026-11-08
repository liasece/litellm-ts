import { reactive } from "vue";
import { userAgentUsageApi, type ActiveUserPoint, type UserAgentSummary } from "../api/UserAgentUsageApi";
export function createUserAgentUsageStore(api = userAgentUsageApi) {
	const state = reactive({
		tags: [] as string[],
		tagsLoading: false,
		summary: [] as UserAgentSummary[],
		summaryLoading: false,
		dau: [] as ActiveUserPoint[],
		wau: [] as ActiveUserPoint[],
		mau: [] as ActiveUserPoint[],
		dauLoading: false,
		wauLoading: false,
		mauLoading: false,
	});
	let disposed = false;
	const controllers = new Map<string, AbortController>();
	function request(key: string) {
		controllers.get(key)?.abort();
		const value = new AbortController();
		controllers.set(key, value);
		return value;
	}
	function active(key: string, controller: AbortController) {
		return !disposed && controllers.get(key) === controller && !controller.signal.aborted;
	}
	async function loadTags() {
		const c = request("tags");
		state.tagsLoading = true;
		try {
			const data = await api.tags(c.signal);
			if (active("tags", c)) state.tags = data;
		} catch {
			/* Retain the last successful optional analytics series. */
		} finally {
			if (active("tags", c)) state.tagsLoading = false;
		}
	}
	async function loadActivity(tags: string[], today: Date) {
		await Promise.allSettled(
			(["dau", "wau", "mau"] as const).map(async (period) => {
				const c = request(period);
				state[(period + "Loading") as "dauLoading" | "wauLoading" | "mauLoading"] = true;
				try {
					const data = await api.activity(period, today, tags, c.signal);
					if (active(period, c)) state[period] = data;
				} catch {
					/* Retain the last successful optional analytics series. */
				} finally {
					if (active(period, c)) state[(period + "Loading") as "dauLoading" | "wauLoading" | "mauLoading"] = false;
				}
			}),
		);
	}
	async function loadSummary(from: Date, to: Date, tags: string[]) {
		const c = request("summary");
		state.summaryLoading = true;
		try {
			const data = await api.summary(from, to, tags, c.signal);
			if (active("summary", c)) state.summary = data;
		} catch {
			/* Retain the last successful optional analytics series. */
		} finally {
			if (active("summary", c)) state.summaryLoading = false;
		}
	}
	function dispose() {
		disposed = true;
		for (const c of controllers.values()) c.abort();
		controllers.clear();
	}
	return { state, loadTags, loadActivity, loadSummary, dispose };
}
