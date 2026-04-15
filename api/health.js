// api/health.js
export default async function handler(req, res) {
  // 你的地端隧道網址 (存放在 Vercel 的 Environment Variables 裡更安全)
  const TUNNEL_URL = process.env.MY_LOCAL_TUNNEL_URL; 
  
  try {
    const response = await fetch(`${TUNNEL_URL}/api/get-latest-health`);
    const data = await response.json();
    res.status(200).json(data);
  } catch (error) {
    res.status(500).json({ error: '無法連接到地端資料庫' });
  }
}