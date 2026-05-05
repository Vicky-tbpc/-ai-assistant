import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  
  const { serial_numbers } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.LOCAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // 1. 從 Supabase 取得這些序號對應的 Line ID[cite: 1]
    const { data: users, error } = await supabase
      .from('user_credentials')
      .select('line_user_id, nickname')
      .in('serial_number', serial_numbers);

    if (error) throw error;

    // 2. 呼叫 LINE Messaging API 發送訊息
    const messages = users.map(user => ({
      to: user.line_user_id,
      messages: [{
        type: 'text',
        text: `嗨 ${user.nickname}，今晚記得佩戴手環記錄睡眠 💤，明天起床後再上傳數據 📊，我會幫你建立專屬的恢復指數與發炎風險基線，讓你的健康狀態更清楚掌握！`
      }]
    }));

    // 這裡建議使用 LINE 的 Multicast API 一次發送多位，或跑迴圈發送
    for (const msg of messages) {
      await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
        },
        body: JSON.stringify(msg)
      });
    }

    res.status(200).json({ success: true, count: users.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
