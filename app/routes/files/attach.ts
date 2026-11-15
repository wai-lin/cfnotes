import { defineHandler } from "spacefn/handler";
import { putUpload, readUploads } from "spacefn/http";

/**
 * Uploads one editor attachment to R2 and returns its object key. Any type is
 * accepted; downloads are forced to `attachment` so nothing executes in-origin.
 */
export const POST = defineHandler(async (c) => {
	const { files } = await readUploads(c, {
		maxFileSize: 20 * 1024 * 1024,
		maxFiles: 1,
	});
	const candidate = files.file;
	const file = Array.isArray(candidate) ? candidate[0] : candidate;
	if (!file) return c.json({ error: "file_required" }, 400);

	const key = await putUpload(c.env.UPLOADS as never, file, { prefix: "file" });
	return c.json({ key, name: file.name, type: file.type }, 201);
});
