// api/gemini.js 04
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(500).json({ text: "伺服器錯誤：找不到 API Key" });

    // 關鍵修正：改用您清單中有的 'gemini-2.0-flash-lite'
    // 這是免費層級最可能有額度的模型
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
  contents: [{ parts: [{ text: prompt }] }],
  tools: [
    {
      google_search_retrieval: {
        dynamic_retrieval_config: {
          mode: "MODE_DYNAMIC", // <-- 這裡補上 MODE_
          dynamic_threshold: 0.3, // 偵測到需要搜尋時自動啟動
        },
      },
    },
  ],
})
    });

    const data = await response.json();

    if (data.error) {
      return res.status(data.error.code || 500).json({ 
        text: `Google API 錯誤 (${data.error.code}): ${data.error.message}` 
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳內容。";
    res.status(200).json({ text });

  } catch (error) {
    res.status(500).json({ text: "伺服器內部錯誤，請檢查 Vercel Logs。" });
  }
}
