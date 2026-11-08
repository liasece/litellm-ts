export type {
	ModelSpeedReport,
	SpeedBucket,
	SpeedModelSeries,
	SpeedModelWithoutSeries,
	SpeedPoint,
} from "../../../../../../src/shared/ModelSpeed";
export { addDays, currentDayInTimeZone, MIN_OUTPUT_TOKENS_FOR_SPEED } from "../../../../../../src/shared/ModelSpeed";

import type { ModelSpeedReport } from "../../../../../../src/shared/ModelSpeed";
export interface SpeedQuery {
	startDate: string;
	endDate: string;
	timezone: string;
}
export type SpeedApi = (query: SpeedQuery, signal?: AbortSignal) => Promise<ModelSpeedReport>;
