import { LIVE_TAIL_INTERVAL_OPTIONS, type LiveTailIntervalMs } from "./constants";

interface LiveTailBannerProps {
	visible: boolean;
	intervalMs: LiveTailIntervalMs;
	onStop: () => void;
}

export default function LiveTailBanner({ visible, intervalMs, onStop }: LiveTailBannerProps) {
	if (!visible) return null;

	const intervalLabel =
		LIVE_TAIL_INTERVAL_OPTIONS.find((option) => option.value === intervalMs)?.label ?? `${intervalMs}ms`;

	return (
		<div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-4 py-2">
			<span className="text-sm text-green-700">Auto-refreshing every {intervalLabel}</span>
			<button onClick={onStop} className="text-sm text-green-600 hover:text-green-800">
				Stop
			</button>
		</div>
	);
}
