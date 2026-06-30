import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendEmail } from "@/lib/ses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_MESSAGE =
  "If an account exists for this email, a reset link has been sent.";
const DELIVERY_FAILURE_MESSAGE =
  "We couldn't send the reset email right now. Please try again later.";

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// MySQL-only vendor forgot-password (NextAuth/bcrypt). No Supabase.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();

    // Don't leak account existence — invalid emails get the generic success too.
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // Invalidate any prior unused tokens for this email.
      await prisma.password_reset_tokens.updateMany({
        where: { email, used_at: null },
        data: { used_at: new Date() },
      });

      const token = crypto.randomBytes(32).toString("hex");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

      await prisma.password_reset_tokens.create({
        data: { email, token_hash: tokenHash, expires_at: expiresAt },
      });

      const appBase =
        process.env.NEXT_PUBLIC_APP_URL ||
        process.env.APP_URL ||
        req.nextUrl.origin;
      const resetUrl = `${appBase}/vendor/reset-password?token=${encodeURIComponent(
        token
      )}`;

      try {
        await sendEmail({
          to: email,
          subject: "Reset your MadenKorea Vendor password",
          html: `
            <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #111827; background-color: #f9fafb; padding: 24px">
              <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 10px; border: 1px solid #e5e7eb; padding: 24px">
                <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 600">
                  Reset your password
                </h2>
                <p style="margin: 0 0 14px; color: #4b5563">
                  We received a request to reset the password for your MadenKorea Vendor account.
                </p>
                <p style="margin: 0 0 18px">
                  <a href="${resetUrl}" style="display: inline-block; padding: 10px 18px; border-radius: 999px; background: #111827; color: #f9fafb; font-weight: 500; text-decoration: none">
                    Reset password
                  </a>
                </p>
                <p style="margin: 0 0 10px; color: #6b7280; font-size: 12px">
                  If the button doesn't work, copy and paste this link into your browser:<br />
                  <span style="word-break: break-all">${resetUrl}</span>
                </p>
                <p style="margin: 0 0 6px; color: #6b7280; font-size: 12px">
                  This link expires in 30 minutes.
                </p>
                <p style="margin: 0; color: #6b7280; font-size: 12px">
                  If you didn't request this, you can safely ignore this email.
                </p>
              </div>
            </div>
          `,
        });
      } catch (mailError) {
        console.error("[vendor/forgot-password] email send failed:", mailError);
        return NextResponse.json({
          success: false,
          message: DELIVERY_FAILURE_MESSAGE,
        });
      }
    }

    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  } catch (error) {
    console.error("[vendor/forgot-password] unexpected error:", error);
    return NextResponse.json({
      success: false,
      message: DELIVERY_FAILURE_MESSAGE,
    });
  }
}
