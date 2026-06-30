import "server-only";
import { getServerSession } from "next-auth";
import { authOptions } from "./authOptions";

// MySQL-only auth seam for the vendor app: identity comes from the NextAuth
// session (JWT). No Supabase. Every server route asks "who is calling" here.
export type RouteUser = { id: string; email: string | null; role?: string | null };

export async function getRouteUser(): Promise<RouteUser | null> {
  const session = await getServerSession(authOptions);
  const u = session?.user as any;
  return u?.id ? { id: u.id, email: u.email ?? null, role: u.role ?? null } : null;
}
