// api/health.js_新增讀取睡眠報告
export default async function handler(req, res) {
  const API_KEY = process.env.LOCAL_API_KEY;
  const TUNNEL_URL = process.env.LOCAL_TUNNEL_URL;

  // 2. [新增] 處理 PDF 的邏輯 (優先處理)
  if (req.method === 'GET' && req.query.action === 'pdf') {
    const { account, date } = req.query;
    if (!account || !date) return res.status(400).send('缺少必要參數');

    // 修正：將 NGROK_URL 改為 TUNNEL_URL
    const localPdfUrl = `${TUNNEL_URL}/api/pdf?account=${account}&date=${date}`;

    try {
      const response = await fetch(localPdfUrl, {
        headers: { 
          'X-API-KEY': API_KEY,
          'ngrok-skip-browser-warning': 'true' // 確保 ngrok 不會跳出警告頁面擋住 fetch
        }
      });
      if (!response.ok) return res.status(response.status).send('無法取得 PDF');
      
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="report_${date}.pdf"`);
      return res.send(buffer);
    } catch (error) {
      console.error('PDF fetch error:', error);
      return res.status(500).send('伺服器連線錯誤');
    }
  }

  // 先檢查環境變數是否讀取得到
  const { start, end, serial } = req.query; 
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
    
    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: '地端伺服器錯誤', detail: errorText });
    }
    
    const data = await response.json();
    return res.status(200).json(data);
    
  } catch (error) {
    return res.status(500).json({ error: '無法連線到地端伺服器', detail: error.message });
  }
}
