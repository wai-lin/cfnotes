/** How the editor hands files to the app, and what it gets back. */

/** Image types shown inline; anything else becomes an attachment. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** What a media block plays or shows. */
export type MediaKind = "audio" | "video" | "pdf";

/** Types the app may store as media (it checks the file itself). */
export const MEDIA_ACCEPT: Record<MediaKind, string> = {
	audio: "audio/*",
	video: "video/*",
	pdf: "application/pdf",
};

export type Uploaded =
	| { kind: "image"; src: string; alt: string }
	| { kind: "file"; src: string; name: string; size: number }
	| { kind: "media"; media: MediaKind; src: string; name: string; size: number };

/** Stores a file; null when that failed (the app tells the reader why). */
export type Uploader = (file: File) => Promise<Uploaded | null>;
