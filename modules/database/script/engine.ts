/**
 * The QuickJS engine for the server (Workers). Workers can't compile
 * WebAssembly from bytes at run time, so the `.wasm` is imported as a
 * precompiled module and handed to the engine. Loaded once per isolate.
 */
import variant from "@jitl/quickjs-wasmfile-release-sync";
import {
	newQuickJSWASMModuleFromVariant,
	newVariant,
	type QuickJSWASMModule,
} from "quickjs-emscripten-core";

// By file path: the Cloudflare plugin only treats imports *named* `….wasm` as
// compiled modules (the package's own `/wasm` export doesn't qualify).
import wasmModule from "../../../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm";

let engine: Promise<QuickJSWASMModule> | null = null;

export function serverEngine(): Promise<QuickJSWASMModule> {
	engine ??= newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmModule })).catch(
		(error: unknown) => {
			engine = null;
			throw error;
		},
	);
	return engine;
}
