import { Tabs, Typography } from "antd";
import React from "react";
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
	];

	return (
		<div className="w-full m-2 mt-2 p-8">
			<Title level={4}>Admin Access </Title>
			<Paragraph>Go to &apos;Internal Users&apos; page to add other admins.</Paragraph>
			<Tabs items={tabItems} />
		</div>
	);
};

export default AdminPanel;
