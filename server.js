import express from "express";
import { handleIncoming } from "./bot.js";

const app = express();
app.use(express.json());

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
    const entry = req.body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];

    if (!msg || msg.type !== "text") return; // ignore non-text for now

    const from = msg.from;           // customer's WA number
    const text = msg.text.body;

    console.log(`[${from}] → ${text}`);
    await handleIncoming(from, text);
  } catch (err) {
    console.error("Webhook error:", err);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot listening on port ${PORT}`));
