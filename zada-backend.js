const express = require('express');
const cors    = require('cors');
const app     = express();
app.use(cors());
app.use(express.json());

// ── CREDENTIALS ───────────────────────────────────────────────────────────────
const CONSUMER_KEY    = 'sjeWLWNsQTlgH2nckrcgZWqGvU7sPGUnIONYn2trFghnYAo';
const CONSUMER_SECRET = 'Xppo9cbXBwpDoFW7Vn6bow2TwlKgL50r6vNIKt5wVHbKnge02Wzobfr5Y7GS52Fm';
const PASSKEY         = 'WNmAA/Ua7ynM4XPVyrYTEBdOqNJ+54LiuAh+ML3NMd19PpSjoGvbHTkJ40vZjGWa6Xqqw06MnAySQSy8Hxoz7hZVrB5Vdhj/NY+RI64e+dlglW67BEtx+hJ3BjTzc2rRhs5xWKbTqwin4ZL1krla3R3dnX1/Ra69VFp8EHVBRgrmrPjXl6q/Kd26nNxu908D3vBHzJPnlja+RxZiJ4JduwTm9pYmxxsTk2DAnYmYxnGswggcpIKsjL9pXsvftQqE3kdmdczjS5bsYVKtq7KRGC00HA75fdEY7znP4Io8sb3FWJExBb/EPIoNeJ8WY0rx6omnjCwWWaqO6qbNDBiCNQ==';
const AT_API_KEY      = 'atsk_ec77aef0fedf47475dbb618ae2992e654b6497ae356816290461268360c65ca2c8678625';
const AT_USERNAME     = 'sandbox'; // change to your real AT username when going live

// Sandbox = true for testing, false for live
const IS_SANDBOX    = true;
const SHORTCODE     = IS_SANDBOX ? '174379'              : '247247';
const BASE_URL      = IS_SANDBOX ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
const AT_BASE_URL   = IS_SANDBOX ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
const CALLBACK_URL  = 'https://zada-backend.onrender.com/callback';

