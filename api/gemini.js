// api/gemini.js
export default async function handler(req, res) {
  // 1. 設定 CORS，允許前端網頁存取
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // 處理瀏覽器預檢請求 (Preflight)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 限制只能使用 POST 方法
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body;
    
    // 從 Vercel 環境變數中讀取金鑰
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY");
      return res.status(500).json({ text: "伺服器配置錯誤：未設定環境變數" });
    }

    // 呼叫 Google Gemini API (使用 v1 穩定版與標準名稱)
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();

    // 檢查 Google API 是否回傳錯誤
    if (data.error) {
      console.error("Google API Error:", data.error);
      return res.status(data.error.code || 500).json({ 
        text: `Google API 錯誤: ${data.error.message}` 
      });
    }

    // 解析並回傳 AI 生成的文字
    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳任何內容。";
    res.status(200).json({ text: resultText });

  } catch (error) {
    console.error("Backend Handler Error:", error);
    res.status(500).json({ text: "伺服器內部錯誤，請檢查 Vercel Logs。" });
  }
}
