import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import FacebookProvider from "next-auth/providers/facebook";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

// NextAuth (Auth.js v4) — the MySQL replacement for Supabase Auth.
//   • Credentials: verifies the migrated bcrypt hash (no reset for existing users).
//   • Google / Facebook: OAuth, linked to migrated accounts via auth_accounts.
//   • JWT session strategy (required when mixing Credentials with OAuth).
// OAuth providers self-disable until their client id/secret env vars are set,
// so credentials login works immediately and OAuth turns on when configured.
export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "jwt" },
  secret: process.env.NEXTAUTH_SECRET,
  pages: { signIn: "/auth/login" },
  providers: [
    CredentialsProvider({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });
        if (!user?.passwordHash) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
    ...(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET
      ? [
          FacebookProvider({
            clientId: process.env.FACEBOOK_CLIENT_ID,
            clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On sign-in, stamp the user id AND the app role onto the token so
      // admin gating can read the role from the session post-flip without a
      // per-request DB lookup. Role persists on the token across requests.
      if (user) {
        token.uid = (user as any).id;
        try {
          const prof = await prisma.profiles.findUnique({
            where: { id: (user as any).id },
            select: { role: true },
          });
          (token as any).role = prof?.role ?? "customer";
        } catch {
          (token as any).role = "customer";
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) (session.user as any).id = token.uid;
      if (session.user) (session.user as any).role = (token as any).role ?? "customer";
      return session;
    },
  },
  events: {
    // The PrismaAdapter creates the auth_users row on first OAuth sign-in but
    // knows nothing about our `profiles` table. Create the matching profiles
    // row here (same id) so role / preferred_country / name resolve for OAuth
    // users. Credentials signups already create profiles via /api/auth/register.
    async createUser({ user }) {
      try {
        await prisma.profiles.upsert({
          where: { id: user.id },
          update: {},
          // OAuth providers (Google/Facebook) verify the email before returning
          // it, so stamp email_verified_at — otherwise these accounts (which have
          // no Supabase profiles row) drift into the email-verification grace →
          // lockout despite an already-verified email. createUser only fires for
          // adapter-created (OAuth) users; credentials signups go through
          // /api/auth/register.
          create: {
            id: user.id,
            full_name: user.name ?? null,
            email_verified_at: new Date(),
          },
        });
      } catch (e) {
        console.error("[authOptions] createUser profiles upsert failed:", e);
      }
    },
  },
};
