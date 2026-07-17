// Sends a text message via WhatsApp Cloud API
export async function sendWhatsApp(to, text) {
  const url = `https://graph.facebook.com/v19.0/${process.env.WA_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WA_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json();
    console.error("WA send error:", JSON.stringify(err));
    throw new Error(`WhatsApp API error: ${res.status}`);
  }

  return res.json();
}
