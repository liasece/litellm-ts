import { SettingOutlined } from "@ant-design/icons";
import { Button, Select } from "antd";
import ModelListPagination from "./ModelListPagination";

interface ModelListToolbarProps {
	modelNameSearch: string;
	showFilters: boolean;
	selectedModelGroup: string | null;
	selectedAccessGroup: string | null;
	availableModelGroups: string[];
	availableModelAccessGroups: string[];
	currentPage: number;
	pageSize: number;
	pagination: {
		total_count: number;
		total_pages: number;
	};
	isLoading: boolean;
	isRunningAllHealthChecks: boolean;
	onSearchChange: (value: string) => void;
	onToggleFilters: () => void;
	onResetFilters: () => void;
	onModelGroupChange: (value: string) => void;
	onAccessGroupChange: (value: string | null) => void;
	onRunAllHealthChecks: () => void;
	onOpenModelSettings: () => void;
	onPageChange: (page: number) => void;
}

function SearchIcon() {
	return (
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
	);
}

function FilterIcon() {
	return (
		<svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"
			/>
		</svg>
	);
}

function ResetIcon() {
	return (
		<svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
			<path
				strokeLinecap="round"
				strokeLinejoin="round"
				strokeWidth={2}
				d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
			/>
		</svg>
	);
}

export default function ModelListToolbar({
	modelNameSearch,
	showFilters,
	selectedModelGroup,
	selectedAccessGroup,
	availableModelGroups,
	availableModelAccessGroups,
	currentPage,
	pageSize,
	pagination,
	isLoading,
	isRunningAllHealthChecks,
	onSearchChange,
	onToggleFilters,
	onResetFilters,
	onModelGroupChange,
	onAccessGroupChange,
	onRunAllHealthChecks,
	onOpenModelSettings,
	onPageChange,
}: ModelListToolbarProps) {
	return (
		<div className="border-b px-6 py-4">
			<div className="flex flex-col space-y-4">
				<div className="flex items-center justify-between gap-3">
					<div className="flex flex-wrap items-center gap-3">
						<div className="relative w-64">
							<input
								type="search"
								placeholder="Search model names..."
								className="w-full rounded-md border px-3 py-2 pl-8 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
								value={modelNameSearch}
								onChange={(event) => onSearchChange(event.target.value)}
							/>
							<SearchIcon />
						</div>
						<button
							type="button"
							className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50 ${
								showFilters ? "bg-gray-100" : ""
							}`}
							onClick={onToggleFilters}
						>
							<FilterIcon />
							Filters
						</button>
						<button
							type="button"
							className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
							onClick={onResetFilters}
						>
							<ResetIcon />
							Reset Filters
						</button>
					</div>

					<div className="flex items-center gap-2">
						<Button
							onClick={onRunAllHealthChecks}
							loading={isRunningAllHealthChecks}
							disabled={isRunningAllHealthChecks}
						>
							Run All Checks
						</Button>
						<Button icon={<SettingOutlined />} onClick={onOpenModelSettings} title="Model Settings" />
					</div>
				</div>

				{showFilters && (
					<div className="mt-3 flex flex-wrap items-center gap-3">
						<Select
							className="w-64"
							value={selectedModelGroup ?? "all"}
							onChange={onModelGroupChange}
							placeholder="Filter by Public Model Name"
							showSearch
							options={[
								{ value: "all", label: "All Models" },
								{ value: "wildcard", label: "Wildcard Models (*)" },
								...availableModelGroups.map((group) => ({ value: group, label: group })),
							]}
						/>
						<Select
							className="w-64"
							value={selectedAccessGroup ?? "all"}
							onChange={(value) => onAccessGroupChange(value === "all" ? null : value)}
							placeholder="Filter by Model Access Group"
							showSearch
							options={[
								{ value: "all", label: "All Model Access Groups" },
								...availableModelAccessGroups.map((accessGroup) => ({
									value: accessGroup,
									label: accessGroup,
								})),
							]}
						/>
					</div>
				)}

				<ModelListPagination
					currentPage={currentPage}
					pageSize={pageSize}
					pagination={pagination}
					isLoading={isLoading}
					onPageChange={onPageChange}
				/>
			</div>
		</div>
	);
}
