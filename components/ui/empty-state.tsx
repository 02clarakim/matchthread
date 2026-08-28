import type { ReactNode } from "react";

export function EmptyState({ children, icon }: { children: ReactNode; icon?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-muted">
      {icon && <span className="text-2xl">{icon}</span>}
      <p>{children}</p>
    </div>
  );
}
