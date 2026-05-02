// api/health.js
export default async function handler(req, res) {
  const { start, end, serial } = req.query; 
  const API_KEY = process.env.LOCAL_API_KEY;
  const TUNNEL_URL = process.env.LOCAL_TUNNEL_URL;

  // 先檢查環境變數是否讀取得到
  if (!TUNNEL_URL || !API_KEY) {
    return res.status(500).json({ error: 'Vercel 環境變數缺失', detail: '請檢查 LOCAL_TUNNEL_URL 或 LOCAL_API_KEY' });
  }

  try {
    const targetUrl = new URL(`${TUNNEL_URL}/api/get-latest-health`);
    
    if (start) targetUrl.searchParams.append('start', start);
    if (end) targetUrl.searchParams.append('end', end);
    if (serial) targetUrl.searchParams.append('serial', serial);

    const response = await fetch(targetUrl.toString(), {
      headers: { 
        'X-API-KEY': API_KEY,
        'ngrok-skip-browser-warning': 'true' 
      }
    });
    
    // 【新增檢查】：如果地端 Python 回報錯誤（如 401、404），把詳細原因傳回雲端
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: '地端 API 回傳錯誤', detail: errorText });
    }

    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: '無法連通地端 API', detail: error.message });
  }
}
