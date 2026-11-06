import { MetricProgressCell } from "./MetricProgressCell";
import { useLiveDurationMs } from "./useLiveClock";

/** Duration 进度条满格对应的秒数，与列表 Duration 单元格保持一致。 */
const DURATION_PROGRESS_MAX_SECONDS = 30;

export interface LiveDurationCellProps {
	/** 请求开始时间，用于按秒推算已经过去的时长。 */
	readonly startTime: string | number | null | undefined;
	/** 服务端给出的耗时（毫秒），作为下限避免客户端时钟偏慢时回退。 */
	readonly serverDurationMs?: number | null;
}

/**
 * 进行中请求的 Duration 单元格。
 *
 * 只订阅共享秒级时钟，逐秒重渲染自己；表格其余列不会因为计时而更新。
 * @param props - 开始时间与服务端耗时
 */
export function LiveDurationCell({ startTime, serverDurationMs }: LiveDurationCellProps) {
	const durationMs = useLiveDurationMs(startTime, true, serverDurationMs) ?? 0;
	const seconds = (durationMs / 1000).toFixed(2);
	return (
		<MetricProgressCell
			ariaLabel={`Duration ${seconds} seconds`}
			color="red"
			displayValue={seconds}
			maxValue={DURATION_PROGRESS_MAX_SECONDS}
			progressTestId="duration-progress"
			tooltip={`${durationMs}ms`}
			value={durationMs / 1000}
		/>
	);
}
