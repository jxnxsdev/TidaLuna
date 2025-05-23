import { build, Plugin } from "esbuild";
import { defaultBuildOptions, TidalNodeVersion } from "../index.js";
import { fileUrlPlugin } from "./fileUrl.js";
import { buildCache } from "./outputCache.js";

const buildOutput = buildCache(async (args) => {
	const { outputFiles, metafile } = await build({
		...defaultBuildOptions,
		entryPoints: [args.path],
		write: false,
		metafile: true,
		sourcemap: false,
		platform: "node",
		target: TidalNodeVersion, // Tidal node version
		format: "esm",
		external: ["@luna/*", "electron"],
		plugins: [fileUrlPlugin],
	});

	const output = Object.values(metafile!.outputs)[0];

	// Try sanitize entry path to remove plugins/ prefix
	const entryPoint = output.entryPoint?.replace("plugins/", "");

	return {
		contents: `
		// Register the native module code, see native/injector.ts
		await lunaNative.invoke("__Luna.registerNative", "${entryPoint}", ${JSON.stringify(outputFiles![0].text)});

		// Expose built exports to plugin
		${output.exports
			.map((_export) => {
				const exportName = _export === "default" ? "default" : `const ${_export}`;
				return `export ${exportName} = invokeNative("${_export}");`;
			})
			.join("\n")}
	`,
	};
});
export const lunaNativePlugin: Plugin = {
	name: "lunaNativePlugin",
	setup(build) {
		build.onLoad({ filter: /.*\.native\.[a-z]+/ }, buildOutput);
	},
};
