// qwen_function_01.js (重構版)
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, history = [], local_date } = req.body;

    // 1. 定義工具描述 (讓 AI 知道什麼時候該查資料)
    const tools = [
      {
        type: "function",
        function: {
          name: "get_user_health_data",
          description: "獲取特定日期或區間的健康數據（包含睡眠、血氧、恢復指數、發炎風險）",
          parameters: {
            type: "object",
            properties: {
              start: { type: "string", description: "開始日期 (YYYY-MM-DD)" },
              end: { type: "string", description: "結束日期 (YYYY-MM-DD)" },
            },
            required: ["start", "end"]
          }
        }
      }
    ];

    // 2. 初始對話請求
    let messages = [
      { role: "system", content: `你是一個友好的 AI 健康夥伴。今天是 ${local_date}。你可以使用 get_user_health_data 工具來查詢數據。回覆時請像平輩朋友一樣，使用「你」，多用 emoji。` },
      ...history,
      { role: "user", content: prompt }
    ];

    // --- 第一步：詢問 AI 意圖 ---
    let response = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: prompt, mode: "chat", tools }) // 注意：AnythingLLM 需開啟 Tool 支援
    });
    
    let result = await response.json();

    // 【這裡加上第一個 Log】 看看 AI 有沒有說他要呼叫工具 (toolCalls)
    console.log("AI 請求結果:", JSON.stringify(result, null, 2));
    
    // --- 第二步：判斷是否需要 Function Call ---
    // 註：不同 LLM 服務回傳 Function Call 的格式略有不同，以下為標準 OpenAI 格式範例
    if (result.toolCalls && result.toolCalls.length > 0) {
      const call = result.toolCalls[0];
      const { start, end } = JSON.parse(call.function.arguments);

      // 3. 呼叫你的 health.js (地端代理)
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const healthApiUrl = `${protocol}://${req.headers['host']}/api/health?serial=${serial_number}&start=${start}&end=${end}`;
      
      const dataRes = await fetch(healthApiUrl);
      const healthData = await dataRes.json();

      // 【這裡加上第二個 Log】 確認地端 Python 吐出來的資料是不是正確的
      console.log("地端回傳資料:", JSON.stringify(healthData, null, 2));

      // 4. 將資料餵回給 AI 做最終解釋
      messages.push({ role: "assistant", tool_calls: result.toolCalls });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(healthData) });

      const finalRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: "請根據以上數據回答使用者", mode: "chat" })
      });
      
      const finalData = await finalRes.json();
      result.textResponse = finalData.textResponse;
    }

    // 5. 背景存檔
    const logTask = fetch(`${process.env.SUPABASE_URL}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number, user_query: prompt, ai_response: result.textResponse, record_date: local_date })
    });
    waitUntil(logTask);

    return res.status(200).json({ text: result.textResponse });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "地端大腦斷線了，再試試看？ 😅" });
  }
}