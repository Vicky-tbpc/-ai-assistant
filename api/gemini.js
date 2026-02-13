// api/gemini.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { prompt } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    // 使用 v1 穩定版端點搭配 gemini-1.5-flash，這是免費版最不可能報錯的組合
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
      // 這裡會抓到具體的錯誤原因
      return res.status(data.error.code || 500).json({ 
        text: `Google 服務訊息 (${data.error.code}): ${data.error.message}` 
      });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "AI 目前沒有回傳內容。";
    res.status(200).json({ text });

  } catch (error) {
    res.status(500).json({ text: "系統內部異常，請檢查 Vercel Logs。" });
  }
}
