import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || "gemini-2.5-flash";

const SYSTEM_PROMPT = fs.readFileSync(
  new URL("./system_prompt.md", import.meta.url),
  "utf-8"
);

if (!GEMINI_API_KEY) {
  console.error("Missing GEMINI_API_KEY in .env");
}

app.get("/", (req, res) => {
  res.json({ status: "ok", name: "Rafiq backend (Gemini)", model: MODEL });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
        }),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini API error:", data);
      return res.status(response.status).json({
        error: data?.error?.message || "Wani kuskure ya faru wajen tuntuɓar Rafiq.",
      });
    }

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    res.json({ reply });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "An kasa samun amsa. A sake gwadawa." });
  }
});

app.listen(PORT, () => {
  console.log(`Rafiq backend running on port ${PORT}`);
});
