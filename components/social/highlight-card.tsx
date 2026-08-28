import type { ApiHighlight } from "@/lib/types/api";
import { Badge } from "@/components/ui/badge";

const METHOD_LABEL: Record<ApiHighlight["matchingMethod"], string> = {
  DETERMINISTIC: "exact match",
  FUZZY: "similarity match",
  SEMANTIC: "AI match",
};

export function HighlightCard({ highlight, rank }: { highlight: ApiHighlight; rank: number }) {
  return (
    <a
      href={highlight.socialPost.url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className="block rounded-lg border border-border bg-surface-2 p-3 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-medium text-accent">
          {rank === 0 ? "🔥 Best reaction" : "💬 Discussion"}
        </span>
        <Badge title={`Match score ${highlight.score.toFixed(2)}`}>
          {METHOD_LABEL[highlight.matchingMethod]} · {Math.round(highlight.score * 100)}%
        </Badge>
      </div>
      <p className="text-sm leading-snug">{highlight.socialPost.title}</p>
      <div className="mt-1.5 text-xs text-muted">
        {highlight.socialPost.author && <span>u/{highlight.socialPost.author} · </span>}
        View on Reddit →
      </div>
    </a>
  );
}
