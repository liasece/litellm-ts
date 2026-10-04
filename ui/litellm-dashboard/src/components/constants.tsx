// useBaseUrl.ts
import { useSyncExternalStore } from "react";

const DEFAULT_BASE_URL = "http://localhost:4000";

const subscribeToLocation = () => () => {};

const getBaseUrlSnapshot = () => {
	if (typeof window === "undefined") {
		return DEFAULT_BASE_URL;
	}
	const { protocol, host } = window.location;
	return `${protocol}//${host}`;
};

export const useBaseUrl = () => {
	// window.location is an external value: read it through useSyncExternalStore so the server
	// snapshot stays the default and the client switches to the current origin.
	return useSyncExternalStore(subscribeToLocation, getBaseUrlSnapshot, () => DEFAULT_BASE_URL);
};

export const defaultPageSize = 25;
