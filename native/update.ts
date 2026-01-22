import { mkdir, readdir, rm, unlink, writeFile } from "fs/promises";
import JSZip from "jszip";
import path from "path";

import { app } from "electron";

import type { PackageJson } from "type-fest";

export const pkg = async (): Promise<PackageJson> => require("./app/package.json");

export const relaunch = async () => {
	app.relaunch();
	app.exit(0);
};

const appFolder = path.join(process.resourcesPath, "app");

export const update = async (zipUrl: string) => {
	const res = await fetch(zipUrl);
	if (!res.ok) throw new Error(`Failed to download ${zipUrl}\n${res.statusText}`);

	const testPath = path.join(process.resourcesPath, "test");
	// Ensure clean start
	await mkdir(testPath, { recursive: true });

	console.log(`[UPDATER] == Downloaded: ${zipUrl}`);

	// Load zip purely from buffer (no internal fs usage by the library)
	const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));

	console.log("[UPDATER] == Loaded zip into memory");

	await clearAppFolder();

	console.log("[UPDATER] == Cleared app folder");

	// Manually write files to disk
	const entries = Object.keys(zip.files);
	for (const filename of entries) {
		const file = zip.files[filename];
		const destPath = path.join(testPath, filename);

		// Security: Prevent Zip Slip (directory traversal attacks)
		if (!destPath.startsWith(testPath)) {
			console.warn(`[UPDATER] == Skipping unsafe path: ${filename}`);
			continue;
		}

		if (file.dir) {
			await mkdir(destPath, { recursive: true });
		} else {
			// Ensure parent directory exists (zip entries aren't always sorted)
			await mkdir(path.dirname(destPath), { recursive: true });

			// Convert to Node Buffer and write
			const content = await file.async("nodebuffer");
			await writeFile(destPath, content);
		}
	}

	console.log("[UPDATER] == Extraction complete");

	await relaunch();
};

const clearAppFolder = async () => {
	// Check if folder exists before reading to avoid crashing on fresh installs
	try {
		const entries = await readdir(appFolder, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(appFolder, entry.name);
			if (entry.isDirectory()) await rm(fullPath, { recursive: true, force: true });
			else await unlink(fullPath);
		}
	} catch (error: any) {
		if (error.code !== "ENOENT") throw error;
	}
};
