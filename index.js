const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;

let isReady = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './wwebjs_auth' }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
    ],
  },
});

client.on('qr', (qr) => {
  console.log('📱 Scan this QR code with WhatsApp (Linked Devices):');
  qrcodeTerminal.generate(qr, { small: true });
  console.log('RAW_QR:' + qr);
});

client.on('ready', () => {
  isReady = true;
  console.log('✅ WhatsApp bot is ready to send messages!');
});

client.on('authenticated', () => {
  console.log('🔐 WhatsApp authenticated — session saved to ./wwebjs_auth');
});

client.on('auth_failure', (msg) => {
  console.error('❌ WhatsApp auth failed:', msg);
});

client.on('disconnected', (reason) => {
  isReady = false;
  console.log('⚠️ WhatsApp disconnected:', reason);
});

client.initialize();

// GET /health
app.get('/health', (req, res) => {
  res.json({ status: 'ok', whatsappReady: isReady });
});

// POST /send-whatsapp — { phone, message }
app.post('/send-whatsapp', async (req, res) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'phone and message are required' });
    }
    if (!isReady) {
      return res.status(503).json({ success: false, message: 'WhatsApp client is not ready yet' });
    }

    let formatted = phone.replace(/\D/g, '');
    if (formatted.startsWith('0')) formatted = '92' + formatted.slice(1);

    const numberId = await client.getNumberId(formatted);
    if (!numberId) {
      return res.status(404).json({ success: false, message: `${phone} is not registered on WhatsApp` });
    }

    await client.sendMessage(numberId._serialized, message);
    console.log('📨 WhatsApp message sent to', phone);
    return res.json({ success: true, message: 'Message sent' });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 RHR WhatsApp bot service listening on port ${PORT}`);
});
