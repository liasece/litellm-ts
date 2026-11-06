import { LIVE_TAIL_INTERVAL_OPTIONS, type LiveTailIntervalMs } from "./constants";

interface LiveTailBannerProps {
	visible: boolean;
	intervalMs: LiveTailIntervalMs;
	connected: boolean;
	onStop: () => void;
}

export default function LiveTailBanner({ visible, intervalMs, connected, onStop }: LiveTailBannerProps) {
	if (!visible) return null;

	const intervalLabel =
		LIVE_TAIL_INTERVAL_OPTIONS.find((option) => option.value === intervalMs)?.label ?? `${intervalMs}ms`;

	return (
		<div
			className={`mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border px-4 py-2 ${
				connected ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
			}`}
		>
			<span className={`text-sm ${connected ? "text-green-700" : "text-amber-700"}`}>
				{connected
					? `Live updates on change; idle refresh every ${intervalLabel}`
					: `Live tail reconnecting; idle refresh every ${intervalLabel}`}
			</span>
			<button onClick={onStop} className="text-sm text-green-600 hover:text-green-800">
				Stop
			</button>
		</div>
	);
}
