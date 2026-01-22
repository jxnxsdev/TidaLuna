import electron from "electron";

// Safe ipcHandler to ensure no duplicates
export const ipcHandle: (typeof Electron)["ipcMain"]["handle"] = (channel, listener) => {
	electron.ipcMain.removeHandler(channel);
	electron.ipcMain.handle(channel, listener);
};
