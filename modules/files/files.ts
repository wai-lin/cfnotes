/** Uploaded images and attachments, in Blob under random keys. */
import { Effect, Option, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { BadRequest, Blob, NotFound, PayloadTooLarge, UnsupportedMediaType, Upload } from "spacefn";

const MiB = 1024 * 1024;

export const Body = Schema.Struct({ file: Upload });
export const Key = Schema.Struct({ key: Schema.String });
export const Download = Schema.Struct({ name: Schema.optional(Schema.String) });

/** The editor's images; checked against their first bytes, not the client's claim. */
export const IMAGE_LIMITS = {
	maxFiles: 1,
	maxFileBytes: 10 * MiB,
	types: ["image/png", "image/jpeg", "image/gif", "image/webp"],
};

/** Attachments can be any type: they're only ever downloaded, so nothing runs in this origin. */
export const ATTACHMENT_LIMITS = { maxFiles: 1, maxFileBytes: 20 * MiB };

/**
 * Audio, video and PDFs, played or shown in the page. Their type is checked
 * against their first bytes (`mediaType`). A Worker holds the whole file in
 * memory, twice, so they stay well under its 128 MB.
 */
export const MEDIA_LIMITS = { maxFiles: 1, maxFileBytes: 30 * MiB };

/** What a media file's first bytes say it is, or `undefined` for anything else. */
export function mediaType(head: Uint8Array): string | undefined {
	const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
	if (ascii(0, 4) === "%PDF") return "application/pdf";
	if (ascii(4, 8) === "ftyp") {
		const brand = ascii(8, 12);
		if (brand === "M4A " || brand === "M4B ") return "audio/mp4";
		if (brand === "qt  ") return "video/quicktime";
		return "video/mp4";
	}
	if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3)
		return "video/webm";
	if (ascii(0, 4) === "OggS") return "audio/ogg";
	if (ascii(0, 4) === "fLaC") return "audio/flac";
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
	if (ascii(0, 3) === "ID3") return "audio/mpeg";
	// An MPEG audio frame (MP3), or AAC in ADTS.
	if (head[0] === 0xff && head[1] !== undefined && (head[1] & 0xe0) === 0xe0)
		return (head[1] & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
	return undefined;
}

/** A byte range from a `Range` header, inclusive, within `size`; `null` when there's none or it can't be met. */
export function byteRange(
	header: string | undefined,
	size: number,
): { start: number; end: number } | null {
	const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
	if (!match || (!match[1] && !match[2]) || size === 0) return null;
	let start: number;
	let end: number;
	if (!match[1]) {
		// The last N bytes.
		start = Math.max(0, size - Number(match[2]));
		end = size - 1;
	} else {
		start = Number(match[1]);
		end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
	}
	return start <= end && start < size ? { start, end } : null;
}

/** What an image's first bytes say it is (one the editor shows), or `undefined`. */
export function imageType(head: Uint8Array): string | undefined {
	const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
	if (head[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
	if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
	if (ascii(0, 4) === "GIF8") return "image/gif";
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
	return undefined;
}

const EXTENSIONS = new Map([
	["image/png", ".png"],
	["image/jpeg", ".jpg"],
	["image/gif", ".gif"],
	["image/webp", ".webp"],
	["application/pdf", ".pdf"],
	["audio/mp4", ".m4a"],
	["audio/mpeg", ".mp3"],
	["audio/aac", ".aac"],
	["audio/ogg", ".ogg"],
	["audio/flac", ".flac"],
	["audio/wav", ".wav"],
	["video/mp4", ".mp4"],
	["video/quicktime", ".mov"],
	["video/webm", ".webm"],
]);

export const store = Effect.fn("Files.store")(function* (
	prefix: "img" | "file" | "media",
	file: File,
) {
	const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
	// Media is stored as what its bytes prove, never as what the browser claimed.
	const type = prefix === "media" ? mediaType(bytes.subarray(0, 16)) : file.type;
	if (type === undefined)
		return yield* new UnsupportedMediaType({
			message: `"${file.name}" isn't audio, video or a PDF we can play`,
		});
	const { key } = yield* put(prefix, bytes, type);
	return HttpServerResponse.jsonUnsafe({ key, name: file.name, type }, { status: 201 });
});

const put = Effect.fn("Files.put")(function* (
	prefix: "img" | "file" | "media",
	bytes: Uint8Array,
	type: string,
) {
	const key = `${prefix}/${crypto.randomUUID()}${EXTENSIONS.get(type) ?? ""}`;
	yield* Blob.put(key, bytes, { contentType: type });
	return { key, path: `/files/${key}`, type, size: bytes.length };
});

/** How big each kind may be. */
const MAX_BYTES = {
	img: IMAGE_LIMITS.maxFileBytes,
	media: MEDIA_LIMITS.maxFileBytes,
	file: ATTACHMENT_LIMITS.maxFileBytes,
};

/**
 * Stores a file sent through the API, as what its bytes prove it is: an image,
 * audio, video or a PDF (shown in the page), or else an attachment, which is
 * only downloaded. `attachment` keeps any file a download.
 */
export const storeBytes = Effect.fn("Files.storeBytes")(function* (
	bytes: Uint8Array,
	attachment = false,
) {
	if (bytes.length === 0) return yield* new BadRequest({ message: "The file is empty" });
	const head = bytes.subarray(0, 16);
	const image = attachment ? undefined : imageType(head);
	const media = attachment || image ? undefined : mediaType(head);
	const prefix = image ? "img" : media ? "media" : "file";
	if (bytes.length > MAX_BYTES[prefix])
		return yield* new PayloadTooLarge({ limitBytes: MAX_BYTES[prefix] });
	const stored = yield* put(prefix, bytes, image ?? media ?? "application/octet-stream");
	const kind = image
		? "image"
		: media === "application/pdf"
			? "pdf"
			: media
				? media.split("/")[0]!
				: "attachment";
	return { ...stored, kind };
});

/**
 * An image or media shown inline, or an attachment downloaded under `name`.
 * Media answers byte ranges (`range`), which players need to seek. Keys never
 * get reused.
 */
export const serve = Effect.fn("Files.serve")(function* (key: string, name = "", range?: string) {
	const missing = () => new NotFound({ message: "No such file" });
	const attachment = key.startsWith("file/");
	const media = key.startsWith("media/");
	if (!attachment && !media && !key.startsWith("img/")) return yield* missing();
	const found = Option.getOrUndefined(yield* Blob.get(key));
	if (!found) return yield* missing();

	const headers: Record<string, string> = {
		"x-content-type-options": "nosniff",
		"cache-control": "private, max-age=31536000, immutable",
	};
	if (attachment) {
		const safe = name.replace(/[^\w .()[\]-]+/g, "_").slice(0, 120) || "download";
		headers["content-disposition"] = `attachment; filename="${safe}"`;
	}
	const contentType = found.contentType || "application/octet-stream";
	if (media) {
		headers["accept-ranges"] = "bytes";
		// No sandbox policy: a sandboxed page's own request for the file is
		// cross-site, so the session cookie isn't sent and nothing loads. The type
		// was proven from the file's bytes, and nosniff keeps it that type.
		if (range !== undefined) {
			const part = byteRange(range, found.body.byteLength);
			if (!part)
				return HttpServerResponse.empty({
					status: 416,
					headers: { ...headers, "content-range": `bytes */${found.body.byteLength}` },
				});
			return HttpServerResponse.uint8Array(found.body.subarray(part.start, part.end + 1), {
				status: 206,
				contentType,
				headers: {
					...headers,
					"content-range": `bytes ${part.start}-${part.end}/${found.body.byteLength}`,
				},
			});
		}
	}
	return HttpServerResponse.uint8Array(found.body, { contentType, headers });
});
