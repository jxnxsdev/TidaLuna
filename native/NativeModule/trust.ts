import { BrowserWindow, dialog } from "electron";
import { moduleAlias } from "./moduleAlias";

import type { NativeModuleInfo } from ".";

const trusted = new Set<string>();
const fastCache = new WeakMap<object, boolean>();

export const isTrusted = ({ hash, fileName }: NativeModuleInfo, moduleName: string, module: object): boolean => {
	// If we have already verified this exact function object, return immediately. Cost: O(1) lookup. Zero garbage generation.
	if (fastCache.has(module)) return true;

	const methodHash = `${hash}::${moduleName}`;

	if (trusted?.has(methodHash)) return true;
	const win = BrowserWindow.getFocusedWindow();
	const responseIndex = dialog.showMessageBoxSync(win!, {
		type: "warning",
		buttons: ["BLOCK Execution", "Allow System Access"],
		defaultId: 0,
		cancelId: 0,
		title: "Security Warning",
		message: `Allow plugin access to ${moduleAlias(moduleName)}?`,
		detail: `Plugin: '${fileName}'
		Module: ${moduleName}

		If allowed, this may grant FULL SYSTEM ACCESS (Files, Network, Processes, etc).
		Only click "Allow" if you trust this!`,
		noLink: true,
		normalizeAccessKeys: true,
	});
	// Allow
	if (responseIndex === 1) {
		trusted.add(methodHash);
		return true;
	}
	return false;
};
