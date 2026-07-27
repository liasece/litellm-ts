"use client";
import { useKeys } from "@/app/(dashboard)/hooks/keys/useKeys";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { getCoreRowModel, PaginationState, SortingState, useReactTable } from "@tanstack/react-table";
import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableHead } from "@tremor/react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import TablePaginationControls from "../common_components/TablePaginationControls";
import { fetchTeamFilterOptions } from "../key_team_helpers/filter_helpers";
import { KeyResponse, Team } from "../key_team_helpers/key_list";
import FilterComponent, { FilterOption } from "../molecules/filter";
import { Organization } from "../networking";
import KeyInfoView from "../templates/key_info_view";
import useVirtualKeyColumns from "../VirtualKeysPage/table/useVirtualKeyColumns";
import VirtualKeysTableHeader from "../VirtualKeysPage/table/VirtualKeysTableHeader";
import VirtualKeysTableRow from "../VirtualKeysPage/table/VirtualKeysTableRow";
import VirtualKeysTableStateRow from "../VirtualKeysPage/table/VirtualKeysTableStateRow";

interface TeamVirtualKeysTableProps {
	teamId: string;
	teamAlias?: string;
	organization: Organization | null;
}

/**
 * TeamVirtualKeysTable – variant of VirtualKeysTable scoped to a single team.
 * Displays all virtual keys belonging to the team with same format and styling.
 */
