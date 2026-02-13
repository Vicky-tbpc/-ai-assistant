// api/gemini.js
export default async function handler(req, res) {
  // 1. 設定 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ text: "伺服器錯誤：找不到 API Key" });
    }

    // 關鍵修正：
    // 1. 改用 v1beta (通常新模型如 2.0 都先在 beta 版開放)
    // 2. 模型名稱改為您清單中確認有的 'gemini-2.0-flash'
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(data.error.code || 500).json({ 
        text: `Google API 錯誤 (${data.error.code}): ${data.error.message}` 
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 回傳內容為空";
    res.status(200).json({ text });

  } catch (error) {
    console.error("Backend Error:", error);
    res.status(500).json({ text: "伺服器內部錯誤，請檢查 Vercel Logs。" });
  }
}
