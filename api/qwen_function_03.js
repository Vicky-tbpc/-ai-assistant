// qwen_function_12.js
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    // 記得在這裡接收前端新傳來的變數
    const { prompt, serial_number, history = [], local_date, local_time, action, metric_data } = req.body;

    // ==========================================
    // 新增：客製化 AI 開場白攔截區塊
    // ==========================================
    if (action === 'generate_greeting') {
      const greetingPrompt = `你是一個友好熱情的 AI 健康夥伴。
請根據以下提示，生成一句專屬的開場白。

【規則】
1. 第一句請自由發揮，表達歡迎回來的心情，例如：「歡迎回來！我是你的健康夥伴 👋」。
2. 【絕對禁止】：嚴格禁止在對話中出現使用者的名字或 AI 的名字，請用「你」來稱呼對方即可。
2. 接著請根據以下指標狀態給予一句${metric_data.type}：
   - 指標：${metric_data.metric}
   - 狀態：${metric_data.status}
3. 說明完後，最後加上一句引導詢問，例如：「接下來想看看哪個健康指標呢？」或「現在想從哪個部分開始了解呢？」
4. 語氣要像平輩朋友一樣自然。
5. 【絕對禁止】：嚴格禁止使用敬稱「您」，請全部使用「你」。

請直接輸出對話文字，不要包含額外的解釋或 JSON 格式。`;

      let greetingRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: greetingPrompt, mode: "chat" })
      });
      
      let greetingResult = await greetingRes.json();
      return res.status(200).json({ text: greetingResult.textResponse });
    }

    // ==========================================
    // 第一階段：極速意圖判斷 (Router) 
    // ==========================================
    const parseDate = (dateStr) => {
      const [y, m, d] = dateStr.split('-');
      return new Date(y, m - 1, d);
    };

    const todayObj = parseDate(local_date);
    // 修正點 1：只在這裡宣告一次 dayOfWeek
    const dayOfWeek = todayObj.toLocaleDateString('zh-TW', { weekday: 'long' });

    const getOffsetDate = (offset) => {
      const d = new Date(todayObj);
      d.setDate(d.getDate() + offset);
      const yy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${yy}-${mm}-${dd}`;
    };

    const yesterdayStr = getOffsetDate(-1);
    const lastWeekStartStr = getOffsetDate(-7);

const routerPrompt = `今天是 ${local_date} (${dayOfWeek})。
請判斷使用者的問題：「${prompt}」的意圖。

【判斷規則】
1. 【圖表嚴格限制】：只有當使用者「明確提到視覺化圖表的關鍵字」（例如：「趨勢圖」、「圖表」、「折線圖」、「畫圖」、「看圖」）時，才將 need_trend_chart 設為 true。
   - 若 need_trend_chart 為 true，請判斷他想看哪一種，將 trend_type 設為以下之一："all"(完整/全部)、"battery"(恢復指數)、"rhr"(靜息心率)、"n3"(深睡期)、"rmssd"、"hrmin"(最低脈搏)、"hbi"(低氧負擔)、"unknown"(未指定)。
2. 【純數據查詢】：若使用者只是提到「7天」、「最近」、「變化」、「趨勢」或單純詢問各項指標數據，但「沒有明確提到畫圖或圖表」，請務必將 need_trend_chart 設為 false，並將 need_data 設為 true，輸出對應的 start 和 end 日期。
3. 若回答模糊（例如：「都可以」、「看看」）或只是打招呼，請「一律視為需要數據」，並將日期設為昨天到今天：${yesterdayStr} 到 ${local_date}。
4. 【回答模式判定】(極度重要)：請新增一個欄位 "answer_mode"，其值只能是 "local"、"cloud" 或 "hybrid"。
   - "local": 問題僅與個人的健康數據、睡眠、心率、地端知識庫有關。
   - "cloud": 問題純粹是外部知識，例如：天氣狀況、飲食建議、大眾醫學標準、一般閒聊，不需要看個人數據。
   - "hybrid": 問題同時涉及個人健康數據與外部環境因素(天氣/飲食/大眾標準)，需要結合兩者來回答。(例如：「我今天心率很高，跟天氣熱有關係嗎？」)

【日期對照表】(請直接使用以下計算好的日期，絕對不要自己推算)
1. 「今天」：${local_date}
2. 「昨天」：${yesterdayStr}
3. 「上週 / 本週 / 最近一週 / 過去七天」：${lastWeekStartStr} 到 ${yesterdayStr}
請「務必只」輸出 JSON 格式，範例如下：
{"need_data": true, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD", "need_trend_chart": false, "trend_type": "unknown", "answer_mode": "local"}`;

    let intentRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: routerPrompt, mode: "chat" })
    });

    let intentData = await intentRes.json();
    let intent = { need_data: false };
    try {
      const jsonMatch = intentData.textResponse.match(/\{.*\}/s);
      if (jsonMatch) intent = JSON.parse(jsonMatch[0]);
    } catch (e) { console.log("意圖解析失敗"); }
    // 👇 2. 新增這段攔截邏輯：如果是要看圖表，就直接回傳，不要去撈資料了
        if (intent.need_trend_chart) {
      const trendNames = {
        "all": "📊 完整圖表",
        "battery": "📈 恢復指數",
        "rhr": "❤️‍ 靜息心率",
        "n3": "🌙 深睡期 (N3)",
        "rmssd": "🌿 rMSSD",
        "hrmin": "💓 睡眠最低脈搏",
        "hbi": "🫁 HBI 低氧負擔指數"
      };

      // 如果有明確抓到種類，且不是 unknown
      if (intent.trend_type && trendNames[intent.trend_type]) {
        return res.status(200).json({ 
          action: 'show_specific_trend', 
          trend_type: intent.trend_type,
          text: `沒問題！為你送上最近的 ${trendNames[intent.trend_type]} 趨勢圖表 👇` 
        });
      } else {
        // 使用者沒說清楚，維持原本的選單
        return res.status(200).json({ 
          action: 'show_trend_options', 
          text: "🔍 想查看哪一種趨勢圖表呢？" 
        });
      }
    }

    // ==========================================
    // 第二階段：抓取並「格式化」數據 (僅在需要數據時)
    // ==========================================
    let healthContext = "目前沒有相關數據。";
    if (intent.need_data && intent.start && intent.end) {
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      
      // 日期偏移小工具
      const getCustomOffsetDate = (baseDateStr, offset) => {
        const [y, m, d] = baseDateStr.split('-');
        const dateObj = new Date(y, m - 1, d);
        dateObj.setDate(dateObj.getDate() + offset);
        return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
      };

      // 為了完整涵蓋邊界，API 結束日期自動延後 1 天
      const apiStart = intent.start;
      const apiEnd = getCustomOffsetDate(intent.end, 1);
      
      const healthApiUrl = `${protocol}://${req.headers['host']}/api/health?serial=${serial_number}&start=${apiStart}&end=${apiEnd}`;
      
      const dataRes = await fetch(healthApiUrl);
      if (dataRes.ok) {
        const finalContextData = await dataRes.json();
        
        if (finalContextData.length > 0) {
          // 1. 動態產生使用者詢問的精準日期陣列（Calendar Dates）
          const dateArray = [];
          let current = parseDate(intent.start);
          const endLimit = parseDate(intent.end);
          while (current <= endLimit) {
            const yy = current.getFullYear();
            const mm = String(current.getMonth() + 1).padStart(2, '0');
            const dd = String(current.getDate()).padStart(2, '0');
            dateArray.push(`${yy}-${mm}-${dd}`);
            current.setDate(current.getDate() + 1);
          }

          // 2. 依照「日曆日期」重組文字，消滅 AI 的日期混淆
          const contextBlocks = dateArray.map(targetDate => {
            const targetDateObj = parseDate(targetDate);
            const weekday = targetDateObj.toLocaleDateString('zh-TW', { weekday: 'short' });

            // 尋找這一天的「當天早晨醒來結算」（比對 record_end 的日期部分）
            const wakeRow = finalContextData.find(d => d.raw_json?.record_end?.split(' ')[0] === targetDate);
            // 尋找這一天的「當天晚上入睡生理數據」（比對 record_date）
            const sleepRow = finalContextData.find(d => d.record_date === targetDate);

            let blockText = `=== 日期：${targetDate} (週${weekday}) ===\n`;

            // 組合早晨數據
            if (wakeRow) {
              const rawWake = wakeRow.raw_json || {};
              const battery = rawWake.Personal_Battery_weighted_round;
              const light = rawWake.light_status;
              const rhr = rawWake.RHR_raw;
              const batteryDisplay = (battery === null || battery === undefined) ? "資料不足" : `${battery}%`;
              const lightDisplay = (light === null || light === undefined || light === "無資料") ? "資料不足" : light;
              const rhrDisplay = (rhr === null || rhr === undefined) ? "資料不足" : `${rhr}bpm`;
              blockText += `☀️ 【當天早晨醒來結算報告】：\n`;
              blockText += `   - 恢復指數: ${batteryDisplay}\n`;
              blockText += `   - 發炎風險: ${lightDisplay}\n`;
              blockText += `   - 靜息心率: ${rhrDisplay}\n`;
            } else {
              blockText += `☀️ 【當天早晨醒來結算報告】：無數據\n`;
            }

            // 組合夜晚數據
            if (sleepRow) {
              const rawSleep = sleepRow.raw_json || {};
              const tst = rawSleep.TST_min || 0;
              const trt = rawSleep.TRT_min || 0;
              const n3Min = rawSleep.N3_min || 0;
              const n1n2Min = rawSleep.N1N2_min || 0;
              const remMin = rawSleep.REM_min || 0;
              const n3Time = `${Math.floor(n3Min / 60)}時${n3Min % 60}分`;
              const n1n2Time = `${Math.floor(n1n2Min / 60)}時${n1n2Min % 60}分`;
              const remTime = `${Math.floor(remMin / 60)}時${remMin % 60}分`;

              blockText += `🛏️ 【當天晚上入睡生理數據】：\n`;
              blockText += `   - 總睡眠時間: ${Math.floor(tst / 60)}時${tst % 60}分\n`;
              blockText += `   - 總紀錄時間: ${Math.floor(trt / 60)}時${trt % 60}分\n`;
              blockText += `   - 睡眠效率: ${rawSleep.sleep_efficiency_pct || 0}%\n`;
              blockText += `   - 睡眠結構: 深睡期 (N3) ${rawSleep.N3_pct || 0}% (${n3Time}), 淺睡期 (N1、N2) ${rawSleep.N1N2_pct || 0}% (${n1n2Time}), 快速動眼期 (REM) ${rawSleep.REM_pct || 0}% (${remTime}), 醒來及清醒期 (Wake) ${rawSleep.wake_minutes || 0}分\n`;
              blockText += `   - 睡眠血氧飽和度: 平均 ${rawSleep.SpO2_mean || 0}% / 最高 ${rawSleep.SpO2_max || 0}% / 最低 ${rawSleep.SpO2_min || 0}%\n`;
              blockText += `   - 睡眠低血氧時間比例: T90 ${rawSleep.T90_pct || 0}%, T89 ${rawSleep.T89_pct || 0}%, T88 ${rawSleep.T88_pct || 0}%\n`;
              blockText += `   - 低氧負擔指數: HBI低氧負擔指數 ${rawSleep.HBI || 0}%min/h\n`;
              blockText += `   - 睡眠血氧下降指數: ODI 3% ${rawSleep.ODI3_total || 0}次/h, ODI 4% ${rawSleep.ODI4_total || 0}次/h\n`;
              blockText += `   - 睡眠呼吸頻率: 平均 ${rawSleep.RR_mean || 0} / 最高 ${rawSleep.RR_max || 0} / 最低 ${rawSleep.RR_min || 0} rpm\n`;
              blockText += `   - 睡眠脈搏: 平均 ${rawSleep.HR_mean || 0} / 最高 ${rawSleep.HR_max || 0} / 最低 ${rawSleep.HR_min || 0} bpm\n`;
              blockText += `   - 心率變異度: SDNN ${rawSleep.SDNN || 0}ms, rMSSD ${rawSleep.rMSSD || 0}ms, LF ${rawSleep.LF_ms2 || 0}ms2, HF ${rawSleep.HF_ms2 || 0}ms2, LF/HF ${rawSleep.LF_HF || 0}, pNN50 ${rawSleep.pNN50_pct || 0}%\n`;
            } else {
              blockText += `🛏️ 【當天晚上入睡生理數據】：無數據\n`;
            }

            return blockText;
          });

          healthContext = contextBlocks.join('\n---\n');
          
          // 多日統計摘要平均值（精準計算使用者指定的這幾天）
          if (dateArray.length >= 7) {
            const fieldsToAvg = [
              { key: 'Personal_Battery_weighted_round', label: '平均恢復指數', unit: '%', isSleep: false },
              { key: 'RHR_raw', label: '平均靜息心率', unit: 'bpm', isSleep: false },
              { key: 'TST_min', label: '平均總睡眠時間', unit: ' min', isSleep: true },
              { key: 'sleep_efficiency_pct', label: '平均睡眠效率', unit: '%', isSleep: true },
              { key: 'N3_pct', label: '平均深睡比例 (N3)', unit: '%', isSleep: true },
              { key: 'N1N2_pct', label: '平均淺睡比例 (N1、N2)', unit: '%', isSleep: true },
              { key: 'REM_pct', label: '平均快速動眼期比例 (REM)', unit: '%', isSleep: true },
              { key: 'SpO2_mean', label: '平均血氧飽和度', unit: '%', isSleep: true },
              { key: 'T90_pct', label: '平均T90比例', unit: '%', isSleep: true },
              { key: 'T89_pct', label: '平均T89比例', unit: '%', isSleep: true },
              { key: 'T88_pct', label: '平均T88比例', unit: '%', isSleep: true },
              { key: 'HBI', label: '平均低氧負擔指數', unit: '%min/h', isSleep: true },
              { key: 'ODI3_total', label: '平均 ODI 3%', unit: '次/h', isSleep: true },
              { key: 'ODI4_total', label: '平均 ODI 4%', unit: '次/h', isSleep: true },
              { key: 'HR_mean', label: '平均脈搏', unit: 'bpm', isSleep: true },
              { key: 'RR_mean', label: '平均呼吸頻率', unit: 'rpm', isSleep: true },
              { key: 'SDNN', label: '平均SDNN', unit: 'ms', isSleep: true },
              { key: 'rMSSD', label: '平均rMSSD', unit: 'ms', isSleep: true },
              { key: 'LF_ms2', label: '平均LF', unit: 'ms2', isSleep: true },
              { key: 'HF_ms2', label: '平均HF', unit: 'ms2', isSleep: true },
              { key: 'LF_HF', label: '平均LF/HF', unit: '', isSleep: true },
              { key: 'pNN50_pct', label: '平均pNN50', unit: '%', isSleep: true }
            ];

            const summaryLines = fieldsToAvg.map(field => {
              let sum = 0;
              let count = 0;
              dateArray.forEach(targetDate => {
                const row = field.isSleep 
                  ? finalContextData.find(d => d.record_date === targetDate)
                  : finalContextData.find(d => d.raw_json?.record_end?.split(' ')[0] === targetDate);
                
                if (row && row.raw_json?.[field.key] !== undefined && row.raw_json?.[field.key] !== null) {
                  sum += Number(row.raw_json[field.key]) || 0;
                  count++;
                }
              });
              const avg = count > 0 ? (sum / count).toFixed(1) : "0.0";
              return `- ${field.label}：${avg}${field.unit || ''}`;
            });

            healthContext = `【多日統計摘要 (共 ${dateArray.length} 天)】\n${summaryLines.join('\n')}\n` + healthContext;
          }
        }
      }
    }

    // ==========================================
    // 第三階段：最終回答 (分流處理)
    // ==========================================
    
