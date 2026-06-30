import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function passwordIsValid(password: string) {
  const hasUpper = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9\s]/.test(password);
  return password.length >= 8 && hasUpper && hasNumber && hasSymbol;
}

async function getValidTokenRow(token: string) {
  return prisma.password_reset_tokens.findFirst({
    where: {
      token_hash: hashToken(token),
      used_at: null,
      expires_at: { gt: new Date() },
    },
  });
}

// MySQL-only vendor reset-password (NextAuth/bcrypt). No Supabase.
export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token")?.trim();
    if (!token) {
      return NextResponse.json({ ok: true, valid: false });
    }
    const row = await getValidTokenRow(token);
    return NextResponse.json({ ok: true, valid: !!row });
  } catch (error) {
    console.error("[vendor/reset-password][GET] unexpected error:", error);
    return NextResponse.json({ ok: true, valid: false });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    const password = String(body?.password || "");

    if (!passwordIsValid(password)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Password must be at least 8 characters and include uppercase, number, and symbol.",
        },
        { status: 400 }
      );
    }

    const row = token ? await getValidTokenRow(token) : null;
    if (!row?.email) {
      return NextResponse.json(
        { ok: false, error: "Reset link is invalid or has expired." },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.updateMany({
      where: { email: row.email },
      data: { passwordHash },
    });

    await prisma.password_reset_tokens.update({
      where: { id: row.id },
      data: { used_at: new Date() },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[vendor/reset-password][POST] unexpected error:", error);
    return NextResponse.json(
      { ok: false, error: "Could not reset password right now." },
      { status: 500 }
    );
  }
}
