// sleep-reminder_09_AI睡前提醒
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  // 取得台北時間的今天、昨天、前天
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  const dayBeforeYesterdayDate = new Date();
  dayBeforeYesterdayDate.setDate(dayBeforeYesterdayDate.getDate() - 2);
  const dayBeforeYesterday = dayBeforeYesterdayDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });

  try {
    // 1. 取得所有有 LINE ID 的使用者 (同時撈取 nickname 供 AI 稱呼)
    const { data: users, error: userError } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id, nickname')
      .not('line_user_id', 'is', null);

    if (userError) throw userError;

    // --- STEP 2: 建立自動輪詢函數，向地端 Python 伺服器獲取資料 ---
    const API_KEY = process.env.LOCAL_API_KEY;
    const TUNNEL_URLS_STR = process.env.LOCAL_TUNNEL_URLS || process.env.LOCAL_TUNNEL_URL;

    if (!TUNNEL_URLS_STR || !API_KEY) {
      throw new Error('Vercel 環境變數缺失，請確認 LOCAL_TUNNEL_URLS 或 LOCAL_API_KEY 已設定。');
    }

    const tunnelList = TUNNEL_URLS_STR.split(',').map(url => url.trim());

    // 定義自動輪詢函數
    async function fetchFromTunnels(pathAndQuery, options) {
      let lastErrorText = "無法連線";
      let lastStatus = 500;
      for (const baseUrl of tunnelList) {
        try {
          const url = `${baseUrl}${pathAndQuery}`;
          console.log(`[自動推播] 嘗試連線至地端 Python API: ${url}`);
          const response = await fetch(url, options);
          if (response.ok) {
            return response;
          } else {
            lastStatus = response.status;
            lastErrorText = await response.text();
          }
        } catch (error) {
          console.log(`[自動推播連線失敗跳過] ${baseUrl}`);
        }
      }
      throw new Error(`地端 API 回傳錯誤 (${lastStatus}): ${lastErrorText}`);
    }

    // 預先拉取健康資料 (供方案二 Fallback 使用)
    let healthData = [];
    try {
      const params = new URLSearchParams();
      params.append('start', dayBeforeYesterday);
      params.append('end', yesterday);
      const pathAndQuery = `/api/get-latest-health?${params.toString()}`;

      const response = await fetchFromTunnels(pathAndQuery, {
        headers: {
          'X-API-KEY': API_KEY,
          'ngrok-skip-browser-warning': 'true'
        }
      });
      healthData = await response.json();
    } catch (err) {
      console.warn("預抓地端健康數據失敗 (若執行方案二將受影響):", err.message);
    }

    const metrics = ['Battery_TST_min_A', 'Battery_N3_pct_A', 'Battery_rMSSD_A', 'Battery_HBI_A', 'Battery_HR_min_A'];

    // 3. 使用 Promise.all 平行處理所有使用者的任務
    const results = await Promise.all(users.map(async (user) => {
      try {
        let finalMessage = null;
        let schemeUsed = "";

        // =========================================================
        // 🚀【方案一】：優先讀取地端 Excel + 啟動 Gemini AI 生成建議
        // =========================================================
        try {
          const recPath = `/api/get-recommendation?serial=${encodeURIComponent(user.serial_number)}&date=${todayStr}`;
          const recResponse = await fetchFromTunnels(recPath, {
            headers: {
              'X-API-KEY': API_KEY,
              'ngrok-skip-browser-warning': 'true'
            }
          });

          if (recResponse.ok) {
            const recData = await recResponse.json();
            if (recData && recData.found && (recData.priorityItem || recData.actionText)) {
              // 呼叫 Gemini AI 整理生成訊息
              finalMessage = await generateAiReminder(user.nickname, recData.priorityItem, recData.actionText);
              schemeUsed = "Scheme 1 (AI Excel)";
            }
          }
        } catch (scheme1Err) {
          console.log(`[使用者 ${user.serial_number}] 方案一檢查未通過 (${scheme1Err.message})，自動切換至方案二。`);
        }

        // =========================================================
        // 🔄【方案二】：降級（Fallback）使用 Supabase 詞庫
        // =========================================================
        if (!finalMessage) {
          const userYesterday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === yesterday);
          const userBeforeYesterday = healthData.find(d => d.serial_number === user.serial_number && d.record_date === dayBeforeYesterday);

          if (!userYesterday || !userYesterday.raw_json) {
            return { serial: user.serial_number, status: "Skipped", reason: "昨天(最新)沒資料 (方案一無 Excel 且方案二無數據)" };
          }

          const isAllNull = metrics.every(m => userYesterday.raw_json[m] == null);
          if (isAllNull) {
            return { serial: user.serial_number, status: "Skipped", reason: "昨天的所有 Battery 指標均為 null" };
          }

          let targetMetric = '';
          if (userBeforeYesterday && userBeforeYesterday.raw_json) {
            let minDiff = Infinity;
            metrics.forEach(m => {
              const diff = (userYesterday.raw_json[m] || 0) - (userBeforeYesterday.raw_json[m] || 0);
              if (diff < minDiff) {
                minDiff = diff;
                targetMetric = m;
              }
            });
          } else {
            let minValue = Infinity;
            metrics.forEach(m => {
              const val = userYesterday.raw_json[m] || 0;
              if (val < minValue) {
                minValue = val;
                targetMetric = m;
              }
            });
          }

          const tstMin = userYesterday.raw_json.TST_min || 0;
          const logicKeys = getLogicKeys(targetMetric, tstMin);

          const { data: phrases } = await supabase
            .from('phrase_library')
            .select('detailed_content')
            .in('logic_key', logicKeys);

          if (!phrases || phrases.length === 0) {
            return { serial: user.serial_number, status: "Error", reason: "方案二找不到對應詞句" };
          }

          finalMessage = phrases[Math.floor(Math.random() * phrases.length)].detailed_content;
          schemeUsed = "Scheme 2 (Supabase Phrase)";
        }

        // 發送 LINE 訊息
        const sendStatus = await sendLineMessage(user.line_user_id, finalMessage);

        return {
          serial: user.serial_number,
          status: sendStatus === 'success' ? "Success" : "Failed",
          scheme: schemeUsed,
          target_date: todayStr
        };

      } catch (err) {
        return { serial: user.serial_number, status: "Error", message: err.message };
      }
    }));

    res.status(200).json({ execution_date: todayStr, results });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}

