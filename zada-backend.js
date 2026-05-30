const express = require('express');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(express.json());

// ── CREDENTIALS ───────────────────────────────────────────────────────────────
const CONSUMER_KEY    = 'sjeWLWNsQTlgH2nckrcgZWqGvU7sPGUnIONYn2trFghnYAo';
const CONSUMER_SECRET = 'Xppo9cbXBwpDoFW7Vn6bow2TwlKgL50r6vNIKt5wVHbKnge02Wzobfr5Y7GS52Fm';
const PASSKEY         = 'WNmAA/Ua7ynM4XPVyrYTEBdOqNJ+54LiuAh+ML3NMd19PpSjoGvbHTkJ40vZjGWa6Xqqw06MnAySQSy8Hxoz7hZVrB5Vdhj/NY+RI64e+dlglW67BEtx+hJ3BjTzc2rRhs5xWKbTqwin4ZL1krla3R3dnX1/Ra69VFp8EHVBRgrmrPjXl6q/Kd26nNxu908D3vBHzJPnlja+RxZiJ4JduwTm9pYmxxsTk2DAnYmYxnGswggcpIKsjL9pXsvftQqE3kdmdczjS5bsYVKtq7KRGC00HA75fdEY7znP4Io8sb3FWJExBb/EPIoNeJ8WY0rx6omnjCwWWaqO6qbNDBiCNQ==';

// Sandbox credentials
const SANDBOX_SHORTCODE = '174379';
const SANDBOX_BASE_URL  = 'https://sandbox.safaricom.co.ke';

// Live credentials (switch when going live)
const LIVE_SHORTCODE    = '247247';
const LIVE_BASE_URL     = 'https://api.safaricom.co.ke';

// Toggle this to false when going live
const IS_SANDBOX = true;

const BASE_URL  = IS_SANDBOX ? SANDBOX_BASE_URL : LIVE_BASE_URL;
const SHORTCODE = IS_SANDBOX ? SANDBOX_SHORTCODE : LIVE_SHORTCODE;

// Callback URL — update this with your Render URL after deploy
const CALLBACK_URL = 'https://zada-backend.onrender.com/callback';

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get access token');
  return data.access_token;
}

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getPassword(timestamp) {
  const str = `${SHORTCODE}${PASSKEY}${timestamp}`;
  return Buffer.from(str).toString('base64');
}

function formatPhone(phone) {
  // Convert 07XXXXXXXX → 2547XXXXXXXX
  phone = phone.replace(/\s/g, '').replace(/^\+/, '');
  if (phone.startsWith('07')) return '254' + phone.slice(1);
  if (phone.startsWith('01')) return '254' + phone.slice(1);
  if (phone.startsWith('254')) return phone;
  return '254' + phone;
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ZADA Backend Running', time: new Date().toISOString() });
});

// STK Push endpoint
app.post('/stk-push', async (req, res) => {
  try {
    const { phone, amount, memberId } = req.body;

    if (!phone || !amount) {
      return res.status(400).json({ success: false, message: 'Phone and amount are required' });
    }

    if (Number(amount) < 1) {
      return res.status(400).json({ success: false, message: 'Amount must be at least Ksh 1' });
    }

    const token     = await getAccessToken();
    const timestamp = getTimestamp();
    const password  = getPassword(timestamp);
    const formattedPhone = formatPhone(phone);

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      TransactionType:   'CustomerPayBillOnline',
      Amount:            Math.ceil(Number(amount)),
      PartyA:            formattedPhone,
      PartyB:            SHORTCODE,
      PhoneNumber:       formattedPhone,
      CallBackURL:       CALLBACK_URL,
      AccountReference:  memberId || '652046',
      TransactionDesc:   `ZADA Savings Deposit - ${memberId || 'Member'}`,
    };

    const response = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('STK Push Response:', JSON.stringify(data));

    if (data.ResponseCode === '0') {
      res.json({
        success:           true,
        message:           'STK Push sent successfully',
        checkoutRequestId: data.CheckoutRequestID,
        merchantRequestId: data.MerchantRequestID,
      });
    } else {
      res.status(400).json({
        success: false,
        message: data.errorMessage || data.ResponseDescription || 'STK Push failed',
      });
    }
  } catch (err) {
    console.error('STK Push Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Query STK Push status
app.post('/stk-query', async (req, res) => {
  try {
    const { checkoutRequestId } = req.body;
    if (!checkoutRequestId) {
      return res.status(400).json({ success: false, message: 'checkoutRequestId required' });
    }

    const token     = await getAccessToken();
    const timestamp = getTimestamp();
    const password  = getPassword(timestamp);

    const payload = {
      BusinessShortCode: SHORTCODE,
      Password:          password,
      Timestamp:         timestamp,
      CheckoutRequestID: checkoutRequestId,
    };

    const response = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('STK Query Response:', JSON.stringify(data));

    if (data.ResultCode === '0' || data.ResultCode === 0) {
      res.json({ success: true, status: 'completed', message: 'Payment successful' });
    } else if (data.ResultCode === '1032' || data.ResultCode === 1032) {
      res.json({ success: false, status: 'cancelled', message: 'Payment cancelled by user' });
    } else if (data.ResultCode === '1037' || data.ResultCode === 1037) {
      res.json({ success: false, status: 'timeout', message: 'Payment request timed out' });
    } else {
      res.json({ success: false, status: 'pending', message: data.ResultDesc || 'Payment pending' });
    }
  } catch (err) {
    console.error('STK Query Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Safaricom callback (receives payment confirmation from Safaricom)
app.post('/callback', (req, res) => {
  const body = req.body;
  console.log('M-Pesa Callback:', JSON.stringify(body));

  const stk = body?.Body?.stkCallback;
  if (stk) {
    const resultCode = stk.ResultCode;
    const resultDesc = stk.ResultDesc;
    const metadata   = stk.CallbackMetadata?.Item || [];
    const amount     = metadata.find(i => i.Name === 'Amount')?.Value;
    const mpesaCode  = metadata.find(i => i.Name === 'MpesaReceiptNumber')?.Value;
    const phone      = metadata.find(i => i.Name === 'PhoneNumber')?.Value;

    console.log(`Payment: Code=${resultCode}, Amount=${amount}, Receipt=${mpesaCode}, Phone=${phone}`);

    // In production: save to database here
  }

  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

// ── START SERVER ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`ZADA Backend running on port ${PORT}`));