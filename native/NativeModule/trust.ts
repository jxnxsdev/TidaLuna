import { BrowserWindow, dialog } from "electron";

const trusted: Record<string, Set<string>> = {};
export const trust = (fileName: string, moduleName: string, desc: string): boolean => {
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
