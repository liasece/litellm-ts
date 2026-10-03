import { Tabs, Typography } from "antd";
import React from "react";
import PriceDisplaySettings from "./PriceDisplaySettings";
import UISettings from "./Settings/AdminSettings/UISettings/UISettings";

const { Title, Paragraph } = Typography;

interface AdminPanelProps {
	proxySettings?: unknown;
}

const AdminPanel: React.FC<AdminPanelProps> = () => {
	const tabItems = [
		{
			key: "ui-settings",
			label: "UI Settings",
			children: <UISettings />,
		},
		{ key: "price-display", label: "价格显示", children: <PriceDisplaySettings /> },
	];

	return (
		<div className="mt-2 w-full min-w-0 p-4 sm:m-2 sm:p-8">
			<Title level={4}>Admin Access </Title>
			<Paragraph>Go to &apos;Internal Users&apos; page to add other admins.</Paragraph>
			<Tabs items={tabItems} />
		</div>
	);
};

export default AdminPanel;
