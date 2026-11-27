/** A file's size the way people read it: `512 B`, `40 KB`, `3.2 MB`. */
export function formatSize(size: number): string {
	// 0 is a size no one knows (a file block written as Markdown).
	if (size <= 0) return "";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
