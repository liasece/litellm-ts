import { dashboardFetch, getApiBaseUrl } from "../../platform/api/HttpApiClient";
import type { CodeInterpreterAnnotation } from "../support/PlaygroundModels";
export async function containerFile(annotation: CodeInterpreterAnnotation, signal?: AbortSignal) {
	const response = await dashboardFetch(
		getApiBaseUrl() +
			"/v1/containers/" +
			encodeURIComponent(annotation.container_id) +
			"/files/" +
			encodeURIComponent(annotation.file_id) +
			"/content",
		{ signal },
	);
	if (!response.ok) throw new Error("Unable to retrieve container file (" + response.status + ")");
	return response.blob();
}
export async function downloadContainerFile(annotation: CodeInterpreterAnnotation) {
	const blob = await containerFile(annotation),
		url = URL.createObjectURL(blob),
		link = document.createElement("a");
	link.href = url;
	link.download = annotation.filename || "file_" + annotation.file_id;
	document.body.appendChild(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}
