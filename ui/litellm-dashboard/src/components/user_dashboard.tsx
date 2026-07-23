"use client";
import { Col, Grid } from "@tremor/react";
import { Typography } from "antd";
import { useSearchParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import Onboarding from "../app/onboarding/page";
import { fetchTeams } from "./common_components/fetch_teams";
import { KeyResponse, Team } from "./key_team_helpers/key_list";
import {
	getProxyBaseUrl,
	getProxyUISettings,
	logoutWebUiSession,
	modelAvailableCall,
	Organization,
	userGetInfoV2,
} from "./networking";
import CreateKey, { CreateKeyPrefillData } from "./organisms/create_key_button";
import { VirtualKeysTable } from "./VirtualKeysPage/VirtualKeysTable";

export interface ProxySettings {
	PROXY_BASE_URL: string | null;
	PROXY_LOGOUT_URL: string | null;
	LITELLM_UI_API_DOC_BASE_URL?: string | null;
	DEFAULT_TEAM_DISABLED: boolean;
	SSO_ENABLED: boolean;
	DISABLE_EXPENSIVE_DB_QUERIES: boolean;
	NUM_SPEND_LOGS_ROWS: number;
}

export type UserInfo = {
	models: string[];
	max_budget?: number | null;
	spend: number;
};

interface UserDashboardProps {
	userID: string | null;
	userRole: string | null;
	userEmail: string | null;
	teams: Team[] | null;
	keys: any[] | null;
	setUserRole: React.Dispatch<React.SetStateAction<string>>;
	setUserEmail: React.Dispatch<React.SetStateAction<string | null>>;
	setTeams: React.Dispatch<React.SetStateAction<Team[] | null>>;
	setKeys: (keys: KeyResponse[]) => void;
	premiumUser: boolean;
	organizations: Organization[] | null;
	addKey: (data: any) => void;
	createClicked: boolean;
	autoOpenCreate?: boolean;
	prefillData?: CreateKeyPrefillData;
}

type TeamInterface = {
	models: any[];
	team_id: null;
	team_alias: string;
};

const UserDashboard: React.FC<UserDashboardProps> = ({
	userID,
	userRole,
	teams,
	keys,
	setUserRole,
	userEmail,
	setUserEmail,
	setTeams,
	setKeys,
	premiumUser,
	organizations,
	addKey,
	createClicked,
	autoOpenCreate,
	prefillData,
}) => {
	const [userSpendData, setUserSpendData] = useState<UserInfo | null>(null);
	const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);

	// Assuming useSearchParams() hook exists and works in your setup
	const searchParams = useSearchParams()!;

	const invitation_id = searchParams.get("invitation_id");
	const accessToken = "cookie-session";
	const [teamSpend, setTeamSpend] = useState<number | null>(null);
	const [userModels, setUserModels] = useState<string[]>([]);
	const [proxySettings, setProxySettings] = useState<ProxySettings | null>(null);
	const [selectedTeam, setSelectedTeam] = useState<any | null>(null);

	// Clear session storage on page unload so next load fetches fresh data.
	// Note: MCP auth tokens are persistent and should not be cleared on page refresh
	// They are only cleared on logout
	useEffect(() => {
		const handleBeforeUnload = () => {
			sessionStorage.clear();
		};
		window.addEventListener("beforeunload", handleBeforeUnload);
		return () => window.removeEventListener("beforeunload", handleBeforeUnload);
	}, []);

	// 身份由父页面的 /auth/session 响应提供；浏览器不再解码 token。
	useEffect(() => {
		if (userID && accessToken && userRole && !userSpendData) {
			const cachedUserModels = sessionStorage.getItem("userModels" + userID);
			if (cachedUserModels) {
				setUserModels(JSON.parse(cachedUserModels));
			} else {
				console.log(`currentOrg: ${JSON.stringify(currentOrg)}`);
				const fetchData = async () => {
					try {
						const proxy_settings: ProxySettings = await getProxyUISettings(accessToken);
						setProxySettings(proxy_settings);

						const response = await userGetInfoV2(accessToken, userID);

						setUserSpendData(response);

						sessionStorage.setItem("userSpendData" + userID, JSON.stringify(response));

						const model_available = await modelAvailableCall(accessToken, userID, userRole);
						// loop through model_info["data"] and create an array of element.model_name
						let available_model_names = model_available["data"].map((element: { id: string }) => element.id);
						console.log("available_model_names:", available_model_names);
						setUserModels(available_model_names);

						console.log("userModels:", userModels);

						sessionStorage.setItem("userModels" + userID, JSON.stringify(available_model_names));
					} catch (error: any) {
						console.error("There was an error fetching the data", error);
						if (error.message.includes("Invalid proxy server token passed")) {
							gotoLogin();
						}
						// Optionally, update your UI to reflect the error state here as well
					}
				};
				fetchData();
				fetchTeams(accessToken, userID, userRole, currentOrg, setTeams);
			}
		}
	}, [userID, accessToken, userRole]);

	useEffect(() => {
		console.log(
			`currentOrg: ${JSON.stringify(currentOrg)}, accessToken: ${accessToken}, userID: ${userID}, userRole: ${userRole}`,
		);
		if (accessToken) {
			console.log(`fetching teams`);
			fetchTeams(accessToken, userID, userRole, currentOrg, setTeams);
		}
	}, [currentOrg]);

	useEffect(() => {
		// This code will run every time selectedTeam changes
		if (keys !== null && selectedTeam !== null && selectedTeam !== undefined && selectedTeam.team_id !== null) {
			let sum = 0;
			console.log(`keys: ${JSON.stringify(keys)}`);
			for (const key of keys) {
				if (selectedTeam.hasOwnProperty("team_id") && key.team_id !== null && key.team_id === selectedTeam.team_id) {
					sum += key.spend;
				}
			}
			console.log(`sum: ${sum}`);
			setTeamSpend(sum);
		} else if (keys !== null) {
			// sum the keys which don't have team-id set (default team)
			let sum = 0;
			for (const key of keys) {
				sum += key.spend;
			}
			setTeamSpend(sum);
		}
	}, [selectedTeam]);

	if (invitation_id != null) {
		return <Onboarding></Onboarding>;
	}

	function gotoLogin() {
		void logoutWebUiSession().catch(() => undefined);
		const baseUrl = getProxyBaseUrl();

		console.log("proxyBaseUrl:", baseUrl);

		const url = baseUrl ? `${baseUrl}/sso/key/generate` : `/sso/key/generate`;

		console.log("Full URL:", url);
		window.location.href = url;

		return null;
	}

	if (userID == null) {
		return <h1>User ID is not set</h1>;
	}

	if (userRole == null) {
		setUserRole("App Owner");
	}

	if (userRole && userRole == "Admin Viewer") {
		const { Title, Paragraph } = Typography;
		return (
			<div>
				<Title level={1}>Access Denied</Title>
				<Paragraph>Ask your proxy admin for access to create keys</Paragraph>
			</div>
		);
	}

	console.log("inside user dashboard, selected team", selectedTeam);
	return (
		<div className="w-full mx-4 h-[75vh]">
			<Grid numItems={1} className="gap-2 p-8 w-full mt-2">
				<Col numColSpan={1} className="flex flex-col gap-2">
					<CreateKey
						key={selectedTeam ? selectedTeam.team_id : null}
						team={selectedTeam as Team | null}
						teams={teams as Team[]}
						data={keys}
						addKey={addKey}
						autoOpenCreate={autoOpenCreate}
						prefillData={prefillData}
					/>
					<VirtualKeysTable teams={teams} organizations={organizations} />
				</Col>
			</Grid>
		</div>
	);
};

export default UserDashboard;
