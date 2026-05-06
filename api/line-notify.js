// api/line-notify_03.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 只允許 POST 請求
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { user_data } = req.body; // 接收地端傳來的 [{serial_number, battery, light}, ...]
    
    if (!user_data || user_data.length === 0) {
      return res.status(200).json({ message: '沒有需要通知的使用者' });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const serialNumbers = user_data.map(u => u.serial_number);

    // 1. 從 Supabase 撈取對應的 line_user_id
    const { data: users, error } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .in('serial_number', serialNumbers);

    if (error) throw error;

    // 💡 【補上這段】濾掉沒有綁定 line_user_id 的使用者
    const lineUserIds = users.map(u => u.line_user_id).filter(id => id); 

    if (lineUserIds.length === 0) {
      return res.status(200).json({ message: '這些使用者未綁定 LINE ID' });
    }

    // 2. 準備訊息組合邏輯
    const generatePersonalizedMsg = (battery, light) => {
      const baseMessages = [
        "📊 今天的健康資訊更新囉！",
        "📊 嗨～你的健康分析完成囉~",
        "📊 今日健康分析更新囉～"
      ];
      let msg = baseMessages[Math.floor(Math.random() * baseMessages.length)] + "\n\n";
      
      // 👇 新增：如果 battery 和 light 都是 null，直接回傳預設問候與連結
      if (battery === null && light === null) {
        msg += "💡 抽空看看自己的身體狀況吧👇\nhttps://ai-assistant-eight-puce.vercel.app/";
        return msg;
      }

      let warnings = [];
      // 恢復指數小於 60 (加入 battery !== null 防呆，避免 null 被轉成 0 而誤判)
      if (battery !== null && battery < 60) {
        warnings.push(`🤒 今天的恢復指數為 ${battery}%，屬於恢復不足，建議放慢節奏，多休息喔！`);
      }
      
      // 發炎風險異常
      if (light === "黃燈") {
        warnings.push(`⚠️ 今天的發炎風險為黃燈，屬於中等風險，可能有輕微發炎或壓力累積，要多注意飲食與作息喔！`);
      } else if (light === "紅燈") {
        warnings.push(`🚨 今天的發炎風險為紅燈，屬於高風險，身體發炎或壓力過高了，建議這兩天要徹底休息，必要時找醫生聊聊喔！`);
      }

      // 組合警告與回饋連結
      if (warnings.length > 0) {
        msg += warnings.join('\n') + "\n\n✨ 抽空進入頁面回饋當天生理狀態吧👇";
      } else {
        // 正常狀態
        msg += "💡 抽空看看自己的身體狀況吧👇";
      }
      
      msg += "\nhttps://ai-assistant-eight-puce.vercel.app/";
      return msg;
    };

    // 3. 分別發送 LINE 推播
    const pushPromises = users.map(user => {
      if (!user.line_user_id) return null;
      
      // 找到該使用者對應的數據
      const data = user_data.find(d => d.serial_number === user.serial_number);
      const text = generatePersonalizedMsg(data.battery, data.light);
      
      return fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${lineToken}`
        },
        body: JSON.stringify({
          to: user.line_user_id,
          messages: [{ type: 'text', text: text }]
        })
      });
    }).filter(p => p !== null);

    await Promise.all(pushPromises);
    return res.status(200).json({ message: '通知發送成功', count: pushPromises.length });

  } catch (error) {
    console.error('通知失敗:', error);
    return res.status(500).json({ error: '通知失敗' });
  }
}
