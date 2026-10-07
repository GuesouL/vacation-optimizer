/**
 * Sign-in (Auth.js). Runs on the Next.js server, never in the browser.
 *
 * Auth.js keeps the login in an encrypted cookie (JWT session strategy), so it
 * needs no database of its own. The FastAPI back end owns the Account table and
 * learns who's calling from the short-lived API token minted below.
 */
import { SignJWT } from "jose";
import NextAuth from "next-auth";
import type { Provider } from "next-auth/providers";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";

declare module "next-auth" {
  interface Session {
    apiToken?: string;
  }
}

export const API_AUDIENCE = "vacation-optimizer-api"; // must match backend auth.py

const providers: Provider[] = [];
if (process.env.AUTH_GOOGLE_ID) providers.push(Google); // reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET

// Type any email and you're in. For local development and screenshots only:
// a production build ignores the flag, so it can never leak onto the live site.
if (process.env.AUTH_DEV_LOGIN === "true" && process.env.NODE_ENV !== "production") {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Email", type: "email" } },
      authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        return email.includes("@") ? { id: email, email, name: email.split("@")[0] } : null;
      },
    }),
  );
}

/** A 15-minute pass for the API, signed with the secret both servers share. */
export async function mintApiToken(email: string, name?: string | null): Promise<string> {
  const secret = process.env.API_TOKEN_SECRET;
  if (!secret) throw new Error("API_TOKEN_SECRET is not set");
  return new SignJWT({ email, name: name ?? undefined })
    .setProtectedHeader({ alg: "HS256" })
    .setAudience(API_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(new TextEncoder().encode(secret));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  session: { strategy: "jwt" },
  callbacks: {
    // Runs each time the browser asks for its session, so the token stays fresh.
    async session({ session, token }) {
      if (token.email) session.apiToken = await mintApiToken(token.email, token.name);
      return session;
    },
  },
});
