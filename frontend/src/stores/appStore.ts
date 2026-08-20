import { create } from "zustand";
import { bridge } from "../bridge";
import type {
  AppConfig,
  DemoRecord,
  ImportSource,
  SavedPlayer,
} from "../types";
import { defaultConfig } from "../types";

interface AppStore {
  bootstrapped: boolean;
  bootError: string;
  config: AppConfig;
  players: SavedPlayer[];
  demos: DemoRecord[];
  sources: ImportSource[];
  toast: string;
  methodologyOpen: boolean;
  setConfig: (config: AppConfig) => void;
  setDemos: (demos: DemoRecord[]) => void;
  setImportSources: (sources: ImportSource[]) => void;
  showToast: (message: string) => void;
  setMethodologyOpen: (open: boolean) => void;
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
  bootstrap: async () => {
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
    } catch (error) {
      set({
        bootError: error instanceof Error ? error.message : String(error),
      });
    }
  },
  refreshPlayers: async () => {
    set({ players: await bridge.listPlayers() });
  },
  refreshDemos: async () => {
    set({ demos: await bridge.listDemos() });
  },
}));