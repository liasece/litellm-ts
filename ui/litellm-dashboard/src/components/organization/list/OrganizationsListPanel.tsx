import OrganizationFilters, { type FilterState } from "@/app/(dashboard)/organizations/OrganizationFilters";
import { RefreshIcon } from "@heroicons/react/outline";
import { Card, Col, Grid, Icon, Tab, TabGroup, TabList, TabPanel, TabPanels, Text } from "@tremor/react";
import type { Organization } from "../../networking";
import OrganizationsListTable from "./OrganizationsListTable";

interface OrganizationsListPanelProps {
	organizations: Organization[];
	filters: FilterState;
	showFilters: boolean;
	lastRefreshed?: string;
	canManage: boolean;
	onRefresh?: () => void;
	onToggleFilters: (value: boolean) => void;
	onFilterChange: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
	onFilterReset: () => void;
	onOpen: (organizationId: string, edit: boolean) => void;
	onDelete: (organizationId: string) => void;
}

export default function OrganizationsListPanel(props: OrganizationsListPanelProps) {
	return (
		<TabGroup className="h-[75vh] w-full gap-2">
			<TabList className="mt-2 flex w-full items-center justify-between">
				<Tab>Your Organizations</Tab>
				<div className="flex items-center space-x-2">
					{props.lastRefreshed && <Text>Last Refreshed: {props.lastRefreshed}</Text>}
					<Icon icon={RefreshIcon} variant="shadow" size="xs" onClick={props.onRefresh} />
				</div>
			</TabList>
			<TabPanels>
				<TabPanel>
					<Text>Click on &ldquo;Organization ID&rdquo; to view organization details.</Text>
					<Grid numItems={1} className="mt-2 h-[75vh] w-full gap-2 pb-2 pt-2">
						<Col numColSpan={1}>
							<Card className="mx-auto max-h-[50vh] w-full flex-auto overflow-hidden overflow-y-auto">
								<div className="border-b px-6 py-4">
									<OrganizationFilters
										filters={props.filters}
										showFilters={props.showFilters}
										onToggleFilters={props.onToggleFilters}
										onChange={props.onFilterChange}
										onReset={props.onFilterReset}
									/>
								</div>
								<OrganizationsListTable
									organizations={props.organizations}
									canManage={props.canManage}
									onOpen={props.onOpen}
									onDelete={props.onDelete}
								/>
							</Card>
						</Col>
					</Grid>
				</TabPanel>
			</TabPanels>
		</TabGroup>
	);
}
