import { useMoneyFormatter } from "@/contexts/PriceDisplay";
import { Money } from "@/contexts/PriceDisplay";
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
	const formatMoney = useMoneyFormatter();
	return (
		<Grid numItems={1} numItemsSm={2} numItemsLg={3} className="gap-6">
			<Card>
				<Text>Spend</Text>
				<div className="mt-2">
					<Title>{<Money value={user.spend || 0} decimals={4} />}</Title>
					<Text>of {user.max_budget !== null ? formatMoney(user.max_budget, 4) : "Unlimited"}</Text>
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
