"use client";
import { useKeys } from "@/app/(dashboard)/hooks/keys/useKeys";
import { useOrganizations } from "@/app/(dashboard)/hooks/organizations/useOrganizations";
import {
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  PaginationState,
  SortingState,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableHead,
} from "@tremor/react";
import React, { useEffect, useDeferredValue, useState } from "react";
import { useFilterLogic } from "../key_team_helpers/filter_logic";
import { PaginatedKeyAliasSelect } from "../KeyAliasSelect/PaginatedKeyAliasSelect/PaginatedKeyAliasSelect";
import { KeyResponse, Team } from "../key_team_helpers/key_list";
import FilterComponent, { FilterOption } from "../molecules/filter";
import { Organization } from "../networking";
import KeyInfoView from "../templates/key_info_view";
import useVirtualKeyColumns from "./table/useVirtualKeyColumns";
import VirtualKeysTableHeader from "./table/VirtualKeysTableHeader";
import VirtualKeysTableRow from "./table/VirtualKeysTableRow";
import VirtualKeysTableStateRow from "./table/VirtualKeysTableStateRow";
import VirtualKeysToolbar from "./table/VirtualKeysToolbar";

interface VirtualKeysTableProps {
  teams: Team[] | null;
  organizations: Organization[] | null;
  onSortChange?: (sortBy: string, sortOrder: "asc" | "desc") => void;
  currentSort?: {
    sortBy: string;
    sortOrder: "asc" | "desc";
  };
}

/**
 * VirtualKeysTable – a new table for keys that mimics the table styling used in view_logs.
 * The team selector and filtering have been removed so that all keys are shown.
 */

