// qwen_function_02.js
import { waitUntil } from '@vercel/functions';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { prompt, serial_number, history = [], local_date } = req.body;
    // 取得今天是星期幾，幫助 AI 準確計算「上週」
    const dayOfWeek = new Date(local_date).toLocaleDateString('zh-TW', { weekday: 'long' });

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
請判斷使用者的問題：「${prompt}」是否需要查詢生理健康數據？
【日期對照表】(請直接使用以下計算好的日期，絕對不要自己推算)
1. 「今天」：${local_date}
2. 「昨天」：${yesterdayStr}
3. 「上週 / 本週 / 最近一週 / 過去七天」：${lastWeekStartStr} 到 ${yesterdayStr}
請「務必只」輸出 JSON：{"need_data": true, "start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}`;

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

    // ==========================================
    // 第二階段：抓取並「格式化」數據 - 整合你的格式化邏輯
    // ==========================================
    let healthContext = "目前沒有相關數據。";
    if (intent.need_data && intent.start && intent.end) {
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const healthApiUrl = `${protocol}://${req.headers['host']}/api/health?serial=${serial_number}&start=${intent.start}&end=${intent.end}`;
      
     const dataRes = await fetch(healthApiUrl);
      if (dataRes.ok) {
        const finalContextData = await dataRes.json();
        
        if (finalContextData.length > 0) {
          healthContext = finalContextData.map(item => {
            const raw = item.raw_json || {}; // 修正點 2：raw 只宣告一次
            
            const itemDateObj = parseDate(item.record_date);
            const itemWeekday = itemDateObj.toLocaleDateString('zh-TW', { weekday: 'short' });

            let endWeekday = "";
            if (raw.record_end && raw.record_end !== "無") {
              const endDateObj = parseDate(raw.record_end.split(' ')[0]);
              endWeekday = `(${endDateObj.toLocaleDateString('zh-TW', { weekday: 'short' })})`;
            }

            const tst = raw.TST_min || 0;
            const trt = raw.TRT_min || 0;
            const n3Min = raw.N3_min || 0;
            const n1n2Min = raw.N1N2_min || 0;
            const remMin = raw.REM_min || 0;
            
            const n3Time = `${Math.floor(n3Min / 60)}時${n3Min % 60}分`;
            const n1n2Time = `${Math.floor(n1n2Min / 60)}時${n1n2Min % 60}分`;
            const remTime = `${Math.floor(remMin / 60)}時${remMin % 60}分`;

            const battery = raw.Personal_Battery_weighted_round;
            const light = raw.light_status;
            const batteryDisplay = (battery === null || battery === undefined) ? "資料不足" : `${battery}%`;
            const lightDisplay = (light === null || light === undefined || light === "無資料") ? "資料不足" : light;

            return `
[數據紀錄]
- (record_date) 入睡日期: ${item.record_date} (${itemWeekday})
- (record_end) 起床日期: ${raw.record_end || "無"} ${endWeekday}
- (record_end) 恢復指數: ${batteryDisplay}
- (record_end) 發炎風險: ${lightDisplay}
- 總睡眠時間: ${Math.floor(tst / 60)}時${tst % 60}分
- 總紀錄時間: ${Math.floor(trt / 60)}時${trt % 60}分
- 睡眠效率: ${raw.sleep_efficiency_pct || 0}%
- 睡眠結構: 深睡期 (N3) ${raw.N3_pct || 0}% (${n3Time}), 淺睡期 (N1、N2) ${raw.N1N2_pct || 0}% (${n1n2Time}), 快速動眼期 (REM) ${raw.REM_pct || 0}% (${remTime}), 醒來及清醒期 (Wake) ${raw.wake_minutes || 0}分
- 睡眠血氧飽和度: 平均 ${raw.SpO2_mean || 0}% / 最高 ${raw.SpO2_max || 0}% / 最低 ${raw.SpO2_min || 0}%
- 睡眠低血氧時間比例: T90 ${raw.T90_pct || 0}%, T89 ${raw.T89_pct || 0}%, T88 ${raw.T88_pct || 0}%
- 低氧負擔指數: HBI低氧負擔指數 ${raw.HBI || 0}%min/h
- 睡眠血氧下降指數: ODI 3% ${raw.ODI3_total || 0}次/h, ODI 4% ${raw.ODI4_total || 0}次/h
- 睡眠呼吸頻率: 平均 ${raw.RR_mean || 0} / 最高 ${raw.RR_max || 0} / 最低 ${raw.RR_min || 0} rpm
- 睡眠脈搏: 平均 ${raw.HR_mean || 0} / 最高 ${raw.HR_max || 0} / 最低 ${raw.HR_min || 0} bpm
- 心率變異度: SDNN ${raw.SDNN || 0}ms, rMSSD ${raw.rMSSD || 0}ms, LF ${raw.LF_ms2 || 0}ms2, HF ${raw.HF_ms2 || 0}ms2, LF/HF ${raw.LF_HF || 0}, pNN50 ${raw.pNN50_pct || 0}%`;
          }).join('\n---\n');
          
// 如果天數太多（超過 7 天），加上統計摘要避免 AI 幻覺
if (finalContextData.length > 7) {
  // 1. 定義你想統計的欄位名稱 (必須與 raw_json 的 key 完全一致)
  const fieldsToAvg = [
    { key: 'Personal_Battery_weighted_round', label: '平均恢復指數', unit: '%' },
    { key: 'TST_min', label: '平均總睡眠時間', unit: ' min' },
    { key: 'sleep_efficiency_pct', label: '平均睡眠效率', unit: '%' },
    { key: 'N3_pct', label: '平均深睡比例 (N3)', unit: '%' },
    { key: 'N1N2_pct', label: '平均淺睡比例 (N1、N2)', unit: '%' },
    { key: 'REM_pct', label: '平均快速動眼期比例 (REM)', unit: '%' },
    { key: 'SpO2_mean', label: '平均血氧飽和度', unit: '%' },
    { key: 'T90_pct', label: '平均T90比例', unit: '%' },
    { key: 'T89_pct', label: '平均T89比例', unit: '%' },
    { key: 'T88_pct', label: '平均T88比例', unit: '%' },
    { key: 'HBI', label: '平均低氧負擔指數', unit: '%min/h' },
    { key: 'ODI3_total', label: '平均 ODI 3%', unit: '次/h' },
    { key: 'ODI4_total', label: '平均 ODI 4%', unit: '次/h' },
    { key: 'HR_mean', label: '平均脈搏', unit: ' bpm' },
    { key: 'RR_mean', label: '平均呼吸頻率', unit: 'rpm' },
    { key: 'SDNN', label: '平均SDNN', unit: 'ms' },
    { key: 'rMSSD', label: '平均rMSSD', unit: 'ms' },
    { key: 'LF_ms2', label: '平均LF', unit: 'ms2' },
    { key: 'HF_ms2', label: '平均HF', unit: 'ms2' },
    { key: 'LF_HF', label: '平均LF/HF', unit: '' },
    { key: 'pNN50_pct', label: '平均pNN50', unit: '%' }
  ];

  // 2. 用迴圈自動算出所有平均值並組成文字
  const summaryLines = fieldsToAvg.map(field => {
    // 這裡使用 cur.raw_json?.[field.key] 確保對應到原始數據
    const sum = finalContextData.reduce((acc, cur) => acc + (Number(cur.raw_json?.[field.key]) || 0), 0);
    const avg = (sum / finalContextData.length).toFixed(1);
    return `- ${field.label}：${avg}${field.unit || ''}`;
  });

  // 3. 組合進 healthContext
  healthContext = `【多日統計摘要 (共 ${finalContextData.length} 天)】\n${summaryLines.join('\n')}\n` + healthContext;
}
        }
      }
    }

    // ==========================================
    // 第三階段：最終回答 - 增加「防幻覺」解讀規則
    // ==========================================
    const systemPrompt = `你是一個友好熱情的 AI 健康夥伴。今天是 ${local_date}。
【生理數據解讀規則】
1. 以下是使用者從 ${intent.start || '今日'} 到 ${intent.end || '今日'} 的真實數據：
   ${healthContext}
2. 【禁止捏造】：深睡期 (N3) 比例生理上絕不可能達到 100%。若看到 100，那是「恢復指數」，請勿混淆！
3. 【星期推算】：描述趨勢時，請嚴格依照數據紀錄中標註的星期幾（如：週一、週二）來回答，絕對不可以自行瞎猜星期！
4. 若數據中顯示「資料不足」，請誠實告知使用者，不要猜測。
5. 知識庫僅用於醫學常識查詢。嚴禁拿知識庫裡的 PDF 範例數值來回答使用者的現況。
請用平輩口吻回答，多用 emoji 喔！`;

    const historyText = history.map(h => `${h.role === 'user' ? '使用者' : '助理'}: ${h.content}`).join('\n');
    const finalChatPrompt = `${systemPrompt}\n\n${historyText}\n使用者: ${prompt}`;

    let finalRes = await fetch(`${process.env.ANYTHING_LLM_URL}/api/v1/workspace/${process.env.ANYTHING_LLM_SLUG}/chat`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.ANYTHING_LLM_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: finalChatPrompt, mode: "chat" })
    });
    
    let finalResult = await finalRes.json();
    const aiText = finalResult.textResponse;

    // 背景存檔
    const logTask = fetch(`${process.env.SUPABASE_URL}/rest/v1/chat_logs`, {
      method: 'POST',
      headers: { 'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number, user_query: prompt, ai_response: aiText, record_date: local_date })
    });
    waitUntil(logTask);

    return res.status(200).json({ text: aiText });

  } catch (error) {
    res.status(500).json({ text: "大腦卡住了，再試試？ 😅" });
  }
}
