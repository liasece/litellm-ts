import { FilterInput } from "@/components/common_components/Filters/FilterInput";
import { FiltersButton } from "@/components/common_components/Filters/FiltersButton";
import { ResetFiltersButton } from "@/components/common_components/Filters/ResetFiltersButton";
import { Select, SelectItem } from "@tremor/react";
import { CircleUserRound, Search, User } from "lucide-react";
import type { UserFilterState } from "../types";

interface UserTableFiltersProps {
  filters: UserFilterState;
  initialFilters: UserFilterState;
  possibleUIRoles: Record<string, Record<string, string>> | null;
  teams: Array<{ team_id: string; team_alias?: string | null }> | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onChange: (update: Partial<UserFilterState>) => void;
}

export default function UserTableFilters({
  filters,
  initialFilters,
  possibleUIRoles,
  teams,
  expanded,
  onExpandedChange,
  onChange,
}: UserTableFiltersProps) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <FilterInput
          placeholder="Search by email..."
          value={filters.email}
          onChange={(value) => onChange({ email: value })}
          icon={Search}
        />
        <FiltersButton
          onClick={() => onExpandedChange(!expanded)}
          active={expanded}
          hasActiveFilters={Boolean(filters.user_id || filters.user_role || filters.team)}
        />
        <ResetFiltersButton onClick={() => onChange(initialFilters)} />
      </div>

      {expanded && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <FilterInput
            placeholder="Filter by User ID"
            value={filters.user_id}
            onChange={(value) => onChange({ user_id: value })}
            icon={User}
          />
          <FilterInput
            placeholder="Filter by SSO ID"
            value={filters.sso_user_id}
            onChange={(value) => onChange({ sso_user_id: value })}
            icon={CircleUserRound}
          />
          <div className="w-64">
            <Select
              value={filters.user_role}
              onValueChange={(value) => onChange({ user_role: value })}
              placeholder="Select Role"
            >
              {possibleUIRoles &&
                Object.entries(possibleUIRoles).map(([key, value]) => (
                  <SelectItem key={key} value={key}>
                    {value.ui_label}
                  </SelectItem>
                ))}
            </Select>
          </div>
          <div className="w-64">
            <Select
              value={filters.team}
              onValueChange={(value) => onChange({ team: value })}
              placeholder="Select Team"
            >
              {teams?.map((team) => (
                <SelectItem key={team.team_id} value={team.team_id}>
                  {team.team_alias || team.team_id}
                </SelectItem>
              ))}
            </Select>
          </div>
        </div>
      )}
    </>
  );
}
