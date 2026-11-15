/** Vite imports a file's text with `?raw`. */
declare module "*?raw" {
	const text: string;
	export default text;
}

/** Stylesheets imported for their side effect (Vite bundles them). */
declare module "*.css";

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
