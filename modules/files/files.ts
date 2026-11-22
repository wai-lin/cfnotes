/** Uploaded images and attachments, in Blob under random keys. */
import { Effect, Option, Schema } from "effect";
import { HttpServerResponse } from "effect/http";
import { Blob, NotFound, Upload } from "spacefn";

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

const EXTENSIONS = new Map([
	["image/png", ".png"],
	["image/jpeg", ".jpg"],
	["image/gif", ".gif"],
	["image/webp", ".webp"],
	["application/pdf", ".pdf"],
]);

export const store = Effect.fn("Files.store")(function* (prefix: "img" | "file", file: File) {
	const key = `${prefix}/${crypto.randomUUID()}${EXTENSIONS.get(file.type) ?? ""}`;
	const bytes = new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()));
	yield* Blob.put(key, bytes, { contentType: file.type });
	return HttpServerResponse.jsonUnsafe({ key, name: file.name, type: file.type }, { status: 201 });
});

/** An image shown inline, or an attachment downloaded under `name`. Keys never get reused. */
export const serve = Effect.fn("Files.serve")(function* (key: string, name = "") {
	const missing = () => new NotFound({ message: "No such file" });
	const attachment = key.startsWith("file/");
	if (!attachment && !key.startsWith("img/")) return yield* missing();
	const found = Option.getOrUndefined(yield* Blob.get(key));
	if (!found) return yield* missing();

	const headers: Record<string, string> = {
		"x-content-type-options": "nosniff",
		"cache-control": "public, max-age=31536000, immutable",
	};
	if (attachment) {
		const safe = name.replace(/[^\w .()[\]-]+/g, "_").slice(0, 120) || "download";
		headers["content-disposition"] = `attachment; filename="${safe}"`;
	}
	return HttpServerResponse.uint8Array(found.body, {
		contentType: found.contentType || "application/octet-stream",
		headers,
	});
});
