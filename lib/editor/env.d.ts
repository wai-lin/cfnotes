/** Vite imports a file's text with `?raw` (the icons). */
declare module "*?raw" {
	const text: string;
	export default text;
}

/** Stylesheets imported for their side effect (KaTeX's). */
declare module "*.css";
