// api/health.js 修正版
export default async function handler(req, res) {
  const API_KEY = process.env.LOCAL_API_KEY;
  const TUNNEL_URL = process.env.LOCAL_TUNNEL_URL;

  try {
    const response = await fetch(`${TUNNEL_URL}/api/get-latest-health`, {
      headers: { 
        'X-API-KEY': API_KEY,
        // --- 下面這一行一定要加，專門給 ngrok 用的 ---
        'ngrok-skip-browser-warning': 'true' 
      }
    });
    
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: '無法連通地端 API', detail: error.message });
  }
}
