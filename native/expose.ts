import { clipboard, dialog, shell } from "electron";
export const clipboardWriteText = clipboard.writeText;
export const openExternal = shell.openExternal;
export const showOpenDialog = dialog.showOpenDialog;
export const showSaveDialog = dialog.showSaveDialog;
export const showMessageBox = dialog.showMessageBox;
export const showErrorBox = dialog.showErrorBox;

export * from "./update";
