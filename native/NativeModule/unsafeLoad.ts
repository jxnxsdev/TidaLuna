import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";

import { rm, writeFile } from "fs/promises";

import type Module from "module";
import { trust } from "./trust";

const requirePrefix = `import { createRequire } from 'module';const require = createRequire(${JSON.stringify(pathToFileURL(process.resourcesPath + "/").href)});`;
export const unsafeLoad = async (fileName: string, code: string): Promise<Module["exports"]> => {
	if (
		!trust(
			fileName,
			"DEPRICATED UNSAFE",
			"Full system access with no security. This is a depricated native module! Please ask the plugin creator to update their plugin!",
		)
	) {
		throw new Error(`Access Denied! User blocked unsafe execution of "${fileName}"`);
	}
	const tempDir = tmpdir();
	const tempFile = join(tempDir, Math.random().toString() + ".mjs");
	try {
		await writeFile(tempFile, requirePrefix + code, "utf8");

		// Load module
		return await import(pathToFileURL(tempFile).href);
	} finally {
		await rm(tempFile, { force: true });
	}
};
