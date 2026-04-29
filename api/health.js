// api/health.js 分筆資料
export default async function handler(req, res) {
  const { start, end, serial } = req.query; // 接收來自 anything_llm_api 的參數
  const API_KEY = process.env.LOCAL_API_KEY;
  const TUNNEL_URL = process.env.LOCAL_TUNNEL_URL;

  try {
    // 將參數串接到 ngrok 網址後方
    const url = `${TUNNEL_URL}/api/get-latest-health?start=${start || ''}&end=${end || ''}&serial=${serial || ''}`;
    
    const response = await fetch(url, {
      headers: { 
        'X-API-KEY': API_KEY,
        'ngrok-skip-browser-warning': 'true' 
      }
    });
    
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: '無法連通地端 API', detail: error.message });
  }
}
