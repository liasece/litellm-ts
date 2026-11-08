import { getProviderSpecificFields } from "../support/VectorProviderSupport";
export function vectorPayload(draft: Record<string, unknown>, metadata: string, editing = false): Record<string, unknown> {
	const provider = String(draft.custom_llm_provider || "");
	const result: Record<string, unknown> = {
		vector_store_id: draft.vector_store_id,
		custom_llm_provider: provider,
		vector_store_name: draft.vector_store_name,
		vector_store_description: draft.vector_store_description,
		vector_store_metadata: metadata.trim() ? JSON.parse(metadata) : {},
	};
	if (!editing) {
		result.litellm_credential_name = draft.litellm_credential_name;
		result.litellm_params = Object.fromEntries(
			getProviderSpecificFields(provider).map((field) => [
				provider === "milvus" && field.name === "embedding_model" ? "litellm_embedding_model" : field.name,
				draft[field.name],
			]),
		);
	}
	return result;
}
export function validateVectorFile(file: File): string {
	const mime = [
		"application/pdf",
		"text/plain",
		"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		"application/msword",
		"text/markdown",
	];
	if (!mime.includes(file.type)) return `${file.name} is not a supported file type. Please upload PDF, TXT, DOCX, or MD files.`;
	if (file.size / 1024 / 1024 >= 50) return `${file.name} must be smaller than 50MB!`;
	return "";
}
export function vectorIngestError(provider: string, params: Record<string, unknown>): string {
	for (const field of getProviderSpecificFields(provider).filter((field) => field.required))
		if (!params[field.name]) return `Please provide ${field.label}`;
	if (provider === "s3_vectors") {
		if (params.vector_bucket_name && String(params.vector_bucket_name).length < 3)
			return "Vector bucket name must be at least 3 characters";
		if (params.index_name && String(params.index_name).length < 3) return "Index name must be at least 3 characters if provided";
	}
	return "";
}
export function formatVectorFileSize(bytes?: number) {
	if (!bytes) return "-";
	const kb = bytes / 1024;
	return kb < 1024 ? `${kb.toFixed(2)} KB` : `${(kb / 1024).toFixed(2)} MB`;
}
