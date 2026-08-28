"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function FavoriteButton({ teamId, initiallyFavorited }: { teamId: string; initiallyFavorited: boolean }) {
  const router = useRouter();
  const [favorited, setFavorited] = useState(initiallyFavorited);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    try {
      if (favorited) {
        await fetch(`/api/user/favorite-teams/${teamId}`, { method: "DELETE" });
        setFavorited(false);
      } else {
        await fetch("/api/user/favorite-teams", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ teamId }),
        });
        setFavorited(true);
      }
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant={favorited ? "secondary" : "primary"} size="sm" onClick={toggle} disabled={loading}>
      {favorited ? "Following" : "Follow"}
    </Button>
  );
}
