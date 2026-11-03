"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import SpeedView from "./SpeedView";

export default function SpeedPage() {
	useAuthorized();
	return <SpeedView />;
}
