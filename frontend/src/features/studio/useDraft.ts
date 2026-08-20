import { useEffect, useRef, useState } from "react";
import { bridge } from "../../bridge";
import type { SaveState } from "../../components/ui";
import type { StudioKind } from "../../types";
import { stripLegacyDraftFields } from "./draftMutations";

export function useDraft<T>(kind: StudioKind, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveRevision, setSaveRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  useEffect(() => {
    loaded.current = false;
    setReady(false);
    bridge
      .loadDraft(kind)
      .then((draft) => {
        if (draft)
          setValue(stripLegacyDraftFields(JSON.parse(draft.payload)) as T);
      })
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, [kind]);
  useEffect(() => {
    if (!loaded.current) return;
    setSaveState("saving");
    const timer = window.setTimeout(
      () =>
        bridge
          .saveDraft(kind, JSON.stringify(value))
          .then(() => setSaveState("saved"))
          .catch(() => setSaveState("error")),
      500,
    );
    return () => clearTimeout(timer);
  }, [kind, value, saveRevision]);
  return [
    value,
    setValue,
    saveState,
    () => setSaveRevision((value) => value + 1),
    ready,
  ] as const;
}
