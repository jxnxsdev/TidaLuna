export const DANGER_GROUPS = {
	EXECUTION: "Execute external system commands & run background processes unrestricted with full system level access",
	FILESYSTEM: "Full read/write/delete access to your filesystem for all files",
	INTERNALS: "Modify the V8 engine, access internal debugging tools, or dynamically execute unverified code strings",
	ENVIRONMENT: "Access sensitive system info (OS users, ENV variables), control the current process, or manage application windows.",
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
