const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app = express();
// Default express.json() limit is 100kb — too small for a base64-encoded
// PDF/image attachment (see /send-whatsapp's optional mediaBase64).
app.use(express.json({ limit: '15mb' }));

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

// POST /send-whatsapp — { phone, message } for plain text, or add
// { mediaBase64, mediaMimeType, mediaFileName } to send a document/image
// attachment instead (message becomes the caption).
app.post('/send-whatsapp', async (req, res) => {
  try {
    const { phone, message, mediaBase64, mediaMimeType, mediaFileName } = req.body;
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

    if (mediaBase64 && mediaMimeType) {
      const media = new MessageMedia(mediaMimeType, mediaBase64, mediaFileName || 'attachment');
      // client.sendMessage(id, media) throws "Data passed to getter must
      // include an id property" from inside WhatsApp Web's own JS for
      // media sends specifically — a known wwebjs/WhatsApp-Web
      // compatibility issue. Routing through the already-resolved Chat
      // object's own sendMessage avoids that internal lookup.
      const chat = await client.getChatById(numberId._serialized);
      // sendMediaAsDocument skips WhatsApp Web's inline image-preview/
      // thumbnail generation — that step throws a minified internal error
      // ("r") under this headless Chromium's canvas flags (--disable-gpu,
      // --disable-accelerated-2d-canvas) specifically for image mimetypes;
      // PDFs never hit that code path, which is why document sends (money
      // receipts) always worked while image sends (broadcast attachments)
      // didn't. Sent as a document instead — still delivers the file, just
      // without the inline photo preview.
      await chat.sendMessage(media, { sendMediaAsDocument: true });
      if (message) await chat.sendMessage(message);
      console.log('📨 WhatsApp document sent to', phone);
    } else {
      await client.sendMessage(numberId._serialized, message);
      console.log('📨 WhatsApp message sent to', phone);
    }
    return res.json({ success: true, message: 'Message sent' });
  } catch (err) {
    console.error('Send WhatsApp error:', err.message);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 RHR WhatsApp bot service listening on port ${PORT}`);
});
