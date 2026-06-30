export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getRouteUser } from "@/lib/auth/routeUser";
import { prisma } from "@/lib/db/prisma";

const json = (d: any, s = 200) =>
  NextResponse.json(d, { status: s, headers: { "cache-control": "no-store" } });

// Same strength rule (and message) as the vendor reset-password route.
function passwordIsValid(password: string) {
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(password);
  return password.length >= 8 && hasUpper && hasNumber && hasSymbol;
}
const STRENGTH_MSG =
  "Password must be at least 8 characters and include uppercase, number, and symbol.";

// POST /api/vendor/change-password — any logged-in user. Body {currentPassword, newPassword}.
// If the user already has a passwordHash, currentPassword must match. OAuth-only
// users (no hash yet) may set one without the current-password check.
export async function POST(req: Request) {
  const user = await getRouteUser();
  if (!user) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const currentPassword = String(body?.currentPassword ?? "");
    const newPassword = String(body?.newPassword ?? "");

    if (!passwordIsValid(newPassword)) {
      return json({ ok: false, error: STRENGTH_MSG }, 400);
    }

    const dbUser = await prisma.user.findUnique({ where: { id: user.id } });
    if (!dbUser) return json({ ok: false, error: "User not found" }, 404);

    if (dbUser.passwordHash) {
      if (!currentPassword) {
        return json({ ok: false, error: "Current password is incorrect" }, 400);
      }
      const ok = await bcrypt.compare(currentPassword, dbUser.passwordHash);
      if (!ok) {
        return json({ ok: false, error: "Current password is incorrect" }, 400);
      }
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    return json({ ok: true });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "Could not change password." }, 500);
  }
}
