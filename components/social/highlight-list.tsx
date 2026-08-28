import type { ApiHighlight } from "@/lib/types/api";
import { HighlightCard } from "@/components/social/highlight-card";
import { EmptyState } from "@/components/ui/empty-state";

export function HighlightList({ highlights }: { highlights: ApiHighlight[] }) {
  if (highlights.length === 0) {
    return <EmptyState icon="💬">No community highlights found for this match yet.</EmptyState>;
  }

  return (
    <div className="space-y-2">
      {highlights.map((h, i) => (
        <HighlightCard key={h.id} highlight={h} rank={i} />
      ))}
    </div>
  );
}
