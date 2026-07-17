# Serenity On-Call — WhatsApp Bot

Node.js bot for 24/7 WhatsApp customer service, powered by Claude Haiku, deployed on Railway.

---

## Quick start (local)

```bash
npm install
cp .env.example .env   # fill in your keys
npm run dev
```

Use [ngrok](https://ngrok.com) to expose your local server for Meta webhook testing:
```bash
ngrok http 3000
# Copy the https URL → paste into Meta webhook field
```

---

## Deploy to Railway

1. Push this repo to GitHub
2. Create a new Railway project → **Deploy from GitHub repo**
3. In Railway → **Variables**, add all keys from `.env.example`
4. Railway auto-assigns a public URL (e.g. `https://wa-massage-bot.up.railway.app`)
5. Paste that URL + `/webhook` into Meta's webhook config

---

## Feeding data to the bot

### Option A — Edit `src/knowledge.js` (recommended to start)
The `SYSTEM_PROMPT` in that file is your entire knowledge base.
- Update services, pricing, hours, area, policies
- Redeploy on Railway → live in ~30 seconds
- Best for: menus under ~3000 words

### Option B — Supabase RAG (for larger data)
For bigger catalogs, therapist bios, detailed FAQs:
1. Create a free [Supabase](https://supabase.com) project
2. Enable the `pgvector` extension
3. Upload text chunks via the Supabase dashboard or API
4. In `bot.js`, add a vector similarity search before calling Claude:
   - Query: `SELECT content FROM docs ORDER BY embedding <-> $1 LIMIT 3`
   - Inject the top results into the system prompt as context

### Option C — Live booking data
Connect to Google Calendar or Calendly:
1. Get a Google Calendar API key
2. In `bot.js`, before calling Claude, check availability:
   ```js
   const slots = await getAvailableSlots(date); // your calendar function
   // Append slots to system prompt dynamically
   ```
3. Claude will then answer availability questions with real data

---

## Escalation

If Claude detects urgency (pain, emergency), it prepends `[ESCALATE]` to its reply.
The bot strips that flag, sends the message to the customer, and fires a WhatsApp alert
to `THERAPIST_PHONE`. Update that env var with the on-call therapist's number.

---

## File structure

```
src/
  server.js      → Express webhook endpoints
  bot.js         → Claude API + conversation history
  whatsapp.js    → Meta Cloud API sender
  knowledge.js   → YOUR KNOWLEDGE BASE (edit this!)
.env.example     → Required environment variables
```