export function TeamVirtualKeysTable({ teamId, teamAlias, organization }: TeamVirtualKeysTableProps) {
	const { accessToken } = useAuthorized();
	const [selectedKey, setSelectedKey] = useState<KeyResponse | null>(null);
	const [sorting, setSorting] = useState<SortingState>([{ id: "created_at", desc: true }]);
	const [tablePagination, setTablePagination] = useState<PaginationState>({
		pageIndex: 0,
		pageSize: 50,
	});
	const [filters, setFilters] = useState<Record<string, string>>({
		"Organization ID": "",
		"Key Alias": "",
		"User ID": "",
		"Sort By": "created_at",
		"Sort Order": "desc",
	});

	const sortBy = sorting.length > 0 ? sorting[0].id : "created_at";
	const sortOrder = sorting.length > 0 ? (sorting[0].desc ? "desc" : "asc") : "desc";

	const pageIndex = tablePagination.pageIndex;
	const pageSize = tablePagination.pageSize;

	const {
		data: keys,
		isPending: isLoading,
		isFetching,
		refetch,
	} = useKeys(pageIndex + 1, pageSize, {
		teamID: teamId,
		organizationID: filters["Organization ID"]?.trim() || undefined,
		selectedKeyAlias: filters["Key Alias"]?.trim() || undefined,
		userID: filters["User ID"]?.trim() || undefined,
		sortBy: sortBy || undefined,
		sortOrder: sortOrder || undefined,
		expand: "user",
	});

	const displayKeys = useMemo(() => {
		const kList = keys?.keys || [];
		const orgId = organization?.organization_id;
		if (!orgId) return kList;
		return kList.map((k: KeyResponse) => ({
			...k,
			organization_id: (k.organization_id ?? k.org_id) || orgId,
		}));
	}, [keys?.keys, organization?.organization_id]);

	const pageCount = keys?.total_pages ?? 0;
	const currentTeam: Team = useMemo(
		() => ({
			team_id: teamId,
			team_alias: teamAlias || teamId,
			models: [],
			max_budget: null,
			budget_duration: null,
			tpm_limit: null,
			rpm_limit: null,
			organization_id: organization?.organization_id || "",
			created_at: "",
			keys: [],
			members_with_roles: [],
			spend: 0,
		}),
		[teamId, teamAlias, organization],
	);

	const teamFilterOptionsQuery = useQuery({
		queryKey: ["teamFilterOptions", teamId, accessToken],
		queryFn: async () => fetchTeamFilterOptions(accessToken, teamId),
		enabled: !!accessToken && !!teamId,
		staleTime: 30000, // 30 seconds - align with useKeys
	});
	const teamFilterOptions = useMemo(
		() =>
			teamFilterOptionsQuery.data || {
				keyAliases: [],
				organizationIds: [],
				userIds: [],
			},
		[teamFilterOptionsQuery.data],
	);

	const handleStorageChange = useCallback(() => {
		refetch?.();
	}, [refetch]);

	useEffect(() => {
		window.addEventListener("storage", handleStorageChange);
		return () => window.removeEventListener("storage", handleStorageChange);
	}, [handleStorageChange]);

	const handleFilterChange = useCallback((newFilters: Record<string, string>, skipDebounce = false) => {
		setFilters((prev) => ({
			...prev,
			"Organization ID": newFilters["Organization ID"] ?? prev["Organization ID"],
			"Key Alias": newFilters["Key Alias"] ?? prev["Key Alias"],
			"User ID": newFilters["User ID"] ?? prev["User ID"],
			"Sort By": newFilters["Sort By"] ?? prev["Sort By"] ?? "created_at",
			"Sort Order": newFilters["Sort Order"] ?? prev["Sort Order"] ?? "desc",
		}));
		if (!skipDebounce) {
			setTablePagination((prev) => ({ ...prev, pageIndex: 0 }));
		}
	}, []);

	const handleFilterReset = useCallback(() => {
		setFilters({
			"Organization ID": "",
			"Key Alias": "",
			"User ID": "",
			"Sort By": "created_at",
			"Sort Order": "desc",
		});
		setTablePagination((prev) => ({ ...prev, pageIndex: 0 }));
	}, []);

	const filterOptions: FilterOption[] = useMemo(
		() => [
			{
				name: "Organization ID",
				label: "Organization ID",
				isSearchable: true,
				searchFn: async (searchText: string) => {
					const { organizationIds } = teamFilterOptions;
					if (!organizationIds.length) return [];
					const lower = searchText.toLowerCase();
					const filtered = lower ? organizationIds.filter((id) => id.toLowerCase().includes(lower)) : organizationIds;
					return filtered.map((id) => ({ label: id, value: id }));
				},
			},
			{
				name: "Key Alias",
				label: "Key Alias",
				isSearchable: true,
				searchFn: async (searchText: string) => {
					const { keyAliases } = teamFilterOptions;
					const lower = searchText.toLowerCase();
					const filtered = lower ? keyAliases.filter((alias) => alias.toLowerCase().includes(lower)) : keyAliases;
					return filtered.map((alias) => ({ label: alias, value: alias }));
				},
			},
			{
				name: "User ID",
				label: "User ID",
				isSearchable: true,
				searchFn: async (searchText: string) => {
					const { userIds } = teamFilterOptions;
					const lower = searchText.toLowerCase();
					const filtered = lower
						? userIds.filter((u) => u.id.toLowerCase().includes(lower) || u.email.toLowerCase().includes(lower))
						: userIds;
					return filtered.map((u) => ({
						label: u.email ? `${u.id} (${u.email})` : u.id,
						value: u.id,
					}));
				},
			},
		],
		[teamFilterOptions],
	);

	const columns = useVirtualKeyColumns({
		teams: [currentTeam],
		organizations: organization ? [organization] : [],
		onSelect: setSelectedKey,
		scope: "team",
	});

	const handleSortingChange = useCallback(
		(updaterOrValue: React.SetStateAction<SortingState>) => {
			const newSorting = typeof updaterOrValue === "function" ? updaterOrValue(sorting) : updaterOrValue;
			setSorting(newSorting);
			if (newSorting?.length > 0) {
				const sortState = newSorting[0];
				handleFilterChange(
					{
						"Sort By": sortState.id,
						"Sort Order": sortState.desc ? "desc" : "asc",
					},
					true,
				);
			}
		},
		[sorting, handleFilterChange],
	);

	// TanStack Table intentionally returns mutable callbacks that React Compiler cannot memoize.

	const table = useReactTable({
		data: displayKeys,
		columns,
		columnResizeMode: "onChange",
		columnResizeDirection: "ltr",
		state: { sorting, pagination: tablePagination },
		onSortingChange: handleSortingChange,
		onPaginationChange: setTablePagination,
		getCoreRowModel: getCoreRowModel(),
		// getSortedRowModel not needed — manualSorting: true delegates sorting to the server
		enableSorting: true,
		manualSorting: true, // Server sorts via useKeys. Avoid redundant client-side sort
		manualPagination: true,
		pageCount: pageCount,
	});

	return (
		<div className="w-full h-full overflow-hidden">
			<>
				{selectedKey && (
					<KeyInfoView
						keyId={selectedKey.token}
						onClose={() => setSelectedKey(null)}
						keyData={selectedKey}
						teams={[currentTeam]}
						onDelete={refetch}
						onKeyDataUpdate={() => refetch()}
					/>
				)}
				<div className="border-b py-4 flex-1 overflow-hidden">
					<div className="w-full mb-6">
						<FilterComponent
							options={filterOptions}
							onApplyFilters={handleFilterChange}
							initialValues={filters}
							onResetFilters={handleFilterReset}
						/>
					</div>

					<div className="mb-4 flex w-full items-center justify-end">
						<TablePaginationControls
							loading={isLoading || isFetching}
							pageIndex={pageIndex}
							pageCount={table.getPageCount()}
							canPreviousPage={table.getCanPreviousPage()}
							canNextPage={table.getCanNextPage()}
							onPreviousPage={() => table.previousPage()}
							onNextPage={() => table.nextPage()}
						/>
					</div>
					<div className="h-[75vh] overflow-auto">
						<div className="rounded-lg custom-border relative">
							<div className="overflow-x-auto">
								<Table className="[&_td]:py-0.5 [&_th]:py-1" style={{ width: table.getCenterTotalSize() }}>
									<TableHead>
										{table.getHeaderGroups().map((headerGroup) => (
											<VirtualKeysTableHeader
												key={headerGroup.id}
												headerGroup={headerGroup}
												resizeDirection={table.options.columnResizeDirection ?? "ltr"}
											/>
										))}
									</TableHead>
									<TableBody>
										{isLoading || isFetching ? (
											<VirtualKeysTableStateRow columnCount={columns.length} message="Loading keys..." />
										) : displayKeys.length > 0 ? (
											table.getRowModel().rows.map((row) => <VirtualKeysTableRow key={row.id} row={row} />)
										) : (
											<VirtualKeysTableStateRow columnCount={columns.length} message="No keys found" />
										)}
									</TableBody>
								</Table>
							</div>
						</div>
					</div>
				</div>
			</>
		</div>
	);
}