export function VirtualKeysTable({ teams, organizations, onSortChange, currentSort }: VirtualKeysTableProps) {
  const { data: fetchedOrganizations } = useOrganizations();
  const resolvedOrganizations = fetchedOrganizations ?? organizations ?? [];
  const [selectedKey, setSelectedKey] = useState<KeyResponse | null>(null);
  const [sorting, setSorting] = React.useState<SortingState>(() => {
    if (currentSort) {
      return [
        {
          id: currentSort.sortBy,
          desc: currentSort.sortOrder === "desc",
        },
      ];
    }
    return [
      {
        id: "created_at",
        desc: true,
      },
    ];
  });
  const [tablePagination, setTablePagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  // Extract sort parameters from sorting state
  const sortBy = sorting.length > 0 ? sorting[0].id : null;
  const sortOrder = sorting.length > 0 ? (sorting[0].desc ? "desc" : "asc") : null;

  const {
    data: keys,
    isPending: isLoading,
    isFetching,
    isError,
    refetch,
  } = useKeys(tablePagination.pageIndex + 1, tablePagination.pageSize, {
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    expand: "user",
  });
  // Use the filter logic hook

  const { filters, filteredKeys, filteredTotalCount, allTeams, allOrganizations, handleFilterChange, handleFilterReset } =
    useFilterLogic({
      keys: keys?.keys || [],
      teams,
      organizations,
    });

  // Defer the transition so the button stays in loading state until the table
  // has rendered with the new data (mirrors the spend-logs pattern)
  const isFetchingDeferred = useDeferredValue(isFetching);
  const isButtonLoading = (isFetching || isFetchingDeferred) && !isError;

  const handleRefresh = () => {
    refetch();
  };

  const totalCount = filteredTotalCount ?? keys?.total_count ?? 0;

  // Add a useEffect to call refresh when a key is created
  useEffect(() => {
    if (refetch) {
      const handleStorageChange = () => {
        refetch();
      };

      // Listen for storage events that might indicate a key was created
      window.addEventListener("storage", handleStorageChange);

      return () => {
        window.removeEventListener("storage", handleStorageChange);
      };
    }
  }, [refetch]);

  const columns = useVirtualKeyColumns({
    teams,
    organizations: resolvedOrganizations,
    onSelect: setSelectedKey,
  });

  const filterOptions: FilterOption[] = [
    {
      name: "Team ID",
      label: "Team ID",
      isSearchable: true,
      searchFn: async (searchText: string) => {
        if (!allTeams || allTeams.length === 0) return [];

        const filteredTeams = allTeams.filter(
          (team) =>
            team.team_id.toLowerCase().includes(searchText.toLowerCase()) ||
            (team.team_alias && team.team_alias.toLowerCase().includes(searchText.toLowerCase())),
        );

        return filteredTeams.map((team) => ({
          label: `${team.team_alias || team.team_id} (${team.team_id})`,
          value: team.team_id,
        }));
      },
    },
    {
      name: "Organization ID",
      label: "Organization ID",
      isSearchable: true,
      searchFn: async (searchText: string) => {
        if (!allOrganizations || allOrganizations.length === 0) return [];

        const filteredOrgs = allOrganizations.filter(
          (org) => org.organization_id?.toLowerCase().includes(searchText.toLowerCase()) ?? false,
        );

        return filteredOrgs
          .filter((org) => org.organization_id !== null && org.organization_id !== undefined)
          .map((org) => ({
            label: `${org.organization_id || "Unknown"} (${org.organization_id})`,
            value: org.organization_id as string,
          }));
      },
    },
    {
      name: "Key Alias",
      label: "Key Alias",
      customComponent: PaginatedKeyAliasSelect,
    },
    {
      name: "User ID",
      label: "User ID",
      isSearchable: false,
    },
    {
      name: "Key Hash",
      label: "Key Hash",
      isSearchable: false,
    },
  ];

  // TanStack Table intentionally returns mutable callbacks that React Compiler cannot memoize.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filteredKeys,
    columns: columns.filter((col) => col.id !== "expander"),
    columnResizeMode: "onChange",
    columnResizeDirection: "ltr",
    state: {
      sorting,
      pagination: tablePagination,
    },
    onSortingChange: (updaterOrValue) => {
      const newSorting = typeof updaterOrValue === "function" ? updaterOrValue(sorting) : updaterOrValue;
      setSorting(newSorting);
      if (newSorting && newSorting.length > 0) {
        const sortState = newSorting[0];
        const sortBy = sortState.id;
        const sortOrder = sortState.desc ? "desc" : "asc";
        // Update filters state without triggering debouncedSearch
        // The useKeys hook will automatically refetch with the new sort parameters
        handleFilterChange(
          {
            ...filters,
            "Sort By": sortBy,
            "Sort Order": sortOrder,
          },
          true, // skipDebounce - let useKeys handle the API call with correct page size
        );
        onSortChange?.(sortBy, sortOrder);
      }
    },
    onPaginationChange: setTablePagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableSorting: true,
    manualSorting: false,
    manualPagination: true,
    pageCount: Math.ceil(totalCount / tablePagination.pageSize),
  });

  // Update local sorting state when currentSort prop changes
  React.useEffect(() => {
    if (currentSort) {
      setSorting([
        {
          id: currentSort.sortBy,
          desc: currentSort.sortOrder === "desc",
        },
      ]);
    }
  }, [currentSort]);

  const { pageIndex, pageSize } = table.getState().pagination;
  const start = pageIndex * pageSize + 1;
  const end = Math.min((pageIndex + 1) * pageSize, totalCount);
  const rangeLabel = `${start} - ${end}`;
  return (
    <div className="w-full h-full overflow-hidden">
			<>
			{selectedKey && (
        <KeyInfoView
          keyId={selectedKey.token}
          onClose={() => setSelectedKey(null)}
          keyData={selectedKey}
          teams={allTeams}
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

          <VirtualKeysToolbar
            loading={isLoading}
            refreshing={isButtonLoading}
            rangeLabel={rangeLabel}
            totalCount={totalCount}
            pageIndex={pageIndex}
            pageCount={table.getPageCount()}
            canPreviousPage={table.getCanPreviousPage()}
            canNextPage={table.getCanNextPage()}
            onRefresh={handleRefresh}
            onPreviousPage={() => table.previousPage()}
            onNextPage={() => table.nextPage()}
          />
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
                    {isLoading ? (
                      <VirtualKeysTableStateRow columnCount={columns.length} message="🚅 Loading keys..." />
                    ) : filteredKeys.length > 0 ? (
                      table.getRowModel().rows.map((row) => (
                        <VirtualKeysTableRow key={row.id} row={row} />
                      ))
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
