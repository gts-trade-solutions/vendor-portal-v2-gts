"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useVendorRole } from "@/lib/hooks/useVendorRole";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Member = {
  user_id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  is_owner: boolean;
};

function roleBadgeClass(role: string) {
  if (role === "owner") return "bg-primary/10 text-primary";
  if (role === "manager") return "bg-blue-100 text-blue-700";
  return "bg-slate-100 text-slate-600";
}

export default function TeamPage() {
  const router = useRouter();
  const { isAdmin, loading: roleLoading } = useVendorRole();

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("staff");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/vendor/team", { cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      toast.error(json?.error || "Failed to load members");
    }
    setMembers((json?.data || []) as Member[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  const add = async () => {
    if (!email.trim()) {
      toast.error("Enter the member's email.");
      return;
    }
    setAdding(true);
    const res = await fetch("/api/vendor/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: email.trim(), role }),
    });
    const json = await res.json().catch(() => ({}));
    setAdding(false);
    if (!res.ok || !json?.ok) {
      toast.error(json?.error || "Failed to add member");
      return;
    }
    toast.success("Member added / updated.");
    setEmail("");
    await load();
  };

  const remove = async (m: Member) => {
    setBusyId(m.user_id);
    const res = await fetch(
      `/api/vendor/team?user_id=${encodeURIComponent(m.user_id)}`,
      { method: "DELETE" },
    );
    const json = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok || !json?.ok) {
      toast.error(json?.error || "Failed to remove member");
      return;
    }
    toast.success("Member removed.");
    await load();
  };

  if (roleLoading) {
    return (
      <div className="container mx-auto py-16 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="container mx-auto max-w-md py-16 text-center">
        <Card>
          <CardHeader>
            <CardTitle>Admins only</CardTitle>
            <CardDescription>
              Team management is available to owners and managers.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push("/vendor")}>
              ← Back to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-6 py-8">
      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={() => router.push("/vendor")}>
          ← Back to Dashboard
        </Button>
      </div>

      <div>
        <h1 className="text-2xl font-bold">Team</h1>
        <p className="text-sm text-muted-foreground">
          Add staff (view-only) or managers (full access). Members must have
          registered and signed in at least once.
        </p>
      </div>

      {/* Add member */}
      <Card>
        <CardHeader>
          <CardTitle>Add a member</CardTitle>
          <CardDescription>
            Managers can create, edit and delete. Staff can only view.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label className="text-xs font-medium text-slate-600">Email</label>
              <Input
                type="email"
                placeholder="member@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-slate-600">Role</label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm sm:w-40"
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="staff">Staff (view-only)</option>
                <option value="manager">Manager (full access)</option>
              </select>
            </div>
            <Button onClick={add} disabled={adding}>
              {adding ? "Adding…" : "Add member"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Members list */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>People with access to this vendor workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : members.length === 0 ? (
            <div className="text-sm text-muted-foreground">No members yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="bg-slate-50">
                  <tr className="border-b">
                    <th className="px-4 py-2 text-left font-semibold">Name</th>
                    <th className="px-4 py-2 text-left font-semibold">Email</th>
                    <th className="px-4 py-2 text-left font-semibold">Role</th>
                    <th className="px-4 py-2 text-center font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} className="border-t">
                      <td className="px-4 py-2">{m.full_name || "—"}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {m.email || "—"}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${roleBadgeClass(
                            m.role,
                          )}`}
                        >
                          {m.role}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-center">
                        {m.is_owner ? (
                          <span className="text-xs text-muted-foreground">Owner</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600"
                            disabled={busyId === m.user_id}
                            onClick={() => remove(m)}
                          >
                            {busyId === m.user_id ? "Removing…" : "Remove"}
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
