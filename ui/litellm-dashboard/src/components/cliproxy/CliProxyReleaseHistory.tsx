"use client";

import { Button, Collapse, Tag, Typography } from "antd";
import React, { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface CliProxyReleaseInfo {
	version: string;
	published_at: string | null;
	release_url: string;
	notes: string;
}

interface CliProxyReleaseHistoryProps {
	releases: CliProxyReleaseInfo[];
	current: string | null;
	latest: string;
}

const DEFAULT_VISIBLE_RELEASES = 3;

const CliProxyReleaseHistory: React.FC<CliProxyReleaseHistoryProps> = ({ releases, current, latest }) => {
	const [showAll, setShowAll] = useState(false);

	const visibleReleases = useMemo(
		() => (showAll ? releases : releases.slice(0, DEFAULT_VISIBLE_RELEASES)),
		[releases, showAll],
	);
	const hiddenCount = Math.max(0, releases.length - DEFAULT_VISIBLE_RELEASES);

	return (
		<div className="border-t border-slate-200 pt-3">
			<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
				<div>
					<Typography.Text strong>Version changes</Typography.Text>
					<Typography.Text type="secondary" className="ml-2 !text-xs">
						Latest release notes
					</Typography.Text>
				</div>
				{hiddenCount > 0 && (
					<Button type="link" size="small" className="!h-auto !p-0" onClick={() => setShowAll((value) => !value)}>
						{showAll ? "Show less" : `View more (${hiddenCount})`}
					</Button>
				)}
			</div>
			{visibleReleases.length > 0 ? (
				<Collapse
					size="small"
					items={visibleReleases.map((release) => ({
						key: release.version,
						label: (
							<div className="flex flex-wrap items-center gap-2">
								<Typography.Text strong>v{release.version}</Typography.Text>
								{release.version === current && <Tag color="blue">Current</Tag>}
								{release.version === latest && <Tag color="green">Latest</Tag>}
								{release.published_at && (
									<Typography.Text type="secondary" className="!text-xs">
										{new Date(release.published_at).toLocaleDateString()}
									</Typography.Text>
								)}
							</div>
						),
						children: (
							<div className="text-sm text-slate-700">
								{release.notes ? (
									<ReactMarkdown
										remarkPlugins={[remarkGfm]}
										components={{
											p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
											ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5">{children}</ul>,
											ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5">{children}</ol>,
											a: ({ children, href }) => (
												<a href={href} target="_blank" rel="noreferrer">
													{children}
												</a>
											),
											code: ({ children }) => (
												<code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{children}</code>
											),
										}}
									>
										{release.notes}
									</ReactMarkdown>
								) : (
									<Typography.Text type="secondary">No release notes provided.</Typography.Text>
								)}
								<a className="mt-2 inline-block" href={release.release_url} target="_blank" rel="noreferrer">
									View release on GitHub
								</a>
							</div>
						),
					}))}
				/>
			) : (
				<Typography.Text type="secondary">No release notes available.</Typography.Text>
			)}
		</div>
	);
};

export default CliProxyReleaseHistory;
