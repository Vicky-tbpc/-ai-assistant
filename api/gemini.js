// api/gemini.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    // 修正：將網址與參數物件緊密結合，並改用 v1 穩定版路徑
    const apiUrl = `https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
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
        text: `Google 伺服器回報: ${data.error.message}` 
      });
    }

    const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 回傳內容為空";
    res.status(200).json({ text: resultText });

  } catch (error) {
    res.status(500).json({ text: "轉接層發生錯誤，請檢查 Vercel Logs。" });
  }
}