// In-memory OTP store (use Redis/DB in production)
const otpStore = {};

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res  = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` }
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Failed to get M-Pesa token');
  return data.access_token;
}

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getPassword(timestamp) {
  return Buffer.from(`${SHORTCODE}${PASSKEY}${timestamp}`).toString('base64');
}

function formatPhone(phone) {
  phone = phone.replace(/\s/g,'').replace(/^\+/,'');
  if (phone.startsWith('07') || phone.startsWith('01')) return '254' + phone.slice(1);
  if (phone.startsWith('254')) return phone;
  return '254' + phone;
}

function generateOTP() {
  return Math.floor(100000 + Math.random()*900000).toString();
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({
    status:  'ZADA Backend Running ✅',
    version: '2.0.0',
    time:    new Date().toISOString(),
    sandbox: IS_SANDBOX,
  });
});

// ── SEND OTP via Africa's Talking SMS ─────────────────────────────────────────
app.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ success:false, message:'Phone required' });

    const formatted = formatPhone(phone);
    const otp       = generateOTP();
    const expires   = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store OTP
    otpStore[formatted] = { otp, expires };

    // Send SMS via Africa's Talking
    const message = `Your ZADA verification code is: ${otp}\n\nValid for 10 minutes.\nDo not share this code.\n\n- Psalms Christian Ministry`;

    const params = new URLSearchParams({
      username: AT_USERNAME,
      to:       '+' + formatted,
      message,
      from:     'ZADA',
    });

    const atRes = await fetch(`${AT_BASE_URL}/version1/messaging`, {
      method:  'POST',
      headers: {
        apiKey:         AT_API_KEY,
        Accept:         'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const atData = await atRes.json();
    console.log('AT SMS Response:', JSON.stringify(atData));

    const recipients = atData?.SMSMessageData?.Recipients || [];
    const sent       = recipients.find(r => r.status === 'Success' || r.statusCode === 101);

    if (sent || IS_SANDBOX) {
      console.log(`OTP ${otp} sent to ${formatted}`);
      res.json({
        success: true,
        message: `Verification code sent to ${phone}`,
        // Remove dev field in production!
        ...(IS_SANDBOX && { dev_otp: otp }),
      });
    } else {
      throw new Error(atData?.SMSMessageData?.Message || 'SMS send failed');
    }
  } catch (err) {
    console.error('Send OTP Error:', err);
    res.status(500).json({ success:false, message: err.message });
  }
});

// ── VERIFY OTP ────────────────────────────────────────────────────────────────
app.post('/verify-otp', (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) return res.status(400).json({ success:false, message:'Phone and OTP required' });

    const formatted = formatPhone(phone);
    const record    = otpStore[formatted];

    if (!record) {
      return res.status(400).json({ success:false, message:'No OTP found. Request a new code.' });
    }
    if (Date.now() > record.expires) {
      delete otpStore[formatted];
      return res.status(400).json({ success:false, message:'Code expired. Request a new one.' });
    }
    if (record.otp !== otp) {
      return res.status(400).json({ success:false, message:'Incorrect code. Try again.' });
    }

    // OTP valid — clear it
    delete otpStore[formatted];
    res.json({ success:true, message:'Phone verified successfully' });
  } catch (err) {
    res.status(500).json({ success:false, message: err.message });
  }
});

// ── STK PUSH ──────────────────────────────────────────────────────────────────
app.post('/stk-push', async (req, res) => {
  try {
    const { phone, amount, memberId } = req.body;
    if (!phone || !amount) {
      return res.status(400).json({ success:false, message:'Phone and amount required' });
    }
    if (Number(amount) < 1) {
      return res.status(400).json({ success:false, message:'Amount must be at least Ksh 1' });
    }

    const token          = await getAccessToken();
    const timestamp      = getTimestamp();
    const password       = getPassword(timestamp);
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
      TransactionDesc:   `ZADA Savings - ${memberId || 'Member'}`,
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
    console.log('STK Push:', JSON.stringify(data));

    if (data.ResponseCode === '0') {
      res.json({
        success:           true,
        message:           'STK Push sent',
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
    res.status(500).json({ success:false, message: err.message });
  }
});

// ── STK QUERY ─────────────────────────────────────────────────────────────────
app.post('/stk-query', async (req, res) => {
  try {
    const { checkoutRequestId } = req.body;
    if (!checkoutRequestId) {
      return res.status(400).json({ success:false, message:'checkoutRequestId required' });
    }

    const token     = await getAccessToken();
    const timestamp = getTimestamp();
    const password  = getPassword(timestamp);

    const response = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: SHORTCODE,
        Password:          password,
        Timestamp:         timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });

    const data = await response.json();
    console.log('STK Query:', JSON.stringify(data));

    const code = String(data.ResultCode);
    if (code === '0')    return res.json({ success:true,  status:'completed', message:'Payment successful' });
    if (code === '1032') return res.json({ success:false, status:'cancelled', message:'Cancelled by user' });
    if (code === '1037') return res.json({ success:false, status:'timeout',   message:'Request timed out' });
    res.json({ success:false, status:'pending', message: data.ResultDesc || 'Pending' });
  } catch (err) {
    console.error('STK Query Error:', err);
    res.status(500).json({ success:false, message: err.message });
  }
});

// ── M-PESA CALLBACK ───────────────────────────────────────────────────────────
app.post('/callback', (req, res) => {
  const stk = req.body?.Body?.stkCallback;
  if (stk) {
    const items     = stk.CallbackMetadata?.Item || [];
    const amount    = items.find(i=>i.Name==='Amount')?.Value;
    const receipt   = items.find(i=>i.Name==='MpesaReceiptNumber')?.Value;
    const phone     = items.find(i=>i.Name==='PhoneNumber')?.Value;
    console.log(`💰 Payment: Ksh${amount} | Receipt: ${receipt} | Phone: ${phone} | Code: ${stk.ResultCode}`);
    // TODO: save to database
  }
  res.json({ ResultCode:0, ResultDesc:'Accepted' });
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ZADA Backend v2.0 running on port ${PORT}`);
  console.log(`Mode: ${IS_SANDBOX ? 'SANDBOX' : 'LIVE'}`);
});
