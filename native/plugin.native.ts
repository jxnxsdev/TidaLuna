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

const SAFE_MODULES = new Set([
	"events",
	"util",
	"url",
	"zlib",
	"punycode",
	"string_decoder",
	"assert",
	"buffer",
	"stream",
	"crypto",
	"tty",
	"os",
	"https",
	"http",
]);
const BLOCKED_MODULES = new Set(["child_process", "worker_threads", "inspector", "v8", "vm"]);

ipcHandle("__Luna.registerNative", async (_, fileName: string, code: string) => {
	const nativeRequire = createRequire(pathToFileURL(process.resourcesPath + "/").href);
	const require = new Proxy(nativeRequire, {
		apply: (target, thisArg, argumentsList: [id: string]) => {
			const [moduleID] = argumentsList;

			const cleanName = moduleID.replace(/^node:/, "");
			if (SAFE_MODULES.has(cleanName)) return target.apply(thisArg, argumentsList);

			// if (BLOCKED_MODULES.has(cleanName)) {
			// 	console.error(`🛑 BLOCKED [${fileName}] LOADING: "${moduleID}"`);
			// 	return {};
			// }

			console.warn(`[${fileName}] requiring: "${cleanName}"`);

			return target.apply(thisArg, argumentsList);
		},
		get: (target, prop, receiver) => {
			// Allow access to require.resolve, require.cache, etc.
			return Reflect.get(target, prop, receiver);
		},
	});

	sandbox.global = {
		require,
		...sandbox,
	};

	// Link exports so 'exports.foo =' works
	sandbox.exports = sandbox.module.exports;

	const context = vm.createContext(sandbox, {
		name: fileName,
		codeGeneration: {
			strings: false,
			wasm: false,
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
