import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MODEL || "claude-sonnet-4-6";

const SYSTEM_PROMPT = fs.readFileSync(
  new URL("./system_prompt.md", import.meta.url),
  "utf-8"
);

if (!ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY in .env");
}

app.get("/", (req, res) => {
  res.json({ status: "ok", name: "Rafiq backend", model: MODEL });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

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
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic API error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "Wani kuskure ya faru wajen tuntuɓar Rafiq.",
      });
    }

    const reply = data.content?.find((c) => c.type === "text")?.text || "";
    res.json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "An kasa samun amsa. A sake gwadawa." });
  }
});

app.listen(PORT, () => {
  console.log(`Rafiq backend running on port ${PORT}`);
});
