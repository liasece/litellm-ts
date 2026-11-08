export interface VectorFile {
	file_id?: string;
	filename?: string;
	file_url?: string;
	ingested_at: string;
	file_size?: number;
	content_type?: string;
}
export interface VectorStore extends Record<string, unknown> {
	vector_store_id: string;
	custom_llm_provider: string;
	vector_store_name?: string;
	vector_store_description?: string;
	vector_store_metadata?: Record<string, unknown> & { ingested_files?: VectorFile[] };
	created_at: string;
	updated_at: string;
	created_by?: string;
	updated_by?: string;
}
export interface VectorResult {
	score: number;
	content: { text: string; type: string }[];
	file_id?: string;
	filename?: string;
	attributes?: Record<string, unknown>;
}
export interface VectorUpload extends Record<string, unknown> {
	uid: string;
	name: string;
	status: "done" | "uploading" | "error" | "removed";
	size: number;
	type: string;
	file: File;
}
export interface IngestResult {
	id?: string;
	status?: string;
	vector_store_id?: string;
	file_id?: string;
	error?: string;
}
export interface VectorCredential {
	credential_name: string;
}
export interface EmbeddingModel {
	model_group: string;
	mode?: string | null;
}
