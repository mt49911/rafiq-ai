import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // higher limit to allow base64 file uploads

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.MODEL || "gemini-3.5-flash";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

const SYSTEM_PROMPT = fs.readFileSync(
  new URL("./system_prompt.md", import.meta.url),
  "utf-8"
);

// Base (unauthenticated) client - used only for register/login
const supabaseBase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Creates a client scoped to the logged-in user's token, so
// Row Level Security automatically restricts access to their own data.
function supabaseForUser(token) {
  return createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// Middleware: extract and verify the user's token from Authorization header
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Ana buƙatar shiga (login) tukuna." });

  const client = supabaseForUser(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) {
    return res.status(401).json({ error: "Zaman ka ya ƙare, a sake shiga (login)." });
  }
  req.user = data.user;
  req.supabase = client;
  next();
}

app.get("/", (req, res) => {
  res.json({ status: "ok", name: "Rafiq backend", model: MODEL });
});

// ---------- AUTH ----------

app.post("/api/auth/register", async (req, res) => {
  try {
    const { email, password, full_name, interests } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Ana buƙatar email da password." });
    }

    const { data, error } = await supabaseBase.auth.signUp({
      email,
      password,
      options: { data: { full_name } },
    });

    if (error) return res.status(400).json({ error: error.message });

    // Create profile row (interests array chosen at signup)
    if (data.user) {
      await supabaseBase.from("profiles").insert({
        id: data.user.id,
        full_name: full_name || null,
        interest_areas: interests || [],
      });
    }

    res.json({
      message: "An yi register! Duba email ɗinka domin tabbatarwa (verification).",
      user: data.user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An kasa yin register. A sake gwadawa." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const { data, error } = await supabaseBase.auth.signInWithPassword({ email, password });

    if (error) return res.status(400).json({ error: "Email ko password ba daidai ba ne." });

    res.json({
      access_token: data.session.access_token,
      user: data.user,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An kasa shiga (login). A sake gwadawa." });
  }
});

// ---------- CHATS (history) ----------

app.get("/api/chats", requireAuth, async (req, res) => {
  const { data, error } = await req.supabase
    .from("chats")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ chats: data });
});

app.get("/api/chats/:id/messages", requireAuth, async (req, res) => {
  const { data, error } = await req.supabase
    .from("messages")
    .select("*")
    .eq("chat_id", req.params.id)
    .order("created_at", { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ messages: data });
});

app.delete("/api/chats/:id", requireAuth, async (req, res) => {
  const { error } = await req.supabase.from("chats").delete().eq("id", req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ deleted: true });
});

// ---------- FILE UPLOAD ----------
// Expects { fileName, fileType, fileDataBase64 } in the body

app.post("/api/upload", requireAuth, async (req, res) => {
  try {
    const { fileName, fileType, fileDataBase64 } = req.body;
    if (!fileName || !fileDataBase64) {
      return res.status(400).json({ error: "Ana buƙatar fayil." });
    }

    const buffer = Buffer.from(fileDataBase64, "base64");
    const path = `${req.user.id}/${Date.now()}_${fileName}`;

    const { error } = await req.supabase.storage
      .from("uploads")
      .upload(path, buffer, { contentType: fileType || "application/octet-stream" });

    if (error) return res.status(500).json({ error: error.message });

    const { data: signed } = await req.supabase.storage
      .from("uploads")
      .createSignedUrl(path, 3600); // valid for 1 hour

    res.json({ path, url: signed?.signedUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An kasa loda fayil." });
  }
});

// ---------- CHAT (main endpoint, now with history + optional file) ----------
// Body: { chat_id (optional), message, fileUrl (optional), fileType (optional) }

app.post("/api/chat", requireAuth, async (req, res) => {
  try {
    let { chat_id, message, fileUrl, fileType } = req.body;

    if (!message && !fileUrl) {
      return res.status(400).json({ error: "Ana buƙatar saƙo ko fayil." });
    }

    // Create a new chat session if none was given
    if (!chat_id) {
      const { data: newChat, error: chatErr } = await req.supabase
        .from("chats")
        .insert({ user_id: req.user.id, title: (message || "Fayil").slice(0, 40) })
        .select()
        .single();
      if (chatErr) return res.status(500).json({ error: chatErr.message });
      chat_id = newChat.id;
    }

    // Save the user's message
    await req.supabase.from("messages").insert({
      chat_id,
      role: "user",
      content: message || "[File uploaded]",
      file_url: fileUrl || null,
    });

    // Load recent conversation history for this chat (last 20 messages)
    const { data: history } = await req.supabase
      .from("messages")
      .select("role, content")
      .eq("chat_id", chat_id)
      .order("created_at", { ascending: true })
      .limit(20);

    const contents = (history || []).map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    // If a file was included with this turn, attach it as inline data to the last part
    if (fileUrl && fileType) {
      const fileRes = await fetch(fileUrl);
      const arrayBuf = await fileRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString("base64");
      contents[contents.length - 1].parts.push({
        inline_data: { mime_type: fileType, data: base64 },
      });
    }

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

    // Save the assistant's reply
    await req.supabase.from("messages").insert({
      chat_id,
      role: "assistant",
      content: reply,
    });

    // Bump the chat's updated_at
    await req.supabase.from("chats").update({ updated_at: new Date().toISOString() }).eq("id", chat_id);

    res.json({ reply, chat_id });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "An kasa samun amsa. A sake gwadawa." });
  }
});

app.listen(PORT, () => {
  console.log(`Rafiq backend running on port ${PORT}`);
});
