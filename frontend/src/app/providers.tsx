"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/** Lets any client component call useSession(). */
export default function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
