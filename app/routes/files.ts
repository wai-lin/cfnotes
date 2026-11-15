import { defineHandler } from "spacefn/handler";
import { putUpload, readUploads } from "spacefn/http";

/** Image types the editor accepts; checked against magic bytes, not the client header. */
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Uploads one editor image to R2 and returns its object key. */
export const POST = defineHandler(async (c) => {
	const { files } = await readUploads(c, {
		maxFileSize: 10 * 1024 * 1024,
		maxFiles: 1,
		allowedTypes: IMAGE_TYPES,
	});
	const candidate = files.file;
	const file = Array.isArray(candidate) ? candidate[0] : candidate;
	if (!file) return c.json({ error: "file_required" }, 400);

	const key = await putUpload(c.env.UPLOADS as never, file, { prefix: "img" });
	return c.json({ key, name: file.name, type: file.type }, 201);
});
