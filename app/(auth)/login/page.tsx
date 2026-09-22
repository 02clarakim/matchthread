import Link from "next/link";
import { LoginForm } from "@/components/auth/login-form";
import { DemoLoginButton } from "@/components/auth/demo-login-button";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold mb-1">Welcome back</h1>
      <p className="text-sm text-muted mb-6">Sign in to your account.</p>
      <LoginForm callbackUrl={callbackUrl} />
      <p className="mt-6 text-sm text-muted">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="text-accent underline underline-offset-2">
          Create one
        </Link>
      </p>
      <div className="mt-6 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="mt-4 flex justify-center">
        <DemoLoginButton variant="secondary" />
      </div>
    </div>
  );
}
