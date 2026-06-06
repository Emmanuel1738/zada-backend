const express = require('express');
const cors    = require('cors');
const app     = express();
app.use(cors());
app.use(express.json());

const CONSUMER_KEY    = 'sjeWLWNsQTlgH2nckrcgZWqGvU7sPGUnIONYn2trFghnYAo';
const CONSUMER_SECRET = 'Xppo9cbXBwpDoFW7Vn6bow2TwlKgL50r6vNIKt5wVHbKnge02Wzobfr5Y7GS52Fm';
const PASSKEY         = 'WNmAA/Ua7ynM4XPVyrYTEBdOqNJ+54LiuAh+ML3NMd19PpSjoGvbHTkJ40vZjGWa6Xqqw06MnAySQSy8Hxoz7hZVrB5Vdhj/NY+RI64e+dlglW67BEtx+hJ3BjTzc2rRhs5xWKbTqwin4ZL1krla3R3dnX1/Ra69VFp8EHVBRgrmrPjXl6q/Kd26nNxu908D3vBHzJPnlja+RxZiJ4JduwTm9pYmxxsTk2DAnYmYxnGswggcpIKsjL9pXsvftQqE3kdmdczjS5bsYVKtq7KRGC00HA75fdEY7znP4Io8sb3FWJExBb/EPIoNeJ8WY0rx6omnjCwWWaqO6qbNDBiCNQ==';
const AT_API_KEY      = 'atsk_ec77aef0fedf47475dbb618ae2992e654b6497ae356816290461268360c65ca2c8678625';
const AT_USERNAME     = 'sandbox';

const IS_SANDBOX   = true;
const SHORTCODE    = IS_SANDBOX ? '174379' : '247247';
const BASE_URL     = IS_SANDBOX ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
const AT_BASE_URL  = IS_SANDBOX ? 'https://api.sandbox.africastalking.com' : 'https://api.africastalking.com';
const CALLBACK_URL = 'https://zada-backend.onrender.com/callback';

const otpStore = {};

async function getAccessToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64');
  const res  = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, { headers:{ Authorization:`Basic ${auth}` } });
  const data = await res.json();
  if(!data.access_token) throw new Error('Failed to get token');
  return data.access_token;
}

function getTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  return `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function getPassword(ts) {
  return Buffer.from(`${SHORTCODE}${PASSKEY}${ts}`).toString('base64');
}

function formatPhone(phone) {
  phone = phone.replace(/\s/g,'').replace(/^\+/,'');
  if(phone.startsWith('07')||phone.startsWith('01')) return '254'+phone.slice(1);
  if(phone.startsWith('254')) return phone;
  return '254'+phone;
}

app.get('/', (req,res) => res.json({ status:'ZADA Backend ✅', version:'2.0', sandbox:IS_SANDBOX }));

app.post('/send-otp', async (req,res) => {
  try {
    const { phone } = req.body;
    if(!phone) return res.status(400).json({ success:false, message:'Phone required' });
    const formatted = formatPhone(phone);
    const otp       = Math.floor(100000+Math.random()*900000).toString();
    otpStore[formatted] = { otp, expires: Date.now()+10*60*1000 };
    const message = `Your ZADA verification code is: ${otp}\nValid 10 minutes. Do not share.\n- Psalms Christian Ministry`;
    const params  = new URLSearchParams({ username:AT_USERNAME, to:'+'+formatted, message, from:'ZADA' });
    const atRes   = await fetch(`${AT_BASE_URL}/version1/messaging`, {
      method:'POST',
      headers:{ apiKey:AT_API_KEY, Accept:'application/json', 'Content-Type':'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const atData = await atRes.json();
    console.log('AT SMS:', JSON.stringify(atData));
    res.json({ success:true, message:`Code sent to ${phone}`, ...(IS_SANDBOX && { dev_otp:otp }) });
  } catch(err) {
    console.error('OTP Error:', err);
    res.status(500).json({ success:false, message:err.message });
  }
});

app.post('/verify-otp', (req,res) => {
  try {
    const { phone, otp } = req.body;
    if(!phone||!otp) return res.status(400).json({ success:false, message:'Phone and OTP required' });
    const formatted = formatPhone(phone);
    const record    = otpStore[formatted];
    if(!record)              return res.status(400).json({ success:false, message:'No OTP found. Request a new code.' });
    if(Date.now()>record.expires){ delete otpStore[formatted]; return res.status(400).json({ success:false, message:'Code expired. Request a new one.' }); }
    if(record.otp!==otp)     return res.status(400).json({ success:false, message:'Incorrect code. Try again.' });
    delete otpStore[formatted];
    res.json({ success:true, message:'Verified successfully' });
  } catch(err) {
    res.status(500).json({ success:false, message:err.message });
  }
});

app.post('/stk-push', async (req,res) => {
  try {
    const { phone, amount, memberId } = req.body;
    if(!phone||!amount) return res.status(400).json({ success:false, message:'Phone and amount required' });
    const token     = await getAccessToken();
    const ts        = getTimestamp();
    const formatted = formatPhone(phone);
    const payload   = {
      BusinessShortCode: SHORTCODE, Password: getPassword(ts), Timestamp: ts,
      TransactionType: 'CustomerPayBillOnline', Amount: Math.ceil(Number(amount)),
      PartyA: formatted, PartyB: SHORTCODE, PhoneNumber: formatted,
      CallBackURL: CALLBACK_URL, AccountReference: memberId||'652046',
      TransactionDesc: `ZADA Savings - ${memberId||'Member'}`,
    };
    const response = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    console.log('STK Push:', JSON.stringify(data));
    if(data.ResponseCode==='0') res.json({ success:true, message:'STK Push sent', checkoutRequestId:data.CheckoutRequestID, merchantRequestId:data.MerchantRequestID });
    else res.status(400).json({ success:false, message:data.errorMessage||data.ResponseDescription||'STK Push failed' });
  } catch(err) {
    console.error('STK Error:', err);
    res.status(500).json({ success:false, message:err.message });
  }
});

app.post('/stk-query', async (req,res) => {
  try {
    const { checkoutRequestId } = req.body;
    if(!checkoutRequestId) return res.status(400).json({ success:false, message:'checkoutRequestId required' });
    const token = await getAccessToken();
    const ts    = getTimestamp();
    const response = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
      method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ BusinessShortCode:SHORTCODE, Password:getPassword(ts), Timestamp:ts, CheckoutRequestID:checkoutRequestId }),
    });
    const data = await response.json();
    console.log('STK Query:', JSON.stringify(data));
    const code = String(data.ResultCode);
    if(code==='0')    return res.json({ success:true,  status:'completed', message:'Payment successful' });
    if(code==='1032') return res.json({ success:false, status:'cancelled', message:'Cancelled by user' });
    if(code==='1037') return res.json({ success:false, status:'timeout',   message:'Request timed out' });
    res.json({ success:false, status:'pending', message:data.ResultDesc||'Pending' });
  } catch(err) {
    console.error('Query Error:', err);
    res.status(500).json({ success:false, message:err.message });
  }
});

app.post('/callback', (req,res) => {
  const stk = req.body?.Body?.stkCallback;
  if(stk) {
    const items   = stk.CallbackMetadata?.Item||[];
    const amount  = items.find(i=>i.Name==='Amount')?.Value;
    const receipt = items.find(i=>i.Name==='MpesaReceiptNumber')?.Value;
    const phone   = items.find(i=>i.Name==='PhoneNumber')?.Value;
    console.log(`💰 Ksh${amount} | Receipt:${receipt} | Phone:${phone} | Code:${stk.ResultCode}`);
  }
  res.json({ ResultCode:0, ResultDesc:'Accepted' });
});

const PORT = process.env.PORT||3000;
app.listen(PORT, ()=>{ console.log(`ZADA Backend v2.0 on port ${PORT} | Sandbox:${IS_SANDBOX}`); });
