import { formatNumberWithCommas } from "@/utils/dataUtils";
import type { UserInfoV2Response } from "../../networking";
import { Card, Grid, Text, Title } from "@tremor/react";
import type { TeamDisplayInfo } from "../types";
import UserTeamsCard from "./UserTeamsCard";

interface UserOverviewProps {
  user: UserInfoV2Response;
  teams: TeamDisplayInfo[];
  canManageTeams: boolean;
  teamsExpanded: boolean;
  onTeamsExpandedChange: (expanded: boolean) => void;
  onAddTeam: () => void;
  onRemoveTeam: (team: TeamDisplayInfo) => void;
}

export default function UserOverview({
  user,
  teams,
  canManageTeams,
  teamsExpanded,
  onTeamsExpandedChange,
  onAddTeam,
  onRemoveTeam,
}: UserOverviewProps) {
  return (
    <Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
      <Card>
        <Text>Spend</Text>
        <div className="mt-2">
          <Title>${formatNumberWithCommas(user.spend || 0, 4)}</Title>
          <Text>
            of {user.max_budget !== null ? `$${formatNumberWithCommas(user.max_budget, 4)}` : "Unlimited"}
          </Text>
        </div>
      </Card>

      <UserTeamsCard
        teams={teams}
        canManage={canManageTeams}
        expanded={teamsExpanded}
        onExpandedChange={onTeamsExpandedChange}
        onAdd={onAddTeam}
        onRemove={onRemoveTeam}
      />

      <Card>
        <Text>Personal Models</Text>
        <div className="mt-2">
          {user.models?.length > 0 ? (
            user.models.map((model) => <Text key={model}>{model}</Text>)
          ) : (
            <Text>All proxy models</Text>
          )}
        </div>
      </Card>
    </Grid>
  );
}
