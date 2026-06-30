import "server-only";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db/prisma";

// Central, best-effort audit/activity logger. Mutating endpoints call this after
// a successful write; failures here are swallowed (logging must NEVER break the
// underlying operation). Everything is scoped to the caller's vendor.
//
// action convention: "<entity>.<verb>" e.g. "invoice.create", "product.update",
// "unit.status", "unit.transfer", "fulfillment.dispatch", "company.delete",
// "member.add", "profile.update", "payment.add".
export async function logActivity(input: {
  vendorId: string;
  actorUserId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  summary?: string | null;
  meta?: any;
}): Promise<void> {
  try {
    await prisma.vendor_activity_log.create({
      data: {
        id: randomUUID(),
        vendor_id: input.vendorId,
        actor_user_id: input.actorUserId ?? null,
        actor_email: input.actorEmail ?? null,
        action: input.action.slice(0, 64),
        entity_type: input.entityType ? input.entityType.slice(0, 48) : null,
        entity_id: input.entityId ?? null,
        summary: input.summary ? input.summary.slice(0, 512) : null,
        meta: input.meta ?? undefined,
      },
    });
  } catch (e) {
    console.error("[activity] log failed", (e as any)?.message || e);
  }
}
