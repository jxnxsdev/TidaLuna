export const DANGER_GROUPS = {
	EXECUTION:
		"Dynamically load & execute unverified code, Execute external system commands & run background processes with full system level access",
	FILESYSTEM: "Full read/write/delete access to your filesystem for all files",
	ENVIRONMENT: "Access sensitive system info ie user Clipboard, control the current process and application.",
} as const;

const PathsRegex = /^([a-zA-Z]:|[\\/])/;
export const isUnsafe = (moduleName: string) => {
	const cleanName = moduleName.replace(/^node:/, "");
	switch (cleanName) {
		case "child_process":
		case "worker_threads":
		case "cluster":
		case "wasi":
		case "WebAssembly":
		case "repl":
		case "vm":
		case "v8":
		case "inspector":
		case "module":
		case "diagnostics_channel":
		case "trace_events":
		case "async_hooks":
		case "domain":
		case "ffi":
		case "ffi-napi":
		case "ref-napi":
		case "process":
			return DANGER_GROUPS.EXECUTION;
		case "fs":
		case "fs/promises":
			return DANGER_GROUPS.FILESYSTEM;
		case "os":
		case "electron":
			return DANGER_GROUPS.ENVIRONMENT;
	}
	if (cleanName.startsWith(".") || cleanName.startsWith("file://") || PathsRegex.test(cleanName)) return DANGER_GROUPS.FILESYSTEM;
};
