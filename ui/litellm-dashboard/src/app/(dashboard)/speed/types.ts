/**
 * Speed 页面使用的共享契约。
 *
 * 类型、统计门槛与日期工具都来自 src/shared/ModelSpeed，与后端 /global/model_speed
 * 保持同一份定义，避免前后端各写一份后悄悄漂移。
 */

export type {
	ModelSpeedReport,
	SpeedBucket,
	SpeedModelSeries,
	SpeedModelWithoutSeries,
	SpeedPoint,
} from "../../../../../../src/shared/ModelSpeed";

export { addDays, currentDayInTimeZone, MIN_OUTPUT_TOKENS_FOR_SPEED } from "../../../../../../src/shared/ModelSpeed";
