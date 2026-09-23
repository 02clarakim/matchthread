import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/db/prisma";
import { logger } from "./lib/logger";
import { DEMO_EMAIL } from "./lib/demo-account";
import { resetDemoFavorites } from "./lib/demo-account-server";

/**
 * Credentials + JWT sessions — no database adapter. There's no OAuth
 * provider here, so the adapter's Account/Session tables would just be
 * empty overhead; a signed JWT cookie is the simpler, equally reliable
 * choice for this scope (see README § Security).
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  // Auth.js verifies the request's Host header against a trusted list
  // before doing anything else — auto-trusted on Vercel (it sets its own
  // marker env var), but Render (and most other hosts) need this
  // explicit, or every auth route can 500 with a generic "server
  // configuration" error before even reaching a provider.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) {
          logger.info("auth_login_failed", { email });
          return null;
        }

        // Shared demo account (see lib/demo-account.ts): reset its
        // favorites on every login so the next visitor never inherits
        // whatever the previous one left it as, mid-session edits are
        // still real and visible for as long as that person stays signed
        // in — it's only a fresh login that snaps it back.
        if (email === DEMO_EMAIL) {
          await resetDemoFavorites(user.id).catch((err) =>
            logger.warn("demo_favorites_reset_failed", { error: String(err) })
          );
        }

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.userId === "string") {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
