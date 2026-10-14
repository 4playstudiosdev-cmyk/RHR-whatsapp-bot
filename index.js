const fs = require('fs');
const express = require('express');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

// Replaces whatsapp-web.js (which drives a real headless Chromium tab
// simulating WhatsApp Web in the browser) — that media-send path
// reliably crashed with a minified internal error ("r") in this
// environment, for every attachment (image or PDF alike), while plain
// text always worked fine. Baileys talks to WhatsApp's own multi-device
// protocol directly over a WebSocket, no browser involved, so that
// whole class of browser-side crash doesn't exist here.
const app = express();
// Default express.json() limit is 100kb — too small for a base64-encoded
// PDF/image attachment (see /send-whatsapp's optional mediaBase64).
app.use(express.json({ limit: '15mb' }));

const PORT = process.env.PORT || 3001;
// Reuses the existing Railway volume mount (RAILWAY_VOLUME_MOUNT_PATH=
// /app/wwebjs_auth) so the persistent session survives restarts without
// any Railway volume reconfiguration — the directory name is a leftover
// from whatsapp-web.js, but Baileys writes its own file format into it
// just the same.
const AUTH_DIR = './wwebjs_auth';

// One-time escape hatch for a stuck/corrupted session — set
// CLEAR_WHATSAPP_SESSION=true in Railway variables, redeploy once, then
// unset it. The next boot wipes the saved session and shows a fresh QR
// code in these logs to re-link the phone.
if (process.env.CLEAR_WHATSAPP_SESSION === 'true') {
  try {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    console.log('🧹 Cleared saved session — will show a fresh QR code to re-link.');
  } catch (e) {
    console.error('Failed to clear session:', e.message);
  }
}

let sock;
let isReady = false;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📱 Scan this QR code with WhatsApp (Linked Devices):');
      qrcodeTerminal.generate(qr, { small: true });
      console.log('RAW_QR:' + qr);
    }

    if (connection === 'open') {
      isReady = true;
      console.log('✅ WhatsApp bot is ready to send messages!');
    }

    if (connection === 'close') {
      isReady = false;
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      console.log('⚠️ WhatsApp disconnected:', statusCode, loggedOut ? '(logged out — needs a fresh QR scan)' : '(reconnecting)');
      // Baileys' socket closes on every transient network blip, not just
      // a real logout — reconnect automatically unless the user actually
      // unlinked the device from their phone.
      if (!loggedOut) {
        startSock();
      }
    }
  });
}

startSock().catch((err) => console.error('Failed to start WhatsApp socket:', err.message));

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

    const [result] = await sock.onWhatsApp(formatted);
    if (!result?.exists) {
      return res.status(404).json({ success: false, message: `${phone} is not registered on WhatsApp` });
    }
    const jid = result.jid;

    if (mediaBase64 && mediaMimeType) {
      const buffer = Buffer.from(mediaBase64, 'base64');
      const isImage = mediaMimeType.startsWith('image/');
      const content = isImage
        ? { image: buffer, mimetype: mediaMimeType, caption: message || '' }
        : { document: buffer, mimetype: mediaMimeType, fileName: mediaFileName || 'attachment', caption: message || '' };
      await sock.sendMessage(jid, content);
      console.log('📨 WhatsApp attachment sent to', phone);
    } else {
      await sock.sendMessage(jid, { text: message });
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
