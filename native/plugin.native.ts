import vm from "vm";

import { createRequire } from "module";
import { pathToFileURL } from "url";
import { ipcHandle } from "./ipc";

import { pkg, relaunch, update } from "./update";

declare global {
	var luna: {
		modules: Record<string, any>;
		update: typeof update;
		pkg: typeof pkg;
		relaunch: typeof relaunch;
		sendToRender: Electron.WebContents["send"];
	};
}
export const luna = (globalThis.luna = {
	modules: {},
	update,
	pkg,
	relaunch,
	sendToRender: (() => {}) as Electron.WebContents["send"],
});

ipcHandle("__Luna.registerNative", async (_, fileName: string, code: string) => {
	// 1. Create Require (Matches your original prefix)
	const nativeRequire = createRequire(pathToFileURL(process.resourcesPath + "/").href);

	// 2. Setup Sandbox
	const sandbox = {
		require: nativeRequire,
		module: { exports: {} },
		exports: {},
		global: {},
		// Node.js specific
		Buffer,
		console,

		// Timers (Not part of JS spec, part of host)
		setTimeout,
		clearTimeout,
		setInterval,
		clearInterval,
		setImmediate,
		clearImmediate,

		// Web APIs (Node.js provides these, but V8 vanilla context might lack them)
		URL,
		URLSearchParams,
		TextEncoder,
		TextDecoder,
		fetch,
		Headers,
		Request,
		Response,
		FormData,
		Blob,
		File,
		atob,
		btoa,
		performance,
		queueMicrotask,
		structuredClone,
		AbortController,
		AbortSignal,

		// Crypto
		crypto: globalThis.crypto,
		SubtleCrypto: globalThis.SubtleCrypto,
		CryptoKey: globalThis.CryptoKey,

		// Luna specific
		luna,
	};
	sandbox.global = sandbox;

	// Link exports so 'exports.foo =' works
	sandbox.exports = sandbox.module.exports;

	const context = vm.createContext(sandbox);

	try {
		// 3. Wrap & Execute
		// We wrap the code in a function to simulate the Node.js module scope
		const wrappedCode = `(function(exports, require, module, __filename, __dirname) { 
            ${code} 
        })`;

		// Run in context -> returns the function
		const compiledWrapper = vm.runInContext(wrappedCode, context, {
			filename: `luna://${fileName}`,
			timeout: 5000,
		});

		// Call the function with our sandboxed tools
		compiledWrapper.apply(sandbox.exports, [
			sandbox.exports,
			sandbox.require,
			sandbox.module,
			`luna://${fileName}`, // __filename
			process.resourcesPath, // __dirname
		]);

		// 4. Capture Exports
		const finalExports: any = sandbox.module.exports;

		// --- IPC Registration (Identical to your snippet) ---
		globalThis.luna.modules[fileName] = finalExports;
		const channel = `__LunaNative.${fileName}`;

		ipcHandle(channel, async (_, exportName, ...args) => {
			try {
				return await finalExports[exportName](...args);
			} catch (err: any) {
				err.cause = `[Luna.native] (${fileName}).${exportName}`;
				throw err;
			}
		});

		return channel;
	} catch (err) {
		console.error(`Failed to load module ${fileName}:`, err);
		throw err;
	}
});
