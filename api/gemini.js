// api/gemini.js
export default async function handler(req, res) {
  // 1. 設定 CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ text: "伺服器錯誤：環境變數 GEMINI_API_KEY 未設定。" });
    }

    // 重點修正：改用 v1 穩定版與正確的模型路徑
    // 移除 v1beta，改用 v1
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ 
          parts: [{ text: prompt }] 
        }]
      })
    });

    const data = await response.json();

    if (data.error) {
      // 捕捉 Google API 回傳的具體錯誤訊息
      return res.status(data.error.code || 500).json({ 
        text: `Google API 錯誤 (${data.error.code}): ${data.error.message}` 
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳任何內容。";
    res.status(200).json({ text });

  } catch (error) {
    console.error("Vercel Backend Error:", error);
    res.status(500).json({ text: "伺服器端發生錯誤，請查看 Vercel Logs。" });
  }
}
