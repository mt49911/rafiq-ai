import dotenv from "dotenv";
import fs from "fs";
dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";
const SYSTEM_PROMPT = fs.readFileSync(
  new URL("./system_prompt.md", import.meta.url),
  "utf-8"
);

if (!TELEGRAM_TOKEN) {
  console.error("Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const conversations = new Map();

async function askRafiq(chatId, userText) {
  const history = conversations.get(chatId) || [];
  history.push({ role: "user", content: userText });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: history,
    }),
  });

  const data = await response.json();
  const reply = data.content?.find((c) => c.type === "text")?.text
    || "An kasa samun amsa a yanzu.";

  history.push({ role: "assistant", content: reply });
  conversations.set(chatId, history.slice(-20));
  return reply;
}

async function sendTelegramMessage(chatId, text) {
  await fetch(`${TG_API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}

async function pollUpdates() {
  let offset = 0;
  console.log("Rafiq is now listening on Telegram...");

  while (true) {
    try {
      const res = await fetch(
        `${TG_API}/getUpdates?timeout=30&offset=${offset}`
      );
      const data = await res.json();

      for (const update of data.result || []) {
        offset = update.update_id + 1;
        const msg = update.message;
        if (!msg || !msg.text) continue;

        const reply = await askRafiq(msg.chat.id, msg.text);
        await sendTelegramMessage(msg.chat.id, reply);
      }
    } catch (err) {
      console.error("Polling error:", err.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

pollUpdates();
