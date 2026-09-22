import Link from "next/link";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { buttonClasses } from "@/components/ui/button";

export async function Nav() {
  const session = await auth();

  // Explicit opaque background (not just relying on stacking order) — the
  // landing page's hero glow is decorative background art with a negative
  // z-index, and Nav being *transparent* let it show through in the gaps
  // between the logo and links, bleeding into the header regardless of
  // z-index. An opaque bg here fully covers it, whatever the gradient's
  // size or position, without touching that gradient's own styling at all.
  return (
    <header className="relative z-10 border-b border-border bg-background">
      {/* min-h instead of a fixed h-14, plus flex-wrap: on the narrowest
          real phones (~320px) "MatchThread" + Dashboard/Teams/Sign out
          together are close enough to the viewport width that a fixed
          height combined with no wrap would clip content instead of
          growing — this lets it wrap to a second line gracefully instead. */}
      <div className="mx-auto flex min-h-14 max-w-5xl flex-wrap items-center justify-between gap-y-2 px-4 py-2">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span>⚽</span>
          <span>MatchThread</span>
        </Link>
        <nav className="flex items-center gap-3 sm:gap-4 text-sm">
          {session?.user ? (
            <>
              <Link href="/dashboard" className="text-muted hover:text-foreground transition-colors">
                Dashboard
              </Link>
              <Link href="/teams" className="text-muted hover:text-foreground transition-colors">
                Teams
              </Link>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/login" className="text-muted hover:text-foreground transition-colors">
                Sign in
              </Link>
              <Link href="/register" className={buttonClasses("primary", "sm")}>
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
