"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { buttonClasses } from "@/components/ui/button";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo-account";

/**
 * One click into a fully logged-in account, no typing required — for a
 * portfolio project, making a reviewer copy/paste credentials from a
 * footnote is real friction for zero benefit. Previously this was just a
 * text line ("Demo account: demo@example.com / password123") on the login
 * page, which only reached someone who'd already clicked through to sign
 * in; it never appeared on the landing page at all.
 */
export function DemoLoginButton({
  className,
  variant = "secondary",
}: {
  className?: string;
  variant?: "primary" | "secondary";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleClick() {
    setLoading(true);
    setError(false);
    const result = await signIn("credentials", {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError(true);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={cn(buttonClasses(variant), className)}
      >
        {loading ? "Signing in…" : "Try the demo"}
      </button>
      {error && (
        <p className="text-xs text-danger">Demo sign-in failed — try again in a moment.</p>
      )}
    </div>
  );
}