// ==========================================
// 🤖 方案一：呼叫 Gemini AI 生成睡前提醒
// ==========================================
async function generateAiReminder(nickname, priorityItem, actionText) {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    throw new Error('Vercel 環境變數缺失 GEMINI_API_KEY');
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;

  const userNickname = nickname || '朋友';

  const prompt = `【身份鎖定】
絕對禁止自稱任何名稱（嚴禁出現「Soosyn」、「Soosyn 看到」、「我是 Soosyn」等任何品牌或 AI 自稱，請直接給予建議）。
絕對禁止自稱：Google AI、Gemini、大型語言模型、第三方 AI。
使用者暱稱：${nickname || '朋友'}

請根據以下今天對應的健康恢復建議內容，為使用者生成一段溫馨、簡短的睡前提醒與建議：
- 恢復指數優先調整項目：${priorityItem || '無'}
- 建議行動 (actionText)：${actionText || '無'}

【寫作規則】
1. 語氣要像平輩朋友一樣自然親切，可適當加入合適的 emoji。
2. 絕對禁止使用敬稱「您」，請全部使用「你」。
3. 訊息發送時間為晚上 8:25~9:24 之間，嚴禁使用「夜深了」、「深夜」等不符合時間點的描述。
4. 問候與道別時請直接說「晚安」，絕對禁止使用「晚上好」。
5. 內容包含睡前關心、提醒優先調整項目以及具體的行動建議。
6. 數據、單位與關鍵名詞絕對忠於原文：
   - 完全依照提供的數值與單位，絕對不可自行增刪單位（例如：若原文為「10.7」，不可擅自加上「%」；原文為「64%」，則保留「64%」）。
   - 若原文提到「有效率約 XX%」（代表成功機率），必須完整保留「有效率」三個字，絕對不可以刪減或竄改為「效率有 XX%」。
7. 字數請控制在 100 到 150 字以內，保持精簡扼要，方便在 LINE 上閱讀。
8. 請直接輸出準備發送的訊息文字，不要包含任何額外的解釋、JSON 或 Markdown 程式碼區塊標籤。`;

  const response = await fetch(geminiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini API 請求失敗 (${response.status})`);
  }

  const result = await response.json();
  const generatedText = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

  if (!generatedText) {
    throw new Error('Gemini API 未回傳有效文字');
  }

  return generatedText;
}

// 根據指標與睡眠分鐘數，回傳對應的 logic_key 陣列 (方案二)
function getLogicKeys(metric, tstMin) {
  let base = '';
  switch (metric) {
    case 'Battery_TST_min_A':
      return tstMin < 420 ? ['總睡眠睡前提醒1', '總睡眠睡前提醒2', '總睡眠睡前提醒3']
                          : ['總睡眠睡前提醒4', '總睡眠睡前提醒5', '總睡眠睡前提醒6'];
    case 'Battery_N3_pct_A': base = 'N3睡前提醒'; break;
    case 'Battery_rMSSD_A': base = 'rMSSD睡前提醒'; break;
    case 'Battery_HBI_A': base = 'HBI睡前提醒'; break;
    case 'Battery_HR_min_A': base = '最低脈搏睡前提醒'; break;
  }
  return [`${base}1`, `${base}2`, `${base}3`];
}

// 發送 LINE 推播訊息
async function sendLineMessage(lineUserId, text) {
  const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const response = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${lineToken}`
    },
    body: JSON.stringify({
      to: lineUserId,
      messages: [{ type: 'text', text }]
    })
  });
  return response.ok ? 'success' : 'failed';
}
