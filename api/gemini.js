// api/gemini.js 07
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
   // 1. 取得暱稱
    const { prompt, nickname, ai_name } = req.body; 
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) return res.status(500).json({ text: "伺服器錯誤：找不到 API Key" });

    // 關鍵修正：改用您清單中有的 'gemini-2.0-flash-lite'
    // 這是免費層級最可能有額度的模型
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
        // 新增 system_instruction 來固定語氣與語言
       system_instruction: {
          parts: [{ 
            text: `你現在的角色是「${ai_name}」，是一個親切的健康夥伴。
                   你是使用者的平輩好朋友，絕對不要使用敬稱『您』，請用『你』。
                   請務必使用『繁體中文』回覆。
                   使用者暱稱是「${nickname}」，打招呼時請親切地稱呼他。
                   自稱時請使用你的名字「${ai_name}」（例如：嘿 ${nickname}！我是你的夥伴 ${ai_name}）。
                   除非要求詳細說明，否則請節錄重點。
                   請直接回答問題，不要輸出任何內心思考或思緒筆記。`
          }]
        },
   contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          thinking: false // 順便確保關閉思緒筆記
        }
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


