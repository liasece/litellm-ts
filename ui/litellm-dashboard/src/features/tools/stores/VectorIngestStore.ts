import { reactive, shallowRef } from "vue";
import { vectorStoresApi } from "../api/VectorStoresApi";
import { validateVectorFile, vectorIngestError } from "../logic/VectorDraftLogic";
import type { VectorUpload, IngestResult } from "../support/VectorStoreModels";
export function createVectorIngestStore(ingest = vectorStoresApi.ingest) {
	const documents = shallowRef<VectorUpload[]>([]),
		results = shallowRef<IngestResult[]>([]),
		state = reactive({
			provider: "bedrock",
			name: "",
			description: "",
			params: {} as Record<string, unknown>,
			pending: false,
			error: "",
			message: "",
		});
	let timer: ReturnType<typeof setTimeout> | undefined;
	function add(files: File[]) {
		for (const file of files) {
			const error = validateVectorFile(file);
			if (error) {
				state.error = error;
				continue;
			}
			documents.value = [
				...documents.value,
				{
					uid: "upload-" + Date.now() + "-" + Math.random().toString(36).slice(2),
					name: file.name,
					status: "done",
					size: file.size,
					type: file.type,
					file,
				},
			];
		}
	}
	function remove(uid: string) {
		documents.value = documents.value.filter((doc) => doc.uid !== uid);
	}
	async function create(): Promise<string | undefined> {
		if (state.pending) return;
		if (!documents.value.length) {
			state.error = "Please upload at least one document";
			return;
		}
		if (!state.provider) {
			state.error = "Please select a provider";
			return;
		}
		state.error = vectorIngestError(state.provider, state.params);
		if (state.error) return;
		state.pending = true;
		const completed: IngestResult[] = [];
		let id: string | undefined;
		try {
			for (const doc of documents.value) {
				doc.status = "uploading";
				documents.value = [...documents.value];
				try {
					const result = await ingest(doc.file, state.provider, id, state.name, state.description, state.params);
					if (!id && result.vector_store_id) id = result.vector_store_id;
					completed.push(result);
					doc.status = "done";
					documents.value = [...documents.value];
				} catch (error) {
					doc.status = "error";
					documents.value = [...documents.value];
					throw error;
				}
			}
			results.value = completed;
			state.message = `Successfully created vector store with ${completed.length} document(s). Vector Store ID: ${id}`;
			timer = setTimeout(() => {
				documents.value = [];
				results.value = [];
			}, 3000);
			return id;
		} catch (error) {
			state.error = "Failed to create vector store: " + String(error);
			return undefined;
		} finally {
			state.pending = false;
		}
	}
	return {
		documents,
		results,
		state,
		add,
		remove,
		create,
		dispose() {
			if (timer) clearTimeout(timer);
		},
	};
}
