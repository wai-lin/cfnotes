import { bindings, defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		entrypoint: "./app/entry.ts",
		name: "cfnotes",
		compatibilityDate: "2026-10-19",
		env: {
			DB: bindings.d1({ name: "cfnotes-db" }),
			UPLOADS: bindings.r2({ name: "cfnotes-uploads" }),
		},
	},
});
