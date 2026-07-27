import type { Metadata } from "next";
import "./globals.css";

import AntdGlobalProvider from "@/contexts/AntdGlobalProvider";
import ReactQueryProvider from "@/contexts/ReactQueryProvider";

export const metadata: Metadata = {
	title: "LiteLLM Dashboard",
	description: "LiteLLM Proxy Admin UI",
	icons: { icon: "./favicon.ico" },
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body className="font-sans">
				<ReactQueryProvider>
					<AntdGlobalProvider>{children}</AntdGlobalProvider>
				</ReactQueryProvider>
			</body>
		</html>
	);
}
