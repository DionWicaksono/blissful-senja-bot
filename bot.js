import Anthropic from "@anthropic-ai/sdk";
import { sendWhatsApp } from "./whatsapp.js";
import { SYSTEM_PROMPT } from "./knowledge.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── In-memory conversation history (keyed by phone number) ─────────────────
// For production, swap this Map for Redis or Supabase
const sessions = new Map();
const MAX_HISTORY = 10; // keep last 10 turns per customer

function getHistory(phone) {
  if (!sessions.has(phone)) sessions.set(phone, []);
  return sessions.get(phone);
}

function addToHistory(phone, role, content) {
  const history = getHistory(phone);
  history.push({ role, content });
  // Keep only the last MAX_HISTORY messages
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

// ── Main handler ───────────────────────────────────────────────────────────
export async function handleIncoming(phone, userText) {
  addToHistory(phone, "user", userText);

  let replyText;

  try {
    const response = await claude.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: getHistory(phone),
    });

    replyText = response.content[0].text.trim();
  } catch (err) {
    console.error("Claude API error:", err);
    replyText =
      "Sorry, I'm having a moment! Please WhatsApp us directly or call — we're available 24/7.";
  }

  addToHistory(phone, "assistant", replyText);

  // Check if Claude flagged escalation
  if (replyText.includes("[ESCALATE]")) {
    replyText = replyText.replace("[ESCALATE]", "").trim();
    await notifyTherapist(phone, userText);
  }

  await sendWhatsApp(phone, replyText);
  console.log(`[${phone}] ← ${replyText}`);
}

// ── Alert the on-call therapist ────────────────────────────────────────────
async function notifyTherapist(customerPhone, urgentMessage) {
  const therapistPhone = process.env.THERAPIST_PHONE;
  if (!therapistPhone) return;

  const alert =
    `🚨 *Escalation needed*\n` +
    `Customer: ${customerPhone}\n` +
    `Message: "${urgentMessage}"\n` +
    `Please follow up ASAP.`;

  await sendWhatsApp(therapistPhone, alert);
  console.log(`Escalation alert sent to therapist (${therapistPhone})`);
}
