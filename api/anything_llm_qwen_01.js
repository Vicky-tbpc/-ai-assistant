// anything_llm_qwen_01
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  // CORS 設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, record_date, history = [], local_date, local_time } = req.body;

    // === 【設定區】 ===
    // 注意：請確保你的 OLLAMA_URL 指向地端的 OpenAI 相容端點，例如 http://你的地端IP:11434/v1/chat/completions
    const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434/v1/chat/completions";
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // --- 1. 定義提供給 LLM 的「工具」(Tools) ---
    const tools = [
      {
        type: "function",
        function: {
          name: "get_health_data_from_json",
          description: "從地端資料庫獲取使用者特定日期區間的生理與睡眠數據。日期請以使用者的語意推算。",
          parameters: {
            type: "object",
            properties: {
              start_date: {
                type: "string",
                description: "查詢的開始日期，格式為 YYYY-MM-DD"
              },
              end_date: {
                type: "string",
                description: "查詢的結束日期，格式為 YYYY-MM-DD"
              }
            },
            required: ["start_date", "end_date"]
          }
        }
      }
    ];

    // --- 2. 準備系統提示詞 (System Prompt) ---
    // 這裡放你原本的規則，但不用再寫死日期禁令，直接把規則交給 LLM
    const systemPrompt = `
你是一個線上AI健康夥伴。請用語氣輕鬆、像平輩朋友的方式回答，【絕對不要使用「您」】。
今天是 ${local_date}，現在時間 ${local_time}。

【核心規範】
1. 若需要查詢生理數據，請務必呼叫 get_health_data_from_json 工具。
2. 每次回覆需包含 3～5 個 emoji，分散在句子中。
3. 嚴禁醫療診斷語氣，請使用「建議觀察」、「可能存在」等委婉詞彙。
4. 提供 1～2 個與數據相關的具體建議。
5. 若數據顯示壓力大或紅/黃燈，請在結尾關心：「你現在會覺得頭痛、心跳很快，或是有其他不舒服嗎？」
6. 若工具回傳沒有資料，請直接誠實告知找不到該日期的資料，【不要】自己發明數據。

【健康數據分析標準】
- 恢復指數：<60%注意，60-79%標準，80-94%良好，≥95%優秀。
- 發炎風險：綠燈(低風險)、黃燈(中等風險，需注意)、紅燈(高風險，需徹底休息)。
- 總睡眠時間：目標 7 小時。
- 睡眠效率：良好 ≥ 85%, 不佳 ≤ 75%。
- 血氧 (SpO2)：應 > 95%。
- 心率變異度 (HRV)：數值較高通常代表恢復較好。
`;

    // 組合對話歷史 (清洗過的歷史紀錄)
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.map(h => ({
        role: h.role === "model" ? "assistant" : "user",
        content: h.parts ? h.parts[0].text : ""
      })).slice(-5), // 只取最近 5 句避免上下文過長
      { role: "user", content: prompt }
    ];

    // --- 3. 第一回合：詢問 LLM (意圖辨識與日期推算) ---
    const response1 = await fetch(ollamaUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "qwen2.5:14b", // 確保這是你在 Ollama 跑的模型名稱
        messages: messages,
        tools: tools,
        tool_choice: "auto", // 讓模型自己決定要不要查資料
        temperature: 0.1
      })
    });

    if (!response1.ok) throw new Error("Ollama 連線失敗 (Round 1)");
    const data1 = await response1.json();
    const responseMessage = data1.choices[0].message;

    let finalResultText = "";

    // --- 4. 判斷是否需要執行工具 ---
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      const toolCall = responseMessage.tool_calls[0];
      const args = JSON.parse(toolCall.function.arguments);
      
      console.log(`🤖 Qwen 決定查詢資料，日期範圍：${args.start_date} 至 ${args.end_date}`);

      // 【執行工具】：呼叫地端 API 去讀取 health_data_YYYYMMDD.json
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const host = req.headers['host'];
      const queryParams = new URLSearchParams({
          serial: serial_number,
          start: args.start_date,
          end: args.end_date
      }).toString();
      
      let dbData = [];
      try {
        const dbResponse = await fetch(`${protocol}://${host}/api/health?${queryParams}`);
        if (dbResponse.ok) {
          dbData = await dbResponse.json();
        }
      } catch (err) {
        console.error("地端 JSON 讀取失敗:", err);
      }

      // --- 5. 第二回合：將撈回來的 JSON 餵給 LLM 總結 ---
      messages.push(responseMessage); // 必須把 LLM 的呼叫行為加進歷史
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        // 如果沒資料，回傳提示文字；有資料則直接把 JSON 轉字串塞給它
        content: dbData.length > 0 ? JSON.stringify(dbData) : JSON.stringify({ error: "該日期區間沒有找到紀錄" })
      });

      const response2 = await fetch(ollamaUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "qwen2.5:14b",
          messages: messages,
          temperature: 0.2
        })
      });

      if (!response2.ok) throw new Error("Ollama 連線失敗 (Round 2)");
      const data2 = await response2.json();
      finalResultText = data2.choices[0].message.content;

    } else {
      // 若 LLM 判定不需要查資料 (例如只是在閒聊打招呼)
      finalResultText = responseMessage.content;
    }

    // --- 6. 寫入 Supabase (背景執行) ---
    const logTask = fetch(`${supabaseUrl}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        serial_number: serial_number,
        user_query: prompt,
        ai_response: finalResultText,
        record_date: local_date,
        record_time: local_time,
        ai_model: 'Ollama-Qwen-2.5-FunctionCalling'
      })
    }).catch(e => console.error("背景存檔錯誤:", e));

    waitUntil(logTask);

    // --- 7. 回傳結果給使用者 ---
    return res.status(200).json({ text: finalResultText });

  } catch (error) {
    console.error("處理流程發生錯誤:", error);
    res.status(500).json({ text: "我的地端大腦稍微斷線了，再試一次看看？ 😅" });
  }
}