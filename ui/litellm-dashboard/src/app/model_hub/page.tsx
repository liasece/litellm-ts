"use client";
import React, { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import PublicModelHubPage from "@/components/public_model_hub";

function PublicModelHubContent() {
	const searchParams = useSearchParams()!;
	const key = searchParams.get("key");
	const [accessToken, setAccessToken] = useState<string | null>(key ?? null);
	const [previousKey, setPreviousKey] = useState<string | null>(key);

	// Adjust state during render (React docs pattern) so the token follows the `key` search param.
	// An empty `key` never clears an already resolved token, matching the previous effect behaviour.
	if (key !== previousKey) {
		setPreviousKey(key);
		if (key) {
			setAccessToken(key);
		}
	}

	return <PublicModelHubPage accessToken={accessToken} />;
}

export default function PublicModelHub() {
	return (
		<Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
			<PublicModelHubContent />
		</Suspense>
	);
}
