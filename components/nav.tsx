import Link from "next/link";
import { auth } from "@/auth";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { buttonClasses } from "@/components/ui/button";

export async function Nav() {
  const session = await auth();

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span>⚽</span>
          <span>MatchPulse</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
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
