import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  DesktopApi,
  RuntimeEventMessage,
  RuntimeLogEntry,
  RuntimeRequest,
  RuntimeResponse,
  SubscribeRequest
} from "./shared";

const api: DesktopApi = {
  runtimeStatus: () => ipcRenderer.invoke("runtime:status"),
  restartRuntime: () => ipcRenderer.invoke("runtime:restart"),
  workspaceCurrent: () => ipcRenderer.invoke("workspace:current"),
  workspaceChooseDirectory: () => ipcRenderer.invoke("workspace:chooseDirectory"),
  workspaceSwitch: (workspacePath: string) => ipcRenderer.invoke("workspace:switch", workspacePath),
  workspaceForget: (workspacePath: string) => ipcRenderer.invoke("workspace:forget", workspacePath),
  workspaceOpen: (target) => ipcRenderer.invoke("workspace:open", target),
  workspaceOpenPath: (workspacePath, target) => ipcRenderer.invoke("workspace:openPath", workspacePath, target),
  workspaceCreateWorktree: () => ipcRenderer.invoke("workspace:createWorktree"),
  request: <T>(request: RuntimeRequest) =>
    ipcRenderer.invoke("runtime:request", request) as Promise<RuntimeResponse<T>>,
  subscribeThreadEvents: (request: SubscribeRequest) => ipcRenderer.invoke("runtime:subscribe", request),
  unsubscribe: (channelId: string) => ipcRenderer.invoke("runtime:unsubscribe", channelId),
  onRuntimeEvent: (callback: (message: RuntimeEventMessage) => void) => {
    const listener = (_event: IpcRendererEvent, message: RuntimeEventMessage) => callback(message);
    ipcRenderer.on("runtime:event", listener);
    return () => ipcRenderer.off("runtime:event", listener);
  },
  onRuntimeLog: (callback: (entry: RuntimeLogEntry) => void) => {
    const listener = (_event: IpcRendererEvent, entry: RuntimeLogEntry) => callback(entry);
    ipcRenderer.on("runtime:log", listener);
    return () => ipcRenderer.off("runtime:log", listener);
  }
};

contextBridge.exposeInMainWorld("deepseekDesktop", api);
