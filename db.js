// ═══════════════════════════════════════════════════════════════════════════
//  db.js — Supabase wrapper for sessions, messages, and settings
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const MAX_HISTORY = 10; // keep last 10 turns per customer in Claude context

// ── Sessions ───────────────────────────────────────────────────────────────

// Ensure a session row exists for this phone, returns the row
async function ensureSession(phone) {
  const { data, error } = await supabase
    .from("sessions")
    .upsert(
      { phone, last_message_at: new Date().toISOString() },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (error) {
    console.error("ensureSession error:", error);
    throw error;
  }
  return data;
}

// Get the compact history array we send to Claude
export async function getHistory(phone) {
  const session = await ensureSession(phone);
  return Array.isArray(session.history) ? session.history : [];
}

// Append a message to history + insert a row in messages table
export async function addToHistory(phone, role, content) {
  const session = await ensureSession(phone);
  const history = Array.isArray(session.history) ? [...session.history] : [];

  history.push({ role, content });
  // Only keep the last MAX_HISTORY entries in the "compact" history we send Claude
  const trimmed = history.slice(-MAX_HISTORY);

  const { error: updateErr } = await supabase
    .from("sessions")
    .update({
      history: trimmed,
      last_message_at: new Date().toISOString(),
    })
    .eq("phone", phone);

  if (updateErr) console.error("addToHistory update error:", updateErr);

  // Also log the full message in the messages table (for dashboard viewing/search)
  const { error: insertErr } = await supabase
    .from("messages")
    .insert({ phone, role, content });

  if (insertErr) console.error("addToHistory insert error:", insertErr);
}

// ── Per-customer bot pause / escalation ────────────────────────────────────

export async function isBotPaused(phone) {
  const session = await ensureSession(phone);
  return session.bot_paused === true;
}

export async function setBotPaused(phone, paused) {
  await ensureSession(phone);
  const { error } = await supabase
    .from("sessions")
    .update({ bot_paused: paused })
    .eq("phone", phone);
  if (error) console.error("setBotPaused error:", error);
}

export async function markEscalated(phone) {
  await ensureSession(phone);
  const { error } = await supabase
    .from("sessions")
    .update({ escalated: true, bot_paused: true })
    .eq("phone", phone);
  if (error) console.error("markEscalated error:", error);
}

// ── Global settings ────────────────────────────────────────────────────────

export async function isBotGloballyEnabled() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "bot_enabled")
    .single();

  if (error) {
    console.error("isBotGloballyEnabled error:", error);
    return true; // fail-open: assume enabled if we can't check
  }
  return data.value === true;
}

export async function setBotGloballyEnabled(enabled) {
  const { error } = await supabase
    .from("settings")
    .upsert(
      { key: "bot_enabled", value: enabled, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
  if (error) console.error("setBotGloballyEnabled error:", error);
}
