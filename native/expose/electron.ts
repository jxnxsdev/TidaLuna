import { clipboard, dialog } from "electron";
export const clipboardWriteText = clipboard.writeText;
export const showOpenDialog = dialog.showOpenDialog;
export const showSaveDialog = dialog.showSaveDialog;
export const showMessageBox = dialog.showMessageBox;
export const showErrorBox = dialog.showErrorBox;
