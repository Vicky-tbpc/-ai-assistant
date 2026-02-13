export default async function handler(req, res) {
  // 1. 設定 CORS 允許前端存取
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { prompt } = req.body;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    const data = await response.json();

    // 2. 增加錯誤檢查：如果 Google 回傳錯誤，直接把錯誤發給前端看
    if (data.error) {
      return res.status(500).json({ text: `Google API 錯誤: ${data.error.message}` });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "Google 回傳了空內容，請檢查輸入。";
    res.status(200).json({ text });

  } catch (error) {
    console.error("Internal Error:", error);
    res.status(500).json({ text: "伺服器內部錯誤，請檢查 Vercel Logs。" });
  }
}
