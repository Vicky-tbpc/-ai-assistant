// send-reminder_02
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
  
  const { serial_numbers } = req.body;
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.LOCAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

  try {
    // 1. 從 Supabase 取得這些序號對應的 Line ID
    const { data: users, error } = await supabase
      .from('user_credentials')
      .select('line_user_id, nickname')
      .in('serial_number', serial_numbers);

    if (error) throw error;

    // 2. 準備三種版本的訊息內容
    const getMessageText = (nickname) => {
      const versions = [
        // 版本 01
        `嗨 ${nickname}，今晚記得佩戴手環記錄睡眠 💤，明天起床後再上傳數據 📊，我會幫你建立專屬的恢復指數與發炎風險基線，讓你的健康狀態更清楚掌握！`,
        // 版本 02
        `嗨 ${nickname}～今晚別忘了戴上手環睡覺 😴，完整記錄睡眠狀況。明天醒來後記得上傳資料 📈，我會替你建立個人化的恢復指數與發炎風險基準，陪你更精準掌握每天的身體變化！`,
        // 版本 03
        `嘿 ${nickname}，今晚睡前記得配戴手環 💤，把你的睡眠數據好好記錄下來！明早起床後上傳資料 📊，我會依據你的狀態建立專屬恢復與發炎風險基線，幫助你更了解自己的健康趨勢與恢復表現。`
      ];
      // 隨機擇一發送 (0, 1, 2)
      return versions[Math.floor(Math.random() * versions.length)];
    };

    // 3. 呼叫 LINE Messaging API 發送訊息
    const messages = users.map(user => ({
      to: user.line_user_id,
      messages: [{
        type: 'text',
        text: getMessageText(user.nickname) // 呼叫隨機選取邏輯
      }]
    }));

    // 逐一發送 (若人數極多，建議改用 Multicast API)
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
