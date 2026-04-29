// api/health.js 分筆資料
export default async function handler(req, res) {
  // Vercel 自動解析了 req.query，這部分是正確的現代寫法
  const { start, end, serial } = req.query; 
  const API_KEY = process.env.LOCAL_API_KEY;
  const TUNNEL_URL = process.env.LOCAL_TUNNEL_URL;

  try {
    // 【改善點】：改用 WHATWG URL API 構建網址，取代手動字串拼接
    const targetUrl = new URL(`${TUNNEL_URL}/api/get-latest-health`);
    
    // 使用 searchParams 安全地添加參數，這會自動處理特殊字元轉義
    if (start) targetUrl.searchParams.append('start', start);
    if (end) targetUrl.searchParams.append('end', end);
    if (serial) targetUrl.searchParams.append('serial', serial);

    // fetch 會接收 targetUrl.toString() 輸出的標準網址字串
    const response = await fetch(targetUrl.toString(), {
      headers: { 
        'X-API-KEY': API_KEY,
        'ngrok-skip-browser-warning': 'true' 
      }
    });
    
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    // 保持原本的錯誤處理邏輯[cite: 12]
    res.status(500).json({ error: '無法連通地端 API', detail: error.message });
  }
}
