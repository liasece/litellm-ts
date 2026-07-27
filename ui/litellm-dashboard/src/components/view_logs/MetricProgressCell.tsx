import { Tooltip } from "antd";
import type { ReactNode } from "react";

const GRADIENT_CLASS_NAMES = {
	blue: "from-transparent via-blue-400/15 to-blue-500/30",
	green: "from-transparent via-green-400/15 to-green-500/30",
	red: "from-transparent via-red-400/15 to-red-500/30",
} as const;

interface MetricProgressProps {
	ariaLabel?: string;
	children: ReactNode;
	className: string;
	color: keyof typeof GRADIENT_CLASS_NAMES;
	maxValue: number;
	progressTestId: string;
	value: number;
}

export function MetricProgress({
	ariaLabel,
	children,
	className,
	color,
	maxValue,
	progressTestId,
	value,
}: MetricProgressProps) {
	const progressPercent = Math.min(Math.max((value / maxValue) * 100, 0), 100);
	const hiddenPercent = 100 - progressPercent;

	return (
		<span className={`relative ${className}`} aria-label={ariaLabel}>
			<span
				className={`pointer-events-none absolute inset-0 bg-gradient-to-r ${GRADIENT_CLASS_NAMES[color]}`}
				data-testid={progressTestId}
				style={{ clipPath: `inset(0 ${hiddenPercent}% 0 0)` }}
				aria-hidden="true"
			/>
			<span className="relative z-10 flex items-center gap-1">{children}</span>
		</span>
	);
}

interface MetricProgressCellProps extends Omit<MetricProgressProps, "children" | "className"> {
	displayValue: string;
	tooltip: ReactNode;
}

export function MetricProgressCell({ displayValue, tooltip, ...progressProps }: MetricProgressCellProps) {
	return (
		<Tooltip title={tooltip}>
			<MetricProgress
				{...progressProps}
				className="inline-flex h-7 min-w-20 items-center overflow-hidden rounded px-2 font-mono text-sm tabular-nums"
			>
				{displayValue}
			</MetricProgress>
		</Tooltip>
	);
}
