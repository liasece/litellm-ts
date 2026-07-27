import { PlusIcon } from "@heroicons/react/outline";
import {
  Button,
  Card,
  Table,
  TableBody,
  TableHead,
  TableHeaderCell,
  TableRow,
  Text,
} from "@tremor/react";
import type { TeamDisplayInfo } from "../types";
import UserTeamRow from "./UserTeamRow";

interface UserTeamsCardProps {
  teams: TeamDisplayInfo[];
  canManage: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onAdd: () => void;
  onRemove: (team: TeamDisplayInfo) => void;
}

const COLLAPSED_TEAM_COUNT = 20;

export default function UserTeamsCard({
  teams,
  canManage,
  expanded,
  onExpandedChange,
  onAdd,
  onRemove,
}: UserTeamsCardProps) {
  const visibleTeams = expanded ? teams : teams.slice(0, COLLAPSED_TEAM_COUNT);

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <Text>Teams</Text>
        {canManage && (
          <Button icon={PlusIcon} variant="light" size="xs" onClick={onAdd}>
            Add Team
          </Button>
        )}
      </div>
      <div className="mt-2">
        {teams.length > 0 ? (
          <div className="max-h-60 overflow-y-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Team Name</TableHeaderCell>
                  {canManage && <TableHeaderCell className="text-right">Actions</TableHeaderCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleTeams.map((team) => (
                  <UserTeamRow key={team.team_id} team={team} canManage={canManage} onRemove={onRemove} />
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <Text>No teams</Text>
        )}
        {!expanded && teams.length > COLLAPSED_TEAM_COUNT && (
          <Button variant="light" size="xs" className="mt-2" onClick={() => onExpandedChange(true)}>
            +{teams.length - COLLAPSED_TEAM_COUNT} more
          </Button>
        )}
        {expanded && teams.length > COLLAPSED_TEAM_COUNT && (
          <Button variant="light" size="xs" className="mt-2" onClick={() => onExpandedChange(false)}>
            Show Less
          </Button>
        )}
      </div>
    </Card>
  );
}
