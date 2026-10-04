import { useEffect, useRef, useState } from "react";
import { KeyResponse } from "../key_team_helpers/key_list";
import { keyListCall, Organization } from "../networking";
import { Team } from "../key_team_helpers/key_list";
import { fetchAllOrganizations, fetchAllTeams } from "./filter_helpers";
import { debounce } from "lodash";
import { defaultPageSize } from "../constants";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";

export interface FilterState {
	"Team ID": string;
	"Organization ID": string;
	"Key Alias": string;
	[key: string]: string;
	"User ID": string;
	"Sort By": string;
	"Sort Order": string;
}

// Client-side application of the Team / Organization filters. Kept pure so the
// render-phase derivation shares one implementation.
function filterKeysByFilters(keys: KeyResponse[] | null, filters: FilterState): KeyResponse[] {
	if (!keys) {
		return [];
	}

	let result = [...keys];

	// Apply Team ID filter
	if (filters["Team ID"]) {
		result = result.filter((key) => key.team_id === filters["Team ID"]);
	}

	// Apply Organization ID filter
	if (filters["Organization ID"]) {
		result = result.filter((key) => (key.organization_id ?? key.org_id) === filters["Organization ID"]);
	}

	return result;
}

export function useFilterLogic({
	keys,
	teams,
	organizations,
}: {
	keys: KeyResponse[];
	teams: Team[] | null;
	organizations: Organization[] | null;
}) {
	const defaultFilters: FilterState = {
		"Team ID": "",
		"Organization ID": "",
		"Key Alias": "",
		"User ID": "",
		"Sort By": "created_at",
		"Sort Order": "desc",
	};
	const { accessToken } = useAuthorized();
	const [filters, setFilters] = useState<FilterState>(defaultFilters);
	const [allTeams, setAllTeams] = useState<Team[]>(teams || []);
	const [allOrganizations, setAllOrganizations] = useState<Organization[]>(organizations || []);
	const [filteredKeys, setFilteredKeys] = useState<KeyResponse[]>(keys);
	const [filteredTotalCount, setFilteredTotalCount] = useState<number | null>(null);
	const lastSearchTimestamp = useRef(0);
	const debouncedSearchRef = useRef<((filters: FilterState) => void) | null>(null);

	// Create the debounced search after commit rather than during render, so its
	// callback (which calls Date.now and updates a ref) is not render-phase code.
	// As before, the instance is recreated only when the access token changes and
	// in-flight calls from the previous instance are left alone.
	useEffect(() => {
		debouncedSearchRef.current = debounce(async (filters: FilterState) => {
			if (!accessToken) {
				return;
			}

			const currentTimestamp = Date.now();
			lastSearchTimestamp.current = currentTimestamp;

			try {
				// Make the API call using userListCall with all filter parameters
				const data = await keyListCall(
					accessToken,
					filters["Organization ID"] || null,
					filters["Team ID"] || null,
					filters["Key Alias"] || null,
					filters["User ID"] || null,
					filters["Key Hash"] || null,
					1, // Reset to first page when searching
					defaultPageSize,
					filters["Sort By"] || null,
					filters["Sort Order"] || null,
				);

				// Only update state if this is the most recent search
				if (currentTimestamp === lastSearchTimestamp.current) {
					if (data) {
						setFilteredKeys(data.keys);
						setFilteredTotalCount(data.total_count ?? null);
						console.log("called from debouncedSearch filters:", JSON.stringify(filters));
						console.log("called from debouncedSearch data:", JSON.stringify(data));
					}
				}
			} catch (error) {
				console.error("Error searching users:", error);
			}
		}, 300);
	}, [accessToken]);
	// Apply filters to keys whenever keys or filters change. The client-side filter is a
	// pure function of those inputs, so it is recomputed during render with a guard
	// instead of being pushed into state from an effect.
	const [prevKeyFilterInputs, setPrevKeyFilterInputs] = useState<[KeyResponse[] | null, FilterState]>([null, filters]);
	if (prevKeyFilterInputs[0] !== keys || prevKeyFilterInputs[1] !== filters) {
		setPrevKeyFilterInputs([keys, filters]);
		setFilteredKeys(filterKeysByFilters(keys, filters));
	}

	// Fetch all data for filters when component mounts
	useEffect(() => {
		const loadAllFilterData = async () => {
			// Load all teams - no organization filter needed here
			const teamsData = await fetchAllTeams(accessToken);
			if (teamsData.length > 0) {
				setAllTeams(teamsData);
			}

			// Load all organizations
			const orgsData = await fetchAllOrganizations(accessToken);
			if (orgsData.length > 0) {
				setAllOrganizations(orgsData);
			}
		};

		if (accessToken) {
			loadAllFilterData();
		}
	}, [accessToken]);

	// Track the teams prop and only adopt it when it is larger than the current set
	// (the fetched list may already be broader). Adjusting state during render with a
	// guard replaces the prop-syncing effect.
	const [prevTeamsProp, setPrevTeamsProp] = useState<Team[] | null>(teams);
	if (teams !== prevTeamsProp) {
		setPrevTeamsProp(teams);
		if (teams && teams.length > 0) {
			const nextTeams = teams;
			setAllTeams((currentTeams) => {
				// Only update if we don't already have a larger set of teams
				return currentTeams.length < nextTeams.length ? nextTeams : currentTeams;
			});
		}
	}

	// Same guarded adoption for the organizations prop.
	const [prevOrganizationsProp, setPrevOrganizationsProp] = useState<Organization[] | null>(organizations);
	if (organizations !== prevOrganizationsProp) {
		setPrevOrganizationsProp(organizations);
		if (organizations && organizations.length > 0) {
			const nextOrganizations = organizations;
			setAllOrganizations((currentOrganizations) => {
				// Only update if we don't already have a larger set of organizations
				return currentOrganizations.length < nextOrganizations.length ? nextOrganizations : currentOrganizations;
			});
		}
	}

	const handleFilterChange = (newFilters: Record<string, string>, skipDebounce: boolean = false) => {
		// Update filters state
		setFilters({
			"Team ID": newFilters["Team ID"] || "",
			"Organization ID": newFilters["Organization ID"] || "",
			"Key Alias": newFilters["Key Alias"] || "",
			"User ID": newFilters["User ID"] || "",
			"Sort By": newFilters["Sort By"] || "created_at",
			"Sort Order": newFilters["Sort Order"] || "desc",
		});

		// Only trigger debouncedSearch if skipDebounce is false
		// This allows sorting to be handled by the parent component's useKeys hook
		if (!skipDebounce) {
			// Fetch keys based on new filters
			const updatedFilters = {
				...filters,
				...newFilters,
			};
			debouncedSearchRef.current?.(updatedFilters);
		}
	};

	const handleFilterReset = () => {
		// Reset filters state
		setFilters(defaultFilters);
		setFilteredTotalCount(null);

		// Reset selections
		debouncedSearchRef.current?.(defaultFilters);
	};

	return {
		filters,
		filteredKeys,
		filteredTotalCount,
		allTeams,
		allOrganizations,
		handleFilterChange,
		handleFilterReset,
	};
}
