import vm from "vm";

import { createRequire } from "module";
import { pathToFileURL } from "url";
import { ipcHandle } from "./ipc";

import { objectify } from "@inrixia/helpers";
import { BrowserWindow, dialog } from "electron";
import * as expose from "./expose";

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

const DANGER_GROUPS = {
	EXECUTION: "Execute external system commands & run background processes unrestricted with full system level access",
	FILESYSTEM: "Full read/write/delete access to your filesystem for all files",
	INTERNALS: "Modify the V8 engine, access internal debugging tools, or dynamically execute unverified code strings",
	ENVIRONMENT: "Access sensitive system info (OS users, ENV variables), control the current process, or manage application windows.",
} as const;

const PathsRegex = /^([a-zA-Z]:|[\\/])/;
const isUnsafe = (moduleName: string) => {
	const cleanName = moduleName.replace(/^node:/, "");
	switch (cleanName) {
		case "child_process":
		case "worker_threads":
		case "cluster":
		case "wasi":
		case "WebAssembly":
			return DANGER_GROUPS.EXECUTION;
		case "fs":
		case "fs/promises":
			return DANGER_GROUPS.FILESYSTEM;
		case "vm":
		case "v8":
		case "inspector":
		case "module":
			return DANGER_GROUPS.INTERNALS;
		case "os":
		case "process":
		case "electron":
			return DANGER_GROUPS.ENVIRONMENT;
	}
	if (cleanName.startsWith(".") || cleanName.startsWith("file://") || PathsRegex.test(cleanName)) return DANGER_GROUPS.FILESYSTEM;
};

const nativeRequire = createRequire(pathToFileURL(process.resourcesPath + "/").href);

const trusted: Record<string, Set<string>> = {};
const trust = (fileName: string, moduleName: string, desc: string): boolean => {
	if (moduleName === "./app/package.json") return true;

	if (trusted[fileName]?.has(desc)) return true;
	const win = BrowserWindow.getFocusedWindow();
	const responseIndex = dialog.showMessageBoxSync(win!, {
		type: "question",
		buttons: ["Allow", "Deny"],
		defaultId: 0,
		cancelId: 1,
		title: "Security Verification",
		message: "Allow Native Code Execution?",
		detail: `Plugin: ${fileName}\nModule: ${moduleName}\nDescription: ${desc}\n\nDo you want to allow this plugin to use this module?`,
		noLink: true,
		normalizeAccessKeys: true,
	});
	// Allow
	if (responseIndex === 0) {
		trusted[fileName] ??= new Set<string>();
		trusted[fileName].add(desc);
		return true;
	}
	return false;
};

ipcHandle("__Luna.registerNative", async (_, fileName: string, code: string) => {
	const require = new Proxy(nativeRequire, {
		apply: (target, thisArg, argumentsList: [id: string]) => {
			const [moduleID] = argumentsList;

			const cleanName = moduleID.replace(/^node:/, "");

			const unsafeDesc = isUnsafe(cleanName);
			if (unsafeDesc) {
				console.warn(`[🛑Security🛑] "${fileName}" is loading "${cleanName}"`);

				// --- SPECIAL LOGIC FOR FS ---
				if (cleanName === "fs" || cleanName === "fs/promises") {
					// 1. Load the REAL module first
					const realModule = target.apply(thisArg, argumentsList);

					// 2. Define the recursive proxy helper INLINE
					const deepProxy = (value: any, path: string): any => {
						// Pass through primitives and nulls
						if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
						return new Proxy(value, {
							apply: (fnTarget, fnThis, fnArgs) => {
								if (!trust(fileName, cleanName, unsafeDesc)) throw new Error(`Access Denied! User blocked execution of "${cleanName}" in "${fileName}"`);

								console.warn(`[🛑Security🛑] "${fileName}" is executing "${path}"`);
								return fnTarget.apply(fnThis, fnArgs);
							},
							get: (objTarget, prop, receiver) => {
								// Allow safe internal props
								if (prop === "constructor" || prop === "then" || typeof prop === "symbol") return Reflect.get(objTarget, prop, receiver);

								// Get the value and recursively wrap it using this same helper
								const realValue = Reflect.get(objTarget, prop, receiver);
								return deepProxy(realValue, `${path}.${String(prop)}`);
							},
						});
					};
					return deepProxy(realModule, cleanName);
				}

				if (!trust(fileName, cleanName, unsafeDesc)) throw new Error(`Access Denied! User blocked loading "${cleanName}" in "${fileName}"`);
			}

			return target.apply(thisArg, argumentsList);
		},
		get: (target, prop, receiver) => {
			// Allow access to require.resolve, require.cache, etc.
			return Reflect.get(target, prop, receiver);
		},
	});

	const WebAssembly = new Proxy(globalThis.WebAssembly, {
		get(target, prop, receiver) {
			console.warn(`[🛑Security🛑] "${fileName}" is loading WebAssembly (${String(prop)})!`);
			if (!trust(fileName, "WebAssembly", DANGER_GROUPS.EXECUTION)) throw new Error(`Access Denied! User blocked "WebAssembly" in "${fileName}"`);
			return Reflect.get(target, prop, receiver);
		},
	});

	const mockProcess = {
		// Safe Methods
		nextTick: (...args: Parameters<typeof process.nextTick>) => process.nextTick(...args),
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

		resourcesPath: process.resourcesPath,

		debugProcess: () => {
			console.warn(`[🛑Security🛑] "${fileName}" is calling "process.debugProcess"`);
			if (!trust(fileName, "DebugProcess", "Debug the main process, gives full system access!")) {
				throw new Error(`Access Denied! User blocked "process.debugProcess" in "${fileName}"`);
			}
			// @ts-expect-error This exists
			process._debugProcess(process.pid);
			return process.debugPort;
		},
	};

	// 2. Setup Sandbox
	const sandbox = {
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
		crypto,
		SubtleCrypto,
		CryptoKey,

		// Luna specific
		luna,

		// Proxied
		require,
		WebAssembly,
	};

	sandbox.global = sandbox;

	// Link exports so 'exports.foo =' works
	sandbox.exports = sandbox.module.exports;

	const context = vm.createContext(sandbox, {
		name: fileName,
		codeGeneration: {
			strings: false,
			wasm: true,
		},
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
			require,
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
