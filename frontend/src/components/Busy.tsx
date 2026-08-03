import { LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

export function Spinner({ size = 16 }: { size?: number }) {
  return <LoaderCircle className="spinner" size={size} aria-hidden="true" />;
}

export function BusyMessage({ children }: { children: ReactNode }) {
  return (
    <span className="busy-message" role="status" aria-live="polite">
      <Spinner />
      {children}
    </span>
  );
}
