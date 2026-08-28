"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { X } from "lucide-react";
import { TeamBadge } from "@/components/teams/team-badge";
import type { ApiTeam } from "@/lib/types/api";

export function TeamCard({ team }: { team: ApiTeam }) {
  const router = useRouter();
  const [removing, setRemoving] = useState(false);

  async function handleRemove(e: React.MouseEvent) {
    e.preventDefault();
    setRemoving(true);
    try {
      await fetch(`/api/user/favorite-teams/${team.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Link
      href={`/teams/${team.id}`}
      className="group relative flex items-center gap-3 rounded-xl border border-border bg-surface p-3 hover:border-accent/50 transition-colors"
    >
      <TeamBadge name={team.name} logoUrl={team.logoUrl} />
      <span className="text-sm font-medium truncate">{team.name}</span>
      <button
        onClick={handleRemove}
        disabled={removing}
        aria-label={`Unfollow ${team.name}`}
        className="ml-auto opacity-0 group-hover:opacity-100 text-muted hover:text-danger transition-opacity"
      >
        <X className="h-4 w-4" />
      </button>
    </Link>
  );
}