// 定義 Gemini 呼叫輔助函式
    const callGemini = async (geminiPrompt, currentHistory = []) => {
      try {
        let contents = [];
        
        // 1. 處理歷史紀錄，加上嚴格防呆
        if (Array.isArray(currentHistory)) {
          currentHistory.forEach(h => {
            // 找出文字內容 (相容 content, text, message 等常見命名)
            const textContent = h.content || h.text || h.message;
            
            // 確保文字存在且不是空白，才放進去
            if (textContent && textContent.trim() !== "") {
              // Gemini 只接受 'user' 和 'model' 兩種 role，前端如果傳 'assistant' 會被轉成 'model'
              const role = h.role === 'user' ? 'user' : 'model';
              contents.push({
                role: role,
                parts: [{ text: textContent }]
              });
            }
          });
        }

        // 2. 加上這次最新的問題 (Prompt)
        contents.push({ role: 'user', parts: [{ text: geminiPrompt }] });

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
        
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: contents,
            systemInstruction: {
              role: "system",
              parts: [{ text: "你是一個友好熱情的 AI 健康夥伴。絕對禁止使用敬稱「您」，請全部使用「你」，並以平輩口吻、繁體中文回答，可適當加入 emoji 讓對話更生動。" }]
            }
          })
        });
        
        const data = await response.json();
        
        if (!data.candidates || data.candidates.length === 0) {
          console.error("❌ Gemini API 拒絕了請求，回傳內容:", JSON.stringify(data, null, 2));
          return "抱歉，雲端大腦暫時連不上，或是 API 設定有點狀況，請檢查後台 Log 喔！😅";
        }

        return data.candidates[0].content.parts[0].text;
      } catch (error) {
        console.error("❌ 呼叫 Gemini 時發生程式例外錯誤:", error);
        return "雲端系統發生了一些小錯誤，請稍後再試！🙏";
      }
    };

    // 定義 AnythingLLM (Qwen) 呼叫輔助函式
    const callQwen = async (qwenPrompt) => {
      const res = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ message: qwenPrompt, mode: "chat" })
      });
      const result = await res.json();
      return result.textResponse;
    };

    const historyText = history.map(h => `${h.role === 'user' ? '使用者' : '助理'}: ${h.content}`).join('\n');
    let aiText = "";
    let usedModel = "";

    if (intent.answer_mode === "cloud") {
      // 🟢 模式一：純雲端 (Gemini)
      const cloudPrompt = `今天是 ${local_date}。
使用者問：「${prompt}」。
請直接根據你的豐富知識（如天氣狀況、飲食建議、大眾醫學標準等）來回答使用者的問題。`;
      aiText = await callGemini(cloudPrompt, history);
      usedModel = 'LLM-Gemini-Cloud';

    } else if (intent.answer_mode === "hybrid") {
      // 🟡 模式二：混合模式 (先 Qwen 後 Gemini)
      const qwenSystemPrompt = `你是一個健康數據分析師。請根據以下使用者數據進行初步分析：
${healthContext}
使用者問題：「${prompt}」
請客觀、簡要地列出該數據的觀察與地端知識庫的相關解釋，不用作過多的噓寒問暖，因為接下來會交由最終客服整理。`;
      
      const qwenRawAnalysis = await callQwen(`${qwenSystemPrompt}\n\n${historyText}\n使用者: ${prompt}`);
      
      const hybridPrompt = `今天是 ${local_date}。
針對使用者的問題：「${prompt}」

我們有一個地端系統針對使用者的健康數據做出了以下初步分析：
「${qwenRawAnalysis}」

請你發揮強大的雲端知識庫（例如目前的天氣狀況、普遍的飲食建議、大眾標準），將上述的「地端個人數據分析」與「外部環境/常識」結合在一起，組成一個完整且好懂的回答提供給使用者。
【規則】：
1. 嚴禁對使用者提到「根據地端系統分析」等後台運作字眼，請將資訊內化，直接以你的口吻給出融會貫通的答案。
2. 要像平輩朋友一樣自然，絕對禁止使用敬稱「您」，一律用「你」。`;

      aiText = await callGemini(hybridPrompt, history);
      usedModel = 'LLM-Hybrid-Qwen+Gemini';

    } else {
      // 🔵 模式三：純地端 (Qwen)
      const localSystemPrompt = `你是一個友好熱情的 AI 健康夥伴。今天是 ${local_date}。
【生理數據解讀規則】
1. 以下是使用者從 ${intent.start || '今日'} 到 ${intent.end || '今日'} 的真實數據：
   ${healthContext}
2. 【數據查閱指南】(極度重要)：
   - 數據文本已經以「=== 日期：YYYY-MM-DD ===」為區塊分好了。
   - 使用者詢問某一天的任何數據（例如：「5月12日的HBI」或「5月12日的恢復指數」），請直接至該日期的區塊內，尋找對應的「早晨醒來結算報告」或「晚上入睡生理數據」作答。
   - 後端已經幫你處理好所有的跨日、因果與日期對齊邏輯，請「百分之百相信並照抄」各日期區塊下的數據，你不需要（也絕對禁止）再自行增減日期或推算因果關係。
3. 【健康分析因果邏輯】(僅在分析原因時啟用)：
   - 若使用者進階詢問「為什麼某天早晨的恢復指數/發炎風險不好？」，請理解這是由「前一天晚上入睡」的生理數據所決定的。
   - 你應主動查看「前一天日期區塊」的【當天晚上入睡生理數據】（如：血氧、HBI、心率等）來為使用者找出原因並進行關聯分析。
   - 範例：如果使用者問「為什麼我 5月12日 早上恢復指數這麼低？」，你應該去翻看「5月11日」區塊內的「晚上入睡生理數據」來幫他找出睡眠問題。
4. 【禁止捏造】：深睡期 (N3) 比例生理上絕不可能達到 100%。若看到 100，那是「恢復指數」，請勿混淆！
5. 【嚴禁自行推算星期】：數據文本中已經在日期後方標註了正確的星期幾（例如：2026-05-14 (週四)）。請直接「照抄」文本裡的星期，絕對不要自己推算或猜測！
6. 若數據中顯示「資料不足」，請誠實告知使用者，不要猜測。
7. 【知識庫使用規範】：
   - 知識庫僅用於「醫學常識」與「各項指標的標準值/參考範圍」查詢。
   - 【嚴格禁止】：絕對不可將知識庫 PDF 裡的「範例個案數值」誤當作是使用者的數據。
8. 【禁止輸出 JSON】：你現在是面對使用者的最終客服，請用自然、親切的對話回答，絕對不可以輸出 JSON 格式或任何程式碼字串。
9. 【極度重要！對話延續規則】：你和使用者已經打過招呼了！後續的回覆請「直接針對問題回答」，嚴格禁止再說出「歡迎回來」、「我是你的健康夥伴」或任何類似的自我介紹開場白！
10. 【語氣要求】：請用平輩朋友的口吻回答。絕對禁止在回覆中使用敬稱「您」，請全部使用「你」。

請用平輩口吻回答，多用 emoji！`;

      const finalChatPrompt = `${localSystemPrompt}\n\n${historyText}\n使用者: ${prompt}`;
      aiText = await callQwen(finalChatPrompt);
      usedModel = 'LLM-Qwen-Local';
    }

    // 將紀錄存入 Supabase，順便標記這次是用哪套模型回答的
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
        ai_response: aiText,
        record_date: local_date,
        record_time: local_time,
        ai_model: usedModel // 動態寫入使用的模型
      })
    }).catch(e => console.error("背景存檔錯誤:", e));

    waitUntil(logTask);

    return res.status(200).json({ text: aiText });

  } catch (error) {
    console.error(error);
    res.status(500).json({ text: "大腦卡住了，再試試？ 😅" });
  }
}
