// api/health.js_新增自動切換5000
console.log('目前讀取的網址清單:', process.env.LOCAL_TUNNEL_URLS);
export default async function handler(req, res) {
  const API_KEY = process.env.LOCAL_API_KEY;
  // 改為讀取多個網址的環境變數，並用逗號分割成陣列 (相容舊的 LOCAL_TUNNEL_URL)
  const TUNNEL_URLS_STR = process.env.LOCAL_TUNNEL_URLS || process.env.LOCAL_TUNNEL_URL;

  if (!TUNNEL_URLS_STR || !API_KEY) {
    return res.status(500).json({ error: 'Vercel 環境變數缺失', detail: '請設定 LOCAL_TUNNEL_URLS 或 LOCAL_API_KEY' });
  }

  // 將字串拆成陣列並去除多餘空白
  const tunnelList = TUNNEL_URLS_STR.split(',').map(url => url.trim());

  // 建立一個會自動輪詢所有 ngrok 網址的共用函數
  async function fetchFromTunnels(pathAndQuery, options) {
    let lastErrorText = "無法連線";
    let lastStatus = 500;

    for (const baseUrl of tunnelList) {
      try {
        const url = `${baseUrl}${pathAndQuery}`;
        const response = await fetch(url, options);
        
        if (response.ok) {
          return response; // 成功連線就直接回傳結果，中斷迴圈
        } else {
          // 若連通但發生錯誤 (如 400, 404)，記錄狀態繼續嘗試下一個
          lastStatus = response.status;
          lastErrorText = await response.text();
        }
      } catch (error) {
        // 完全連不上 (例如該 ngrok 沒開啟)，忽略並嘗試下一個
        console.log(`[連線失敗跳過] ${baseUrl}`);
      }
    }
    // 若迴圈跑完都沒 return，代表全部通道都失敗
    throw { status: lastStatus, message: lastErrorText };
  }

  // 2. [新增] 處理 PDF 的邏輯 (優先處理)
  if (req.method === 'GET' && req.query.action === 'pdf') {
    const { account, date } = req.query;
    if (!account || !date) return res.status(400).send('缺少必要參數');

    const pathAndQuery = `/api/pdf?account=${account}&date=${date}`;

    try {
      const response = await fetchFromTunnels(pathAndQuery, {
        headers: { 
          'X-API-KEY': API_KEY,
          'ngrok-skip-browser-warning': 'true' 
        }
      });
      
      const buffer = Buffer.from(await response.arrayBuffer());
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="report_${date}.pdf"`);
      return res.send(buffer);
    } catch (error) {
      console.error('PDF fetch error:', error);
      const errMsg = error.message || '伺服器連線錯誤';
      return res.status(error.status || 500).send(`無法取得 PDF，地端伺服器說：${errMsg}`);
    }
  }

  // 3. 一般 API 邏輯
  const { start, end, serial } = req.query; 

  try {
    // 組裝 Query Parameters
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    if (serial) params.append('serial', serial);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const pathAndQuery = `/api/get-latest-health${queryString}`;

    const response = await fetchFromTunnels(pathAndQuery, {
      headers: { 
        'X-API-KEY': API_KEY,
        'ngrok-skip-browser-warning': 'true' 
      }
    });
    
    const data = await response.json();
    return res.status(200).json(data);
    
  } catch (error) {
    return res.status(error.status || 500).json({ error: '無法連線到地端伺服器', detail: error.message });
  }
}
