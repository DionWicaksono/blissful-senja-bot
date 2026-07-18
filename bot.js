// ═══════════════════════════════════════════════════════════════════════════
//  bot.js — Handles inbound WhatsApp messages, calls Claude, sends replies
//  Uses Supabase for persistent sessions (see db.js)
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
} from "./db.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Main handler ───────────────────────────────────────────────────────────
export async function handleIncoming(phone, userText) {
  // ── Admin commands (sent from your own number or via curl for testing) ──
  const cmd = userText.trim().toLowerCase();
  if (cmd === "/pause") {
    await setBotPaused(phone, true);
    console.log(`Bot paused for ${phone}`);
    return;
  }
  if (cmd === "/resume") {
    await setBotPaused(phone, false);
    console.log(`Bot resumed for ${phone}`);
    return;
  }

  // ── Always log the customer's message, even if we won't reply ──
  await addToHistory(phone, "user", userText);

  // ── Check global master switch ──
  if (!(await isBotGloballyEnabled())) {
    console.log(`Bot globally disabled — not replying to ${phone}`);
    return;
  }

  // ── Check per-customer pause (human takeover) ──
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

  // ── Handle escalation flag from Claude ──
  const shouldEscalate = replyText.includes("[ESCALATE]");
  if (shouldEscalate) {
    replyText = replyText.replace("[ESCALATE]", "").trim();
    await markEscalated(phone); // marks escalated=true AND bot_paused=true
    await notifyTherapist(phone, userText);
  }

  // ── Log the bot's reply, then send it ──
  await addToHistory(phone, "assistant", replyText);

  try {
    await sendWhatsApp(phone, replyText);
    console.log(`[${phone}] ← ${replyText}`);
  } catch (err) {
    console.error(`[${phone}] Failed to send reply:`, err.message);
  }
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
