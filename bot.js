// ═══════════════════════════════════════════════════════════════════════════
//  bot.js — Handles inbound WhatsApp messages, calls Claude, sends replies
//  Uses Supabase for persistent sessions (see db.js)
//  Emits SSE events for the /admin dashboard live view
// ═══════════════════════════════════════════════════════════════════════════
import Anthropic from "@anthropic-ai/sdk";
import { sendWhatsApp } from "./whatsapp.js";
import { SYSTEM_PROMPT } from "./knowledge.js";
import {
  getHistory,
  addToHistory,
  isBotPaused,
  setBotPaused,
  markEscalated,
  isBotGloballyEnabled,
  setCustomerName,
} from "./db.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Tiny event bus for SSE clients ─────────────────────────────────────────
const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitEvent(event) {
  for (const fn of listeners) {
    try { fn(event); } catch {}
  }
}

// ── Main handler ───────────────────────────────────────────────────────────
export async function handleIncoming(phone, userText, profileName) {
  // Save/refresh customer name from WhatsApp profile if we got one
  if (profileName) {
    try { await setCustomerName(phone, profileName); } catch {}
  }

  // ── Admin commands (sent from your own number for quick control) ──
  const cmd = userText.trim().toLowerCase();
  if (cmd === "/pause") {
    await setBotPaused(phone, true);
    console.log(`Bot paused for ${phone}`);
    emitEvent({ type: "session_updated", phone });
    return;
  }
  if (cmd === "/resume") {
    await setBotPaused(phone, false);
    console.log(`Bot resumed for ${phone}`);
    emitEvent({ type: "session_updated", phone });
    return;
  }

  // ── Always log the customer's message immediately (before any bot logic) ──
  await addToHistory(phone, "user", userText);
  emitEvent({ type: "message", phone, role: "user", content: userText });

  // ── Global master switch ──
  if (!(await isBotGloballyEnabled())) {
    console.log(`Bot globally disabled — not replying to ${phone}`);
    return;
  }

  // ── Per-customer pause (human takeover) ──
  if (await isBotPaused(phone)) {
    console.log(`Bot paused for ${phone} — not replying`);
    return;
  }

  // ── Ask Claude for a reply ──
  let replyText;
  try {
    const history = await getHistory(phone);
    const response = await claude.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: history,
    });
    replyText = response.content[0].text.trim();
  } catch (err) {
    console.error("Claude API error:", err);
    replyText =
      "Sorry, I'm having a moment! Please WhatsApp us directly or call — we're available 24/7.";
  }

  // ── Handle escalation flag ──
  const shouldEscalate = replyText.includes("[ESCALATE]");
  if (shouldEscalate) {
    replyText = replyText.replace("[ESCALATE]", "").trim();
    await markEscalated(phone);
    await notifyTherapist(phone, userText);
    emitEvent({ type: "session_updated", phone });
  }

  // ── Log + send ──
  await addToHistory(phone, "assistant", replyText);
  emitEvent({ type: "message", phone, role: "assistant", content: replyText });

  try {
    await sendWhatsApp(phone, replyText);
    console.log(`[${phone}] ← ${replyText}`);
  } catch (err) {
    console.error(`[${phone}] Failed to send reply:`, err.message);
  }
}

// ── Admin sends a manual reply from the dashboard ──────────────────────────
export async function sendAdminReply(phone, text) {
  // Auto-pause bot when admin steps in, so bot doesn't reply on top
  await setBotPaused(phone, true);
  await addToHistory(phone, "admin", text);
  emitEvent({ type: "message", phone, role: "admin", content: text });
  emitEvent({ type: "session_updated", phone });
  await sendWhatsApp(phone, text);
  console.log(`[${phone}] ← (admin) ${text}`);
}

// ── Alert the on-call therapist ────────────────────────────────────────────
async function notifyTherapist(customerPhone, urgentMessage) {
  const therapistPhone = process.env.THERAPIST_PHONE;
  if (!therapistPhone) return;

  const alert =
    `🚨 *Escalation needed*\n` +
    `Customer: ${customerPhone}\n` +
    `Message: "${urgentMessage}"\n` +
    `Bot has been paused for this customer.\n` +
    `Please follow up ASAP, then send /resume in that chat when done.`;

  try {
    await sendWhatsApp(therapistPhone, alert);
    console.log(`Escalation alert sent to therapist (${therapistPhone})`);
  } catch (err) {
    console.error("Failed to send escalation alert:", err.message);
  }
}
