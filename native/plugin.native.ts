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

	debugProcess: () => {
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
};

const DANGER_ZONE: Record<string, string> = {
	// The Filesystem (BLOCK ALL VARIANTS)
	fs: "Full access to read, write, and delete files on your hard drive",
	"fs/promises": "Full access to read, write, and delete files on your hard drive",

	// Electron
	electron: "Full control over the application, clipboard, and system hardware",

	// Relative/Absolute imports
	".": "Bypasses module security to load arbitrary local files",
	"file://": "Direct access to the local file system",

	// Spawnables (Remote Code Execution risks)
	child_process: "Executes shell commands (cmd/bash) and external programs",
	worker_threads: "High resource usage (crypto mining) and background execution",
	cluster: "Spawns multiple system processes to exhaust resources",

	// Internals (Sandbox Escape risks)
	inspector: "Connects to the debugger to inspect memory and steal secrets",
	v8: "Low-level engine access and memory manipulation",
	vm: "Compiles and executes dynamic code to bypass security restrictions",

	// WebAssembly System Interface
	wasi: "Low-level system access via WebAssembly",
	WebAssembly: "Executes compiled binary code (High performance, potential sandbox evasion)",
};
const DANGER_ZONE_MODULES = Object.keys(DANGER_ZONE);
const PathsRegex = /^([a-zA-Z]:|[\\/])/;

const nativeRequire = createRequire(pathToFileURL(process.resourcesPath + "/").href);

const trusted: Record<string, Set<string>> = {};
const trust = (fileName: string, moduleName: string): boolean => {
	if (moduleName === "fs/promises") moduleName = "fs";
	if (trusted[fileName]?.has(moduleName)) return true;
	const win = BrowserWindow.getFocusedWindow();
	const responseIndex = dialog.showMessageBoxSync(win!, {
		type: "question",
		buttons: ["Allow", "Deny"],
		defaultId: 0,
		cancelId: 1,
		title: "Security Verification",
		message: "Allow Native Code Execution?",
		detail: `Plugin: ${fileName}\nModule: ${moduleName}\nDescription: ${DANGER_ZONE[moduleName]}\n\nDo you want to allow this plugin to use this module?`,
		noLink: true,
		normalizeAccessKeys: true,
	});
	// Allow
	if (responseIndex === 0) {
		trusted[fileName] ??= new Set<string>();
		trusted[fileName].add(moduleName);
		return true;
	}
	return false;
};

ipcHandle("__Luna.registerNative", async (_, fileName: string, code: string) => {
	const require = new Proxy(nativeRequire, {
		apply: (target, thisArg, argumentsList: [id: string]) => {
			const [moduleID] = argumentsList;
			const cleanName = moduleID.replace(/^node:/, "");

			if (DANGER_ZONE_MODULES.some((prefix) => cleanName === prefix || cleanName.startsWith(prefix)) || PathsRegex.test(cleanName)) {
				console.error(`[🛑Security🛑] == ${fileName} loading "${cleanName}"`);

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
								console.log(`[🛑Security🛑] == Intercepting CALL to "${path}" for "${fileName}"`);

								if (!trust(fileName, cleanName)) throw new Error(`Access Denied! User blocked execution of "${cleanName}" for "${fileName}"`);
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
				if (!trust(fileName, cleanName)) throw new Error(`Access Denied! User blocked loading of module "${cleanName}" for "${fileName}"`);
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
			console.error(`[🛑Security🛑] == ${fileName} loading WebAssembly (${String(prop)})!`);
			if (!trust(fileName, "WebAssembly")) throw new Error(`Access Denied! User blocked "WebAssembly" for "${fileName}"`);
			return Reflect.get(target, prop, receiver);
		},
	});

	sandbox.global = {
		...sandbox,
		require,
		WebAssembly,
	};
	// @ts-expect-error This exists
	sandbox.WebAssembly = WebAssembly;

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
