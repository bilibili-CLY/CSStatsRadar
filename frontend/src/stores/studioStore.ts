import { create } from "zustand";
import type { StudioSeed } from "../types";

interface StudioStore {
  seed: StudioSeed | null;
  setSeed: (seed: StudioSeed | null) => void;
}

export const useStudioStore = create<StudioStore>((set) => ({
  seed: null,
  setSeed: (seed) => set({ seed }),
}));