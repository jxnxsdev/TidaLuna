import { app } from "electron";

import { unzip } from "fflate";
import { mkdir, readdir, rm, unlink, writeFile } from "fs/promises";
import path from "path";

import type { PackageJson } from "type-fest";
import { promisify } from "util";

export const pkg = async (): Promise<PackageJson> => require("./app/package.json");
export const relaunch = async () => {
	app.relaunch();
	app.exit(0);
};

const unzipAsync = promisify(unzip);

const appFolder = process.resourcesPath + "/app";

export const update = async (zipUrl: string) => {
	// ... [fetch logic] ...
	const res = await fetch(zipUrl);
	const buffer = new Uint8Array(await res.arrayBuffer());

	await clearAppFolder();

	// fflate uses a callback-based or synchronous API for unzipping
	const unzipped = await unzipAsync(buffer);

	for (const [relativePath, content] of Object.entries(unzipped)) {
		const destPath = path.join(appFolder, relativePath);

		// Security check
		if (!destPath.startsWith(appFolder)) continue;

		if (relativePath.endsWith("/") || content.length === 0) {
			await mkdir(destPath, { recursive: true });
		} else {
			await mkdir(path.dirname(destPath), { recursive: true });
			await writeFile(destPath, content);
		}
	}

	await relaunch();
};

const clearAppFolder = async () => {
	const entries = await readdir(appFolder, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(appFolder, entry.name);
		if (entry.isDirectory()) await rm(fullPath, { recursive: true, force: true });
		else await unlink(fullPath);
	}
};
