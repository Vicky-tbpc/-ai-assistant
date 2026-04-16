// api/health.js
export default async function handler(req, res) {
  // 從環境變數讀取密鑰與網址，這兩樣都不會暴露給前端
  const API_KEY = process.env.LOCAL_API_KEY;
  const TUNNEL_URL = process.env.LOCAL_TUNNEL_URL;

  try {
    const response = await fetch(`${TUNNEL_URL}/api/get-latest-health`, {
      headers: { 'X-API-KEY': API_KEY } // 幫前端帶上密碼
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: '無法連通地端 API' });
  }
}
