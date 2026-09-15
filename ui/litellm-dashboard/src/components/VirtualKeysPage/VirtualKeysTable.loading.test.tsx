import { Component, type ReactNode } from "react";
import { screen, waitFor } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { renderWithProviders } from "../../../tests/test-utils";
import { VirtualKeysTable } from "./VirtualKeysTable";

const pending = vi.hoisted(() => ({
	reads: 0,
	organizations: [],
	result: { data: undefined, isPending: true, isFetching: true, isError: false, refetch: vi.fn() },
}));
vi.mock("@/app/(dashboard)/hooks/keys/useKeys", () => ({
	keyKeys: { all: ["keys"] },
	useKeys: () => {
		// Bound runaway renders so this loading regression cannot hang the test runner.
		if (++pending.reads > 25) throw new Error("Key list loading did not settle");
		return pending.result;
	},
}));
vi.mock("@/app/(dashboard)/hooks/organizations/useOrganizations", () => ({
	useOrganizations: () => ({ data: pending.organizations }),
}));
vi.mock("@/app/(dashboard)/hooks/useTeams", () => ({
	default: () => ({ teams: [] }),
}));
vi.mock("../key_team_helpers/filter_helpers", () => ({
	fetchAllTeams: vi.fn().mockResolvedValue([]),
	fetchAllOrganizations: vi.fn().mockResolvedValue([]),
}));
vi.mock("../templates/key_info_view", () => ({ default: () => null }));

class LoadingBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
	state = { failed: false };
	static getDerivedStateFromError() {
		return { failed: true };
	}
	render() {
		return this.state.failed ? <div>Key list failed to render</div> : this.props.children;
	}
}

it("should keep the real filtered key list stable while its first request is pending", async () => {
	renderWithProviders(
		<LoadingBoundary>
			<VirtualKeysTable teams={[]} organizations={[]} />
		</LoadingBoundary>,
	);
	await waitFor(() => expect(screen.getByText("🚅 Loading keys...")).toBeVisible());
	expect(screen.queryByText("Key list failed to render")).not.toBeInTheDocument();
});
