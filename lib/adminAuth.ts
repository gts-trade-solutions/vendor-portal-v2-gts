// lib/adminAuth.ts
import { NextRequest } from "next/server";

export function isAdminRequest(req: NextRequest): boolean {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) return false;

  const userEmail = req.headers.get("x-user-email");
  if (!userEmail) return false;

  return userEmail.toLowerCase() === adminEmail.toLowerCase();
}
