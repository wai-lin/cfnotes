/** How the editor hands files to the app, and what it gets back. */

/** Image types shown inline; anything else becomes an attachment. */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export type Uploaded =
	| { kind: "image"; src: string; alt: string }
	| { kind: "file"; src: string; name: string; size: number };

/** Stores a file; null when that failed (the app tells the reader why). */
export type Uploader = (file: File) => Promise<Uploaded | null>;
