import { alertDialog } from "../_dialog";

/** Image types the server accepts as images; anything else becomes an attachment. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type Uploaded =
	| { kind: "image"; src: string; alt: string }
	| { kind: "file"; src: string; name: string; size: number };

/**
 * Uploads one file to R2 through the matching route: images render inline,
 * everything else becomes a downloadable attachment.
 */
export async function upload(file: File): Promise<Uploaded | null> {
	const image = IMAGE_TYPES.includes(file.type);
	const body = new FormData();
	body.append("file", file);
	try {
		const res = await fetch(image ? "/files" : "/files/attach", { method: "POST", body });
		if (!res.ok) throw new Error(`upload failed: ${res.status}`);
		const { key } = (await res.json()) as { key: string };
		return image
			? { kind: "image", src: `/files/${key}`, alt: file.name.replace(/\.\w+$/, "") }
			: { kind: "file", src: `/files/${key}`, name: file.name, size: file.size };
	} catch (error) {
		console.warn("[upload]", error);
		void alertDialog(`Couldn't upload “${file.name}”`, "Check your connection and try again.");
		return null;
	}
}
