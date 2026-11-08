export interface DateRangeValue {
	from?: Date;
	to?: Date;
	selectValue?: string;
}
export interface RelativeDateOption {
	label: string;
	shortLabel: string;
	days?: number;
	start?: "month" | "year";
}
export const relativeDateOptions: RelativeDateOption[] = [
	{ label: "Today", shortLabel: "today", days: 0 },
	{ label: "Last 3 days", shortLabel: "3d", days: 2 },
	{ label: "Last 7 days", shortLabel: "7d", days: 6 },
	{ label: "Last 30 days", shortLabel: "30d", days: 30 },
	{ label: "Month to date", shortLabel: "MTD", start: "month" },
	{ label: "Year to date", shortLabel: "YTD", start: "year" },
];
