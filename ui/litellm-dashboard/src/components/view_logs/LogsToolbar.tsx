import { SyncOutlined } from "@ant-design/icons";
import { Button } from "antd";
import moment from "moment";
import { useEffect, useRef, useState } from "react";
import { LIVE_TAIL_INTERVAL_OPTIONS, QUICK_SELECT_OPTIONS, type LiveTailIntervalMs } from "./constants";
import { getTimeRangeDisplay } from "./logs_utils";

export interface LogsTimeInterval {
	value: number;
	unit: string;
}

interface LogsToolbarProps {
	searchTerm: string;
	startTime: string;
	endTime: string;
	customDate: boolean;
	selectedInterval: LogsTimeInterval;
	liveTailIntervalMs: LiveTailIntervalMs;
	fetching: boolean;
	onSearchTermChange: (value: string) => void;
	onStartTimeChange: (value: string) => void;
	onEndTimeChange: (value: string) => void;
	onCustomDateChange: (custom: boolean) => void;
	onSelectedIntervalChange: (interval: LogsTimeInterval) => void;
	onLiveTailIntervalChange: (intervalMs: LiveTailIntervalMs) => void;
	onRefresh: () => void;
	onPageReset: () => void;
}

export default function LogsToolbar(props: LogsToolbarProps) {
	const [quickSelectOpen, setQuickSelectOpen] = useState(false);
	const quickSelectRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (quickSelectRef.current && !quickSelectRef.current.contains(event.target as Node)) {
				setQuickSelectOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, []);

	const selectedOption = QUICK_SELECT_OPTIONS.find(
		(option) => option.value === props.selectedInterval.value && option.unit === props.selectedInterval.unit,
	);
	const displayLabel = props.customDate
		? getTimeRangeDisplay(true, props.startTime, props.endTime)
		: selectedOption?.label;

	return (
		<div className="flex w-full max-w-full flex-col items-start justify-between space-y-4 md:flex-row md:items-center md:space-y-0">
			<div className="flex w-full max-w-full flex-wrap items-center gap-3">
				<div className="relative w-64 min-w-0 flex-shrink-0">
					<input
						type="text"
						placeholder="Search by Request ID"
						className="w-full rounded-md border py-2 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
						value={props.searchTerm}
						onChange={(event) => props.onSearchTermChange(event.target.value)}
					/>
					<svg
						className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-500"
						fill="none"
						stroke="currentColor"
						viewBox="0 0 24 24"
					>
						<path
							strokeLinecap="round"
							strokeLinejoin="round"
							strokeWidth={2}
							d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
						/>
					</svg>
				</div>

				<div className="flex min-w-0 flex-shrink items-center gap-2">
					<div className="relative z-50" ref={quickSelectRef}>
						<button
							onClick={() => setQuickSelectOpen((open) => !open)}
							className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
						>
							<svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
								/>
							</svg>
							{displayLabel}
						</button>
						{quickSelectOpen && (
							<div className="absolute right-0 z-50 mt-2 w-64 rounded-lg border bg-white p-2 shadow-lg">
								<div className="space-y-1">
									{QUICK_SELECT_OPTIONS.map((option) => (
										<button
											key={option.label}
											className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-50 ${
												displayLabel === option.label ? "bg-blue-50 text-blue-600" : ""
											}`}
											onClick={() => {
												props.onPageReset();
												props.onEndTimeChange(moment().format("YYYY-MM-DDTHH:mm"));
												props.onStartTimeChange(
													moment()
														.subtract(option.value, option.unit as moment.unitOfTime.DurationConstructor)
														.format("YYYY-MM-DDTHH:mm"),
												);
												props.onSelectedIntervalChange({ value: option.value, unit: option.unit });
												props.onCustomDateChange(false);
												setQuickSelectOpen(false);
											}}
										>
											{option.label}
										</button>
									))}
									<div className="my-2 border-t" />
									<button
										className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-gray-50 ${
											props.customDate ? "bg-blue-50 text-blue-600" : ""
										}`}
										onClick={() => props.onCustomDateChange(!props.customDate)}
									>
										Custom Range
									</button>
								</div>
							</div>
						)}
					</div>

					<div className="flex items-center gap-2">
						<label htmlFor="live-tail-interval" className="text-sm font-medium text-gray-900">
							Live Tail
						</label>
						<select
							id="live-tail-interval"
							aria-label="Live Tail refresh interval"
							className="rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
							value={props.liveTailIntervalMs}
							onChange={(event) => props.onLiveTailIntervalChange(Number(event.target.value) as LiveTailIntervalMs)}
						>
							{LIVE_TAIL_INTERVAL_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</div>

					<Button
						type="default"
						icon={<SyncOutlined spin={props.fetching} />}
						onClick={props.onRefresh}
						disabled={props.fetching}
						title="Fetch data"
					>
						{props.fetching ? "Fetching" : "Fetch"}
					</Button>
				</div>

				{props.customDate && (
					<div className="flex items-center gap-2">
						<input
							type="datetime-local"
							value={props.startTime}
							onChange={(event) => {
								props.onStartTimeChange(event.target.value);
								props.onPageReset();
							}}
							className="rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
						<span className="text-gray-500">to</span>
						<input
							type="datetime-local"
							value={props.endTime}
							onChange={(event) => {
								props.onEndTimeChange(event.target.value);
								props.onPageReset();
							}}
							className="rounded-md border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</div>
				)}
			</div>
		</div>
	);
}
