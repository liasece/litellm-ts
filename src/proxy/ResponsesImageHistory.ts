import { createHash } from "node:crypto";
import { describeImageTranscript, type HistoryMessage } from "../capabilities/ImageCompletionTranscript";
import { ApiError } from "../core/api/ApiError";

/**
 * Lower a client-supplied historic image for a Chat-compatible upstream. The retained native
 * body still carries real upstream-native items. A local ID alone cannot grant access to bytes.
 * @param item - Historical output received from the Responses client.
 * @param nativeImages - Whether the selected upstream can resolve its own image IDs.
 * @throws {ApiError} If the item cannot represent a completed image in this context.
 */
function historicalResponseImage(item: HistoryMessage, nativeImages: boolean): HistoryMessage {
	const id = item.id;
	if (item.status !== "completed" || typeof id !== "string" || !id.length) {
		throw ApiError.badRequest("image_generation_call must be a completed item with an ID");
	}
	const encoded = item.result;
	if (encoded === undefined || encoded === null) {
		if (nativeImages && !id.startsWith("imggen_")) {
			return {
				type: "message",
				role: "user",
				content: [{ type: "input_text", text: "A previously generated image is present in the native Responses history." }],
			};
		}
		throw ApiError.badRequest("The historical image is unavailable in this conversation. Supply its image_generation_call result.");
	}
	if (typeof encoded !== "string" || !encoded.length || !/^[A-Za-z0-9+/=\s]+$/u.test(encoded)) {
		throw ApiError.badRequest("Invalid image_generation_call result");
	}
	const normalized = encoded.replace(/\s+/gu, "");
	const bytes = Buffer.from(normalized, "base64");
	if (!bytes.length || bytes.toString("base64").replace(/[=]+$/u, "") !== normalized.replace(/[=]+$/u, "")) {
		throw ApiError.badRequest("Invalid image_generation_call base64");
	}
	let mediaType: string;
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
		mediaType = "image/png";
	} else if (bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) {
		mediaType = "image/jpeg";
	} else if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
		mediaType = "image/webp";
	} else {
		throw ApiError.badRequest("Unsupported image_generation_call image format");
	}
	const ref = "sha256:" + createHash("sha256").update(bytes).digest("hex");
	return {
		type: "message",
		role: "user",
		content: [
			{ type: "input_text", text: "The client supplied this previously generated image for reference (" + ref + ")." },
			{ type: "input_image", image_url: "data:" + mediaType + ";base64," + normalized },
		],
	};
}

/**
 * Move client-supplied historical media to the first safe point after its public assistant turn.
 * Native providers may retain foreign native IDs. A router-issued ID never reaches a provider.
 * @param items - Validated public items, after restoration of authenticated records.
 * @param localOnly - Preserve foreign native items in the native upstream copy.
 * @param nativeImages - Whether a foreign ID without inline data is resolvable upstream.
 * @throws {ApiError} When a public tool result required by the image boundary is missing.
 */
export function projectHistoricalResponseImages(items: HistoryMessage[], localOnly: boolean, nativeImages: boolean): HistoryMessage[] {
	const targets = new Set<number>();
	for (const [index, item] of items.entries()) {
		if (item.type === "image_generation_call" && (!localOnly || (typeof item.id === "string" && item.id.startsWith("imggen_")))) {
			targets.add(index);
		}
	}
	if (!targets.size) {
		return items;
	}
	const after = new Map<number, HistoryMessage[]>();
	for (const boundary of describeImageTranscript(items, false)) {
		for (let index = boundary.start; index <= boundary.end; index++) {
			if (!targets.has(index)) {
				continue;
			}
			if (boundary.after === undefined) {
				throw ApiError.badRequest("Historical image is missing a paired public tool output");
			}
			const history = historicalResponseImage(items[index]!, nativeImages);
			const group = after.get(boundary.after) ?? [];
			group.push(history);
			after.set(boundary.after, group);
		}
	}
	return items.flatMap((item, index) => [...(targets.has(index) ? [] : [item]), ...(after.get(index) ?? [])]);
}
