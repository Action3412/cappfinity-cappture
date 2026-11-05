import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Admin-only user management. Deployed with verify_jwt = true.
// invite: create an account with a one-time password (role/team/manager via the invites row the profile trigger reads).
// reset-password: issue a new one-time password.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

function tempPassword() {
  const a = "abcdefghjkmnpqrstuvwxyz", A = "ABCDEFGHJKLMNPQRSTUVWXYZ", d = "23456789";
  const pick = (s: string, n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n))).map((x) => s[x % s.length]).join("");
  return `${pick(A, 1)}${pick(a, 4)}-${pick(a, 4)}-${pick(d, 4)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";

  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error: uErr } = await caller.auth.getUser();
  if (uErr || !user) return json({ error: "Not signed in" }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: me } = await admin.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  if (!me || !me.active || me.role !== "admin") return json({ error: "Admins only" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  if (body.action === "invite") {
    const email = String(body.email || "").trim().toLowerCase();
    const full_name = String(body.full_name || "").trim();
    const role = ["member", "manager", "admin"].includes(body.role) ? body.role : "member";
    const team_id = body.team_id || null;
    const manager_id = body.manager_id || null;
    if (!email.includes("@")) return json({ error: "Enter a valid email" }, 400);
    await admin.from("invites").upsert({ email, role, team_id, manager_id, invited_by: user.id, accepted_at: null }, { onConflict: "email" });
    const password = tempPassword();
    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: full_name || undefined } });
    if (error) {
      if (/already|exists|registered/i.test(error.message)) return json({ error: "That person already has an account. Use Reset password instead." }, 409);
      return json({ error: error.message }, 400);
    }
    if (full_name) await admin.from("profiles").update({ full_name }).eq("id", created.user.id);
    return json({ ok: true, email, password });
  }

  if (body.action === "reset-password") {
    const profile_id = String(body.profile_id || "");
    if (!profile_id) return json({ error: "Missing person" }, 400);
    const password = tempPassword();
    const { error } = await admin.auth.admin.updateUserById(profile_id, { password });
    if (error) return json({ error: error.message }, 400);
    const { data: p } = await admin.from("profiles").select("email").eq("id", profile_id).maybeSingle();
    return json({ ok: true, email: p?.email, password });
  }

  return json({ error: "Unknown action" }, 400);
});
