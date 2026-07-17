import express from "express";
import { handleIncoming } from "./bot.js";

const app = express();
app.use(express.json());
app.get("/", (_req, res) => res.status(200).send("Blissful Senja bot is running"));

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
  // Acknowledge immediately — Meta expects 200 within 5s
  res.sendStatus(200);

  try {
    console.log("Incoming webhook body:", JSON.stringify(req.body, null, 2));

    const entry = req.body?.entry?.[0];
    if (!entry) {
      console.log("No entry found in webhook payload. req.body:", JSON.stringify(req.body));
      return;
    }

    const change = entry?.changes?.[0];
    if (!change) {
      console.log("No changes found in entry. entry:", JSON.stringify(entry));
      return;
    }

    const msg = change?.value?.messages?.[0];
    if (!msg) {
      console.log("No message found in change.value. change.value:", JSON.stringify(change?.value));
      return;
    }

    if (msg.type !== "text") {
      console.log(`Ignoring non-text message. msg.type=${msg.type}, msg:`, JSON.stringify(msg));
      return; // ignore non-text for now
    }

    const from = msg.from;           // customer's WA number
    const text = msg.text.body;

    console.log(`[${from}] → ${text}`);
    await handleIncoming(from, text);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`✓ Bot listening on 0.0.0.0:${PORT}`);
  console.log(`✓ Env check: WA_TOKEN=${!!process.env.WA_TOKEN}, ANTHROPIC=${!!process.env.ANTHROPIC_API_KEY}, VERIFY=${!!process.env.VERIFY_TOKEN}`);
});
