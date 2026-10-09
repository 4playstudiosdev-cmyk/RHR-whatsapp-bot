# RHR WhatsApp Bot

Standalone WhatsApp sending service for RHR & Company, separate from the main backend.

## Local run

```bash
npm install
node index.js
```

Scan the QR code printed in the terminal with WhatsApp (Linked Devices). The session is saved to `./wwebjs_auth/` — no need to scan again on restart as long as that folder persists.

## API

- `GET /health` → `{ status: 'ok', whatsappReady: boolean }`
- `POST /send-whatsapp` → body `{ phone, message }`, sends via WhatsApp

## Deploy on Railway

1. Go to railway.app → New Project → Deploy from GitHub → select `RHR-whatsapp-bot`.
2. Add a Volume mounted at `/app/wwebjs_auth` so the session survives restarts/redeploys.
3. Set the `MAIN_BACKEND_URL` env variable if needed.
4. After deploy, open the service logs — the QR code will print there.
5. Scan it once with WhatsApp (Linked Devices) — the session is then saved to the volume permanently.
