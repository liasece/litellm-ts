import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeAll, describe, expect, it } from "vitest";
import CliProxyReleaseHistory, { type CliProxyReleaseInfo } from "./CliProxyReleaseHistory";

beforeAll(() => {
	if (!window.ResizeObserver) {
		window.ResizeObserver = class ResizeObserver {
			observe() {}
			unobserve() {}
			disconnect() {}
		};
	}
});

const releases: CliProxyReleaseInfo[] = Array.from({ length: 5 }, (_, index) => {
	const version = `7.2.${112 - index}`;
	return {
		version,
		published_at: `2026-07-${31 - index}T08:00:00Z`,
		release_url: `https://github.com/router-for-me/CLIProxyAPI/releases/tag/v${version}`,
		notes: `Changes for ${version}`,
	};
});

describe("CliProxyReleaseHistory", () => {
	it("starts collapsed and limits the initial list to the three newest releases", () => {
		render(<CliProxyReleaseHistory releases={releases} current="7.2.110" latest="7.2.112" />);

		expect(screen.getByText("v7.2.112")).toBeInTheDocument();
		expect(screen.getByText("v7.2.110")).toBeInTheDocument();
		expect(screen.queryByText("v7.2.109")).not.toBeInTheDocument();
		expect(screen.queryByText("Changes for 7.2.112")).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "View more (2)" })).toBeInTheDocument();
	});

	it("shows older versions on demand while keeping release details expandable", () => {
		render(<CliProxyReleaseHistory releases={releases} current="7.2.110" latest="7.2.112" />);

		fireEvent.click(screen.getByRole("button", { name: "View more (2)" }));
		expect(screen.getByText("v7.2.108")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();

		fireEvent.click(screen.getByText("v7.2.112"));
		expect(screen.getByText("Changes for 7.2.112")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Show less" }));
		expect(screen.queryByText("v7.2.108")).not.toBeInTheDocument();
	});
});
