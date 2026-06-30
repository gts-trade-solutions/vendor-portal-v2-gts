import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// MySQL-only vendor signup (NextAuth/bcrypt). No Supabase, no dual-write.
// Creates auth_users (credential hash) + profiles with the SAME id.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({} as any));
  const email = String(body?.email ?? "").toLowerCase().trim();
  const password = String(body?.password ?? "");
  const fullName = body?.full_name ? String(body.full_name).trim() : null;

  if (!email || !isValidEmail(email) || password.length < 8) {
    return NextResponse.json({ error: "INVALID_INPUT" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "EMAIL_EXISTS" }, { status: 409 });
  }

  const id = randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: { id, email, name: fullName, passwordHash },
      });
      await tx.profiles.upsert({
        where: { id },
        create: { id, full_name: fullName },
        update: { full_name: fullName },
      });
    });
  } catch (e) {
    console.error("[vendor/signup] create failed:", e);
    return NextResponse.json({ error: "CREATE_FAILED" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id });
}
