import { TrashIcon } from "@heroicons/react/outline";
import { Button, TableCell, TableRow } from "@tremor/react";
import type { TeamDisplayInfo } from "../types";

interface UserTeamRowProps {
  team: TeamDisplayInfo;
  canManage: boolean;
  onRemove: (team: TeamDisplayInfo) => void;
}

export default function UserTeamRow({ team, canManage, onRemove }: UserTeamRowProps) {
  return (
    <TableRow>
      <TableCell>{team.team_alias || team.team_id}</TableCell>
      {canManage && (
        <TableCell className="text-right">
          <Button icon={TrashIcon} variant="light" size="xs" color="red" onClick={() => onRemove(team)} />
        </TableCell>
      )}
    </TableRow>
  );
}
