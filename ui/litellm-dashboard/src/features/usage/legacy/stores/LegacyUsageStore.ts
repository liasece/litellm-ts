import { reactive } from "vue";
import { legacyUsageApi, type LegacyRow } from "../api/LegacyUsageApi";
import { fillLegacyDates, legacyAdmin, legacyKeyRankings, legacyMonth, legacyRows } from "../logic/LegacyUsageDataLogic";
import type { KeyRanking } from "../../support/UsageModels";
import type { DateRangeValue } from "../../../date-range/support/DateRangeModels";
export function createLegacyUsageStore(role: string, api = legacyUsageApi, now: () => Date = () => new Date()) {
	const month = legacyMonth(now());
	const state = reactive({
		settings: {} as LegacyRow,
		spend: [] as LegacyRow[],
		monthlySpend: 0,
		topKeys: [] as KeyRanking[],
		topModels: [] as LegacyRow[],
		providers: [] as LegacyRow[],
		teams: [] as LegacyRow[],
		teamNames: [] as string[],
		teamTotals: [] as { name: string; value: number }[],
		tags: [] as LegacyRow[],
		tagNames: [] as string[],
		endUsers: [] as LegacyRow[],
		activity: {} as LegacyRow,
		modelActivity: [] as LegacyRow[],
	});
	let disposed = false;
	async function fetchJob<T>(request: () => Promise<T>, apply: (result: T) => void) {
		try {
			const result = await request();
			if (!disposed) apply(result);
		} catch {
			/* The legacy page keeps each previous dataset when an individual query fails. */
		}
	}
	async function endUsers(key: string | null, range?: DateRangeValue) {
		await fetchJob(
			() => api.endUsers(key, range?.from, range?.to),
			(value) => (state.endUsers = value),
		);
	}
	async function tags(range: DateRangeValue, selected?: string[]) {
		try {
			const settings = await api.settings();
			if (settings.DISABLE_EXPENSIVE_DB_QUERIES) return;
			await fetchJob(
				() => api.tags(range.from, range.to, selected?.length ? selected : undefined),
				(value) => (state.tags = value),
			);
		} catch {
			/* Other legacy datasets remain usable if settings cannot be read. */
		}
	}
	async function initialize(range: DateRangeValue) {
		try {
			const settings = await api.settings();
			if (disposed) return;
			state.settings = settings;
			if (settings.DISABLE_EXPENSIVE_DB_QUERIES) return;
		} catch {
			/* The original starts data queries when the settings read fails. */
		}
		const jobs = [
			fetchJob(
				() => api.spend(),
				(rows) => {
					const filled = fillLegacyDates(rows, month.first, month.last, [], now());
					state.spend = filled;
					state.monthlySpend = Number(filled.reduce((sum, row) => sum + (Number(row.spend) || 0), 0).toFixed(2));
				},
			),
			fetchJob(
				() => api.providers(month.from, month.to),
				(value) => (state.providers = value),
			),
			fetchJob(
				() => api.topKeys(),
				(value) => (state.topKeys = legacyKeyRankings(value)),
			),
			fetchJob(
				() => api.topModels(),
				(value) => (state.topModels = value.map((row) => ({ key: row.model, spend: Number(row.total_spend) }))),
			),
			fetchJob(
				() => api.activity(month.from, month.to),
				(value) =>
					(state.activity = {
						...value,
						daily_data: fillLegacyDates(
							legacyRows(value.daily_data),
							month.first,
							month.last,
							["api_requests", "total_tokens"],
							now(),
						),
					}),
			),
			fetchJob(
				() => api.modelActivity(month.from, month.to),
				(value) =>
					(state.modelActivity = value.map((row) => ({
						...row,
						daily_data: fillLegacyDates(
							legacyRows(row.daily_data),
							month.first,
							month.last,
							["api_requests", "total_tokens"],
							now(),
						),
					}))),
			),
		];
		if (legacyAdmin(role))
			jobs.push(
				fetchJob(
					() => api.teams(),
					(value) => {
						const names = Array.isArray(value.teams) ? value.teams.map(String) : [];
						state.teams = fillLegacyDates(legacyRows(value.daily_spend), month.first, month.last, names, now());
						state.teamNames = names;
						state.teamTotals = legacyRows(value.total_spend_per_team).map((row) => ({
							name: String(row.team_id || ""),
							value: Number(row.total_spend || 0),
						}));
					},
				),
				fetchJob(
					() => api.tagNames(),
					(value) => (state.tagNames = value),
				),
				fetchJob(
					() => api.tags(range.from, range.to),
					(value) => (state.tags = value),
				),
				endUsers(null),
			);
		await Promise.all(jobs);
	}
	return {
		state,
		month,
		initialize,
		endUsers,
		tags,
		dispose: () => {
			disposed = true;
		},
	};
}
