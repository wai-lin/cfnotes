/**
 * The browser's copy of the script engine (the same QuickJS build the server
 * runs) and the TypeScript compiler, loaded the first time a script is edited.
 */
import variant from "@jitl/quickjs-wasmfile-release-sync";
import wasmLocation from "@jitl/quickjs-wasmfile-release-sync/wasm?url";
import { compileFormula, compileScript } from "@modules/script/compile";
import {
	newQuickJSWASMModuleFromVariant,
	newVariant,
	type QuickJSWASMModule,
} from "quickjs-emscripten-core";

let engine: Promise<QuickJSWASMModule> | null = null;

export function browserEngine(): Promise<QuickJSWASMModule> {
	engine ??= newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmLocation })).catch(
		(error: unknown) => {
			engine = null;
			throw error;
		},
	);
	return engine;
}

export { compileFormula, compileScript };
