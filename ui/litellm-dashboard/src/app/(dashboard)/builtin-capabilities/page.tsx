"use client";

import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import BuiltinCapabilitiesPanel from "@/components/builtin_capabilities/BuiltinCapabilitiesPanel";

export default function BuiltinCapabilitiesPage() {
	useAuthorized();
	return <BuiltinCapabilitiesPanel />;
}
