import { objectify } from "@inrixia/helpers";
import vm from "vm";

import { nativeRequire } from ".";
import { DANGER_GROUPS, isUnsafe } from "./isUnsafe";
import { trust } from "./trust";

import type Module from "module";

export const secureLoad = (fileName: string, code: string): Module["exports"] => {
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
			if (prop === "resolve" || prop === "toString") return Reflect.get(target, prop, receiver);
			return undefined;
		},
	});

	const WebAssembly = new Proxy(globalThis.WebAssembly, {
		get(target, prop, receiver) {
			console.warn(`[🛑Security🛑] "${fileName}" is loading WebAssembly (${String(prop)})!`);
			if (!trust(fileName, "WebAssembly", DANGER_GROUPS.EXECUTION)) throw new Error(`Access Denied! User blocked "WebAssembly" in "${fileName}"`);
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

	try {
		const context = vm.createContext(sandbox, {
			name: fileName,
			codeGeneration: {
				strings: false,
				wasm: true,
			},
		});

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

		return sandbox.module.exports as Module;
	} catch (err) {
		console.error(`Failed to load module ${fileName}:`, err);
		throw err;
	}
};
