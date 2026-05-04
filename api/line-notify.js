// api/line-notify.js
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // 只允許 POST 請求
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { serial_numbers } = req.body;
    
    if (!serial_numbers || serial_numbers.length === 0) {
      return res.status(200).json({ message: '沒有需要通知的使用者' });
    }

    // 取得環境變數
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. 從 Supabase 的 user_credentials 表撈取對應的 line_user_id
    const { data: users, error } = await supabase
      .from('user_credentials')
      .select('serial_number, line_user_id')
      .in('serial_number', serial_numbers);

    if (error) throw error;

    // 濾掉沒有綁定 line_user_id 的使用者
    const lineUserIds = users.map(u => u.line_user_id).filter(id => id); 

    if (lineUserIds.length === 0) {
      return res.status(200).json({ message: '這些使用者未綁定 LINE ID' });
    }

    // 2. 準備 3 種版本的訊息
    const messages = [
      "📊 今天的健康資訊更新囉！\n\n💡 抽空看看自己的身體狀況吧👇\nhttps://ai-assistant-eight-puce.vercel.app/",
      "📊 嗨～你的健康分析完成囉~\n\n👀 點進來看看，關心一下自己吧\nhttps://ai-assistant-eight-puce.vercel.app/",
      "📊 今日健康分析更新囉～\n\n✨ 花一點時間了解一下今天的身體狀況👇\nhttps://ai-assistant-eight-puce.vercel.app/"
    ];

    // 3. 分別發送 LINE 推播訊息 (確保每個人收到的版本都重新隨機抽一次)
    const pushPromises = lineUserIds.map(userId => {
      const randomMsg = messages[Math.floor(Math.random() * messages.length)];
      
      return fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${lineToken}`
        },
        body: JSON.stringify({
          to: userId,
          messages: [{ type: 'text', text: randomMsg }]
        })
      });
    });

    await Promise.all(pushPromises);

    return res.status(200).json({ message: '通知發送成功', notified_count: lineUserIds.length });

  } catch (error) {
    console.error('通知發送失敗:', error);
    return res.status(500).json({ error: '通知發送失敗', detail: error.message });
  }
}
