import { createRequire } from "module";
import { pathToFileURL } from "url";

export const nativeRequire = createRequire(pathToFileURL(process.resourcesPath + "/").href);

import { ipcHandle } from "../ipc";

import { createHash } from "crypto";
import * as expose from "../expose";
import { secureLoad } from "./secureLoad";

declare global {
	var luna: {
		modules: Record<string, any>;
		sendToRender: Electron.WebContents["send"];
	} & typeof expose;
}
export const luna = (globalThis.luna = {
	modules: {},
	sendToRender: (() => {}) as Electron.WebContents["send"],
	...expose,
});

export type NativeModuleInfo = {
	fileName: string;
	code: string;
	hash: string;
};

ipcHandle("__Luna.registerNative", async (_, fileName: string, code: string) => {
	const hash = createHash("sha256").update(code, "utf8").digest("hex");

	const moduleInfo = {
		hash,
		fileName,
		code,
	};

	const exports = secureLoad(moduleInfo);

	globalThis.luna.modules[fileName] = exports;
	const channel = `__LunaNative.${fileName}`;

	ipcHandle(channel, async (_, exportName, ...args) => {
		try {
			return await exports[exportName](...args);
		} catch (err: any) {
			err.cause = `[Luna.native] (${fileName}).${exportName}`;
			throw err;
		}
	});

	return channel;
});
