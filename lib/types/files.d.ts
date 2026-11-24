/** A `.wasm` file imported as a compiled module (Workers). */
declare module "*.wasm" {
	const module: WebAssembly.Module;
	export default module;
}

/** A file imported as its URL (Vite). */
declare module "*?url" {
	const url: string;
	export default url;
}

/** A file imported as its text (Vite). */
declare module "*?raw" {
	const text: string;
	export default text;
}
