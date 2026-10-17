import { create } from "zustand";
import { bridge } from "../bridge";
import type {
  AppConfig,
  DemoRecord,
  ImportSource,
  SavedPlayer,
} from "../types";
import { defaultConfig } from "../types";

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions extends ConfirmOptions {
  inputLabel?: string;
  initialValue?: string;
  placeholder?: string;
  validate?: (value: string) => string | null;
}

export interface DialogRequest {
  kind: "confirm" | "prompt";
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  inputLabel: string;
  initialValue: string;
  placeholder: string;
  validate?: (value: string) => string | null;
  resolve: (value: string | boolean | null) => void;
}

interface AppStore {
  bootstrapped: boolean;
  bootError: string;
  config: AppConfig;
  players: SavedPlayer[];
  demos: DemoRecord[];
  sources: ImportSource[];
  toast: string;
  methodologyOpen: boolean;
  dialog: DialogRequest | null;
  setConfig: (config: AppConfig) => void;
  setDemos: (demos: DemoRecord[]) => void;
  setImportSources: (sources: ImportSource[]) => void;
  showToast: (message: string) => void;
  setMethodologyOpen: (open: boolean) => void;
  showConfirm: (options: ConfirmOptions) => Promise<boolean>;
  showPrompt: (options: PromptOptions) => Promise<string | null>;
  resolveDialog: (value: string | boolean | null) => void;
  bootstrap: () => Promise<void>;
  refreshPlayers: () => Promise<void>;
  refreshDemos: () => Promise<void>;
}

let toastTimer: number | null = null;

export const useAppStore = create<AppStore>((set, get) => ({
  bootstrapped: false,
  bootError: "",
  config: defaultConfig,
  players: [],
  demos: [],
  sources: [],
  toast: "",
  methodologyOpen: false,
  dialog: null,
  setConfig: (config) => set({ config }),
  setDemos: (demos) => set({ demos }),
  setImportSources: (sources) =>
    set((state) => ({
      sources,
      config: { ...state.config, import_sources: sources },
    })),
  showToast: (message) => {
    set({ toast: message });
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => set({ toast: "" }), 2400);
  },
  setMethodologyOpen: (open) => set({ methodologyOpen: open }),
  showConfirm: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        dialog: {
          kind: "confirm",
          title: options.title ?? "确认操作",
          message: options.message,
          confirmLabel: options.confirmLabel ?? "确认",
          cancelLabel: options.cancelLabel ?? "取消",
          danger: options.danger ?? false,
          inputLabel: "",
          initialValue: "",
          placeholder: "",
          resolve: (value) => resolve(value === true),
        },
      });
    }),
  showPrompt: (options) =>
    new Promise<string | null>((resolve) => {
      set({
        dialog: {
          kind: "prompt",
          title: options.title ?? "输入",
          message: options.message,
          confirmLabel: options.confirmLabel ?? "确认",
          cancelLabel: options.cancelLabel ?? "取消",
          danger: options.danger ?? false,
          inputLabel: options.inputLabel ?? "名称",
          initialValue: options.initialValue ?? "",
          placeholder: options.placeholder ?? "",
          validate: options.validate,
          resolve: (value) => resolve(typeof value === "string" ? value : null),
        },
      });
    }),
  resolveDialog: (value) => {
    const dialog = get().dialog;
    if (!dialog) return;
    set({ dialog: null });
    dialog.resolve(value);
  },
  bootstrap: async () => {
    // Tauri 壳起 sidecar 有数秒窗口：后端未就绪时重试而不是直接报错。
    // 浏览器直连模式后端先行，就绪时第一次即成功，无额外等待。
    const deadline = Date.now() + 20000;
    let lastError: unknown = null;
    while (Date.now() < deadline) {
      try {
        const value = await bridge.bootstrap();
        const demos = await bridge.listDemos().catch(() => [] as DemoRecord[]);
        set({
          config: value.config,
          players: value.players ?? [],
          sources: value.config.import_sources ?? [],
          demos: demos ?? [],
          bootstrapped: true,
        });
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    set({
      bootError:
        lastError instanceof Error ? lastError.message : String(lastError),
    });
  },
  refreshPlayers: async () => {
    set({ players: await bridge.listPlayers() });
  },
  refreshDemos: async () => {
    set({ demos: await bridge.listDemos() });
  },
}));