"use client";

import React, { useEffect, useRef } from "react";
import { ConfigProvider, notification, message } from "antd";
import { setNotificationInstance } from "@/components/molecules/notifications_manager";
import { setMessageInstance } from "@/components/molecules/message_manager";

/**
 * Turns antd motion off for the whole app in one place: modals, drawers, dropdowns,
 * tooltips, message and notification appear and disappear instantly, and buttons no
 * longer play the click ripple. `motion: false` zeroes every antd motion duration
 * token, so child ConfigProviders inherit it without setting it again.
 */
const NO_MOTION_THEME = { token: { motion: false } } as const;

export default function AntdGlobalProvider({ children }: { children: React.ReactNode }) {
	const [notificationApi, notificationContextHolder] = notification.useNotification();
	const [messageApi, messageContextHolder] = message.useMessage();
	const initialized = useRef(false);

	useEffect(() => {
		if (!initialized.current) {
			setNotificationInstance(notificationApi);
			setMessageInstance(messageApi);
			initialized.current = true;
		}
	}, [notificationApi, messageApi]);

	return (
		<ConfigProvider theme={NO_MOTION_THEME} wave={{ disabled: true }}>
			{notificationContextHolder}
			{messageContextHolder}
			{children}
		</ConfigProvider>
	);
}
