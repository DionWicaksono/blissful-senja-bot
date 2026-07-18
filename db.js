// ═══════════════════════════════════════════════════════════════════════════
//  db.js — Supabase wrapper for sessions, messages, and settings
// ═══════════════════════════════════════════════════════════════════════════
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);

const MAX_HISTORY = 10;

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

export async function getHistory(phone) {
  const session = await ensureSession(phone);
  return Array.isArray(session.history) ? session.history : [];
}

export async function addToHistory(phone, role, content) {
  const session = await ensureSession(phone);
  const history = Array.isArray(session.history) ? [...session.history] : [];

  // Only user/assistant messages go into Claude's context window; admin messages
  // are visible in the dashboard but not part of the AI conversation.
  if (role === "user" || role === "assistant") {
    history.push({ role, content });
  }
  const trimmed = history.slice(-MAX_HISTORY);

  const { error: updateErr } = await supabase
    .from("sessions")
    .update({ history: trimmed, last_message_at: new Date().toISOString() })
    .eq("phone", phone);
  if (updateErr) console.error("addToHistory update error:", updateErr);

  const { error: insertErr } = await supabase
    .from("messages")
    .insert({ phone, role, content });
  if (insertErr) console.error("addToHistory insert error:", insertErr);
}

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

export async function setCustomerName(phone, name) {
  await ensureSession(phone);
  const { error } = await supabase
    .from("sessions")
    .update({ customer_name: name })
    .eq("phone", phone);
  if (error) console.error("setCustomerName error:", error);
}

export async function isBotGloballyEnabled() {
  const { data, error } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "bot_enabled")
    .single();
  if (error) {
    console.error("isBotGloballyEnabled error:", error);
    return true;
  }
  return data.value === true;
}
