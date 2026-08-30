import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import type { PlayerAvatar } from "../types";

const cache = new Map<string, PlayerAvatar>();
const pending = new Set<string>();
const listeners = new Map<string, Set<() => void>>();
let timer = 0;

function queue(steamId: string) {
  if (!steamId || cache.has(steamId) || pending.has(steamId)) return;
  pending.add(steamId);
  window.clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const ids = Array.from(pending);
    pending.clear();
    try {
      const values = await bridge.getPlayerAvatars(ids);
      for (const value of values) {
        cache.set(value.steam_id, value);
        listeners.get(value.steam_id)?.forEach((notify) => notify());
      }
    } catch {
      for (const steamId of ids) {
        cache.set(steamId, { steam_id: steamId, status: "fallback" });
        listeners.get(steamId)?.forEach((notify) => notify());
      }
    }
  }, 20);
}

export function applyAvatar(value: PlayerAvatar) {
  cache.set(value.steam_id, value);
  listeners.get(value.steam_id)?.forEach((notify) => notify());
}

export function PlayerAvatarView({ name, steamId, large = false }: { name: string; steamId: string; large?: boolean }) {
  const [, refresh] = useState(0);
  const avatar = cache.get(steamId);
  useEffect(() => {
    const notify = () => refresh((value) => value + 1);
    const subscriptions = listeners.get(steamId) ?? new Set<() => void>();
    subscriptions.add(notify);
    listeners.set(steamId, subscriptions);
    queue(steamId);
    return () => {
      subscriptions.delete(notify);
      if (!subscriptions.size) listeners.delete(steamId);
    };
  }, [steamId]);
  return <span className={`avatar ${large ? "large" : ""}`} aria-hidden="true">
    <span>{name.trim().slice(0, 1).toUpperCase() || "?"}</span>
    {avatar?.data_url && <img src={avatar.data_url} alt="" onError={(event) => { event.currentTarget.hidden = true; }}/>} 
  </span>;
}
