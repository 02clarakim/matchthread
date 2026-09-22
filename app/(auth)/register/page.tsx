import Link from "next/link";
import { RegisterForm } from "@/components/auth/register-form";
import { DemoLoginButton } from "@/components/auth/demo-login-button";

export default function RegisterPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-16">
      <h1 className="text-xl font-semibold mb-1">Create your account</h1>
      <p className="text-sm text-muted mb-6">Follow teams and get a personalized live feed.</p>
      <RegisterForm />
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link href="/login" className="text-accent underline underline-offset-2">
          Sign in
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
