import { defineHandler } from "spacefn/handler";

/**
 * Serves an uploaded editor image (`img/…`, shown inline) or attachment
 * (`file/…`, forced to download under its `?name=`) from R2. Keys are random
 * (made by `putUpload`), so the response can cache forever.
 */
export const GET = defineHandler(async (c) => {
	const key = c.req.param("key");
	const attachment = key?.startsWith("file/");
	if (!key || (!attachment && !key.startsWith("img/"))) return c.notFound();

	const object = await c.env.UPLOADS.get(key);
	if (!object) return c.notFound();

	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("x-content-type-options", "nosniff");
	headers.set("cache-control", "public, max-age=31536000, immutable");
	if (attachment) {
		const raw = c.req.query("name") ?? "";
		const name = raw.replace(/[^\w .()[\]-]+/g, "_").slice(0, 120) || "download";
		headers.set("content-disposition", `attachment; filename="${name}"`);
	}
	return new Response(object.body, { headers });
});
