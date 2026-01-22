import vm from "vm";

import { createRequire } from "module";
import { pathToFileURL } from "url";
import { ipcHandle } from "./ipc";

import { objectify } from "@inrixia/helpers";
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
	const nativeRequire = createRequire(pathToFileURL(process.resourcesPath + "/").href);
	const requireInterceptor = new Proxy(nativeRequire, {
		apply: (target, thisArg, argumentsList) => {
			const [moduleID] = argumentsList;

			// LOGGING
			console.log(`[Luna::${fileName}] requiring: "${moduleID}"`);

			return target.apply(thisArg, <[string]>argumentsList);
		},
		get: (target, prop, receiver) => {
			// Allow access to require.resolve, require.cache, etc.
			return Reflect.get(target, prop, receiver);
		},
	});

	const createStreamMock = (realStream: (NodeJS.ReadStream | NodeJS.WriteStream) & { fd: number }) => ({
		fd: realStream.fd,
		isTTY: realStream.isTTY,
		write: (...args: Parameters<typeof realStream.write>) => realStream.write(...args),
		on: () => {},
		once: () => {},
		emit: () => false,
		removeListener: () => {},
		setMaxListeners: () => {},
	});

	const mockProcess = {
		// Safe Methods
		nextTick: (callback: Function, ...args: any[]) => process.nextTick(callback, ...args),
		hrtime: (time?: [number, number]) => process.hrtime(time),
		...objectify({
			env: process.env,
			version: process.version,
			versions: process.versions,
			platform: process.platform,
			arch: process.arch,
			release: process.release,
			features: process.features,
		}),
		stdin: createStreamMock(process.stdin),
		stderr: createStreamMock(process.stderr),
		stdout: createStreamMock(process.stdout),
	};

	// 2. Setup Sandbox
	const sandbox = {
		require: requireInterceptor,
		module: { exports: {} },
		exports: {},
		global: {},
		process: mockProcess,
		// Node.js specific
		ReadableStream,
		Buffer,
		Event,
		EventTarget,
		console: {
			log: console.log.bind(console),
			error: console.error.bind(console),
			warn: console.warn.bind(console),
			info: console.info.bind(console),
		},

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

	const context = vm.createContext(sandbox, {
		name: fileName,
		codeGeneration: {
			strings: false,
			wasm: false,
		},
		// Ensures microtasks (Promises) run correctly within the execution window
		microtaskMode: "afterEvaluate",
	});

	try {
		const wrappedCode = `(function(exports, require, module, __filename, __dirname) { 
            ${code} 
        })`;

		// Run in context -> returns the function
		const compiledWrapper = vm.runInContext(wrappedCode, context, {
			filename: `luna://${fileName}`,
			timeout: 5000,
			displayErrors: true,
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
