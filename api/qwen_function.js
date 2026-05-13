// qwen_function_02.js (修正版)
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, history = [], local_date } = req.body;

    // ==========================================
    // 第一階段：極速意圖判斷 (Router)
    // ==========================================
    const routerPrompt = `今天是 ${local_date}。
請判斷使用者的問題：「${prompt}」是否需要查詢個人的生理健康數據？
如果需要，請推算需要查詢的開始與結束日期。
請「務必只」輸出以下 JSON 格式，不要有任何其他文字：
{"need_data": true, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}`;

    let intentRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: routerPrompt, mode: "chat" })
    });

    let intentData = await intentRes.json();
    let intent = { need_data: false }; // 預設值

    try {
      // 增加防呆，確保能抓到 JSON
      const jsonMatch = intentData.textResponse.match(/\{.*\}/s);
      if (jsonMatch) {
        intent = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.log("意圖解析失敗，改為普通聊天模式");
    }

    // ==========================================
    // 第二階段：抓取數據
    // ==========================================
    let healthDataString = "目前沒有查詢到使用者的相關生理數據。";
    if (intent.need_data && intent.start && intent.end) {
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const healthApiUrl = `${protocol}://${req.headers['host']}/api/health?serial=${serial_number}&start=${intent.start}&end=${intent.end}`;
      
      const dataRes = await fetch(healthApiUrl);
      if (dataRes.ok) {
        const healthData = await dataRes.json();
        healthDataString = JSON.stringify(healthData);
      }
    }

    // ==========================================
    // 第三階段：最終融合回答 (處理 History)
    // ==========================================
    
    const systemPrompt = `你是一個友好而且熱情體貼的 AI 健康夥伴。今天是 ${local_date}。
【數據使用絕對規範】
1. 以下是使用者從 ${intent.start || '今日'} 到 ${intent.end || '今日'} 的真實數據：
   === 使用者數據 ===
   ${healthDataString}
2. 關於使用者的健康狀態，你「必須完全依賴」上方數據回答。若數據為空，請誠實告知，不要捏造。
3. 知識庫僅用於查詢醫學標準（如：心率多少算快）。嚴禁拿知識庫裡的 PDF 範例數值來回答使用者！
回覆時像平輩朋友一樣，多用 emoji 喔！`;

    // 處理歷史對話，確保連貫性
    // 將 history 轉為文字格式（如果 AnythingLLM 只接受單一 message 字串）
    const historyText = history.map(h => `${h.role === 'user' ? '使用者' : '助理'}: ${h.content}`).join('\n');
    
    // 最終組合
    const finalChatPrompt = `${systemPrompt}\n\n${historyText}\n使用者: ${prompt}`;

    let finalRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ 
        message: finalChatPrompt, 
        mode: "chat" 
      })
    });
    
    let finalResult = await finalRes.json();
    const aiText = finalResult.textResponse; // 先存起來

    // 5. 背景存檔 (修正變數名稱錯誤)
    const logTask = fetch(`${process.env.SUPABASE_URL}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: { 
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal' 
      },
      body: JSON.stringify({ 
        serial_number, 
        user_query: prompt, 
        ai_response: aiText, 
        record_date: local_date 
      })
    });
    waitUntil(logTask);

    return res.status(200).json({ text: aiText });

  } catch (error) {
    console.error("Error details:", error);
    res.status(500).json({ text: "地端大腦稍微打結了，等我一下再試試看？ 😅" });
  }
}
