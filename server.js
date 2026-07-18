// ═══════════════════════════════════════════════════════════════════════════
//  server.js — Express server: WhatsApp webhook + /admin dashboard
// ═══════════════════════════════════════════════════════════════════════════
import express from "express";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { handleIncoming, sendAdminReply, emitEvent, subscribe } from "./bot.js";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const app = express();
app.use(express.json());

// ── Crash guards ───────────────────────────────────────────────────────────
process.on("unhandledRejection", (r) => console.error("Unhandled Rejection:", r));
process.on("uncaughtException", (e) => console.error("Uncaught Exception:", e));

// ── Health check ───────────────────────────────────────────────────────────
app.get("/", (_req, res) =>
  res.status(200).send("Blissful Senja bot is running")
);

// ── Meta webhook verification ──────────────────────────────────────────────
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified ✓");
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

// ── Incoming WhatsApp messages ─────────────────────────────────────────────
app.post("/webhook", async (req, res) => {
  res.sendStatus(200); // Ack immediately, Meta expects <5s

  try {
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];
    if (!msg || msg.type !== "text") return;

    const from = msg.from;
    const text = msg.text.body;
    const profileName = change?.value?.contacts?.[0]?.profile?.name;

    console.log(`[${from}] → ${text}`);
    await handleIncoming(from, text, profileName);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

// ── Cookie-based session (simple, no library) ──────────────────────────────
const SESSION_COOKIE = "bs_admin";
const SESSION_SECRET = process.env.SESSION_SECRET || "change-me";

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(cookie) {
  if (!cookie) return null;
  const [body, sig] = cookie.split(".");
  if (!body || !sig) return null;
  const expected = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(body)
    .digest("base64url");
  if (expected !== sig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || "";
  return Object.fromEntries(
    raw.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k, v.join("=")];
    })
  );
}

function requireAuth(req, res, next) {
  const session = verifySession(parseCookies(req)[SESSION_COOKIE]);
  if (!session) {
    // API calls get 401, page requests get redirect
    if (req.path.startsWith("/admin/api/") || req.path === "/admin/events") {
      return res.sendStatus(401);
    }
    return res.redirect("/admin/login");
  }
  req.admin = session;
  next();
}

// ── Login page ─────────────────────────────────────────────────────────────
app.get("/admin/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "admin-login.html"));
});

app.post("/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Wrong password" });
  }
  const cookie = signSession({
    admin: true,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
  });
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${cookie}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${7 * 24 * 60 * 60}`
  );
  res.json({ ok: true });
});

app.post("/admin/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
  res.json({ ok: true });
});

// ── Dashboard page ─────────────────────────────────────────────────────────
app.get("/admin", requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

// ── APIs ───────────────────────────────────────────────────────────────────

// Stats
app.get("/admin/api/stats", requireAuth, async (_req, res) => {
  try {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [{ count: totalConvos }, { count: todayConvos }, { count: escalated }, { count: totalMessages }] =
      await Promise.all([
        supabase.from("sessions").select("*", { count: "exact", head: true }),
        supabase.from("sessions").select("*", { count: "exact", head: true })
          .gte("last_message_at", startOfToday.toISOString()),
        supabase.from("sessions").select("*", { count: "exact", head: true })
          .eq("escalated", true),
        supabase.from("messages").select("*", { count: "exact", head: true }),
      ]);

    const { data: settingRow } = await supabase.from("settings")
      .select("value").eq("key", "bot_enabled").single();

    res.json({
      totalConvos: totalConvos || 0,
      todayConvos: todayConvos || 0,
      escalated: escalated || 0,
      totalMessages: totalMessages || 0,
      botEnabled: settingRow?.value === true,
    });
  } catch (err) {
    console.error("stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// List conversations
app.get("/admin/api/conversations", requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from("sessions")
      .select("phone, customer_name, bot_paused, escalated, last_message_at, history")
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    const list = (data || []).map((s) => {
      const h = Array.isArray(s.history) ? s.history : [];
      const last = h[h.length - 1];
      return {
        phone: s.phone,
        name: s.customer_name || null,
        bot_paused: s.bot_paused,
        escalated: s.escalated,
        last_message_at: s.last_message_at,
        preview: last ? String(last.content || "").slice(0, 100) : "",
      };
    });
    res.json(list);
  } catch (err) {
    console.error("conversations error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Get full message history for one conversation
app.get("/admin/api/conversations/:phone", requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    const [{ data: session }, { data: messages }] = await Promise.all([
      supabase.from("sessions").select("*").eq("phone", phone).single(),
      supabase.from("messages").select("*").eq("phone", phone)
        .order("created_at", { ascending: true }),
    ]);
    res.json({ session, messages: messages || [] });
  } catch (err) {
    console.error("conversation detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Toggle per-customer pause
app.post("/admin/api/conversations/:phone/toggle-pause", requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    const { data: session } = await supabase.from("sessions")
      .select("bot_paused").eq("phone", phone).single();
    const newPaused = !session.bot_paused;
    await supabase.from("sessions").update({ bot_paused: newPaused }).eq("phone", phone);
    emitEvent({ type: "session_updated", phone });
    res.json({ ok: true, bot_paused: newPaused });
  } catch (err) {
    console.error("toggle-pause error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Clear escalation flag
app.post("/admin/api/conversations/:phone/clear-escalation", requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    await supabase.from("sessions").update({ escalated: false }).eq("phone", phone);
    emitEvent({ type: "session_updated", phone });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send a manual reply as admin
app.post("/admin/api/conversations/:phone/reply", requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    const { text } = req.body || {};
    if (!text || !text.trim()) return res.status(400).json({ error: "Empty message" });
    await sendAdminReply(phone, text.trim());
    res.json({ ok: true });
  } catch (err) {
    console.error("admin reply error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Notify therapist manually
app.post("/admin/api/conversations/:phone/notify-therapist", requireAuth, async (req, res) => {
  try {
    const { phone } = req.params;
    const { sendWhatsApp } = await import("./whatsapp.js");
    const therapistPhone = process.env.THERAPIST_PHONE;
    if (!therapistPhone) return res.status(400).json({ error: "No therapist phone set" });
    await sendWhatsApp(therapistPhone,
      `🚨 *Manual escalation from admin dashboard*\nCustomer: ${phone}\nPlease check the dashboard.`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global bot on/off
app.post("/admin/api/bot-enabled", requireAuth, async (req, res) => {
  try {
    const { enabled } = req.body || {};
    await supabase.from("settings").upsert(
      { key: "bot_enabled", value: !!enabled, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    emitEvent({ type: "settings_updated" });
    res.json({ ok: true, enabled: !!enabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── SSE stream for live updates ────────────────────────────────────────────
app.get("/admin/events", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  res.write(`event: hello\ndata: {}\n\n`);

  const unsubscribe = subscribe((event) => {
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      /* client disconnected */
    }
  });

  // Keep-alive ping every 25s so Railway / proxies don't close the connection
  const keepalive = setInterval(() => {
    try { res.write(`: keepalive\n\n`); } catch {}
  }, 25000);

  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});

// ── Start server ───────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Bot listening on 0.0.0.0:${PORT}`);
  console.log(
    `✓ Env check: WA_TOKEN=${!!process.env.WA_TOKEN}, ANTHROPIC=${!!process.env.ANTHROPIC_API_KEY}, VERIFY=${!!process.env.VERIFY_TOKEN}, SUPABASE=${!!process.env.SUPABASE_URL}, ADMIN_PASS=${!!process.env.ADMIN_PASSWORD}`
  );
});
