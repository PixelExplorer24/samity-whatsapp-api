const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

let waClient = null;
let latestQRImage = null;

// হোয়াটসঅ্যাপ ক্লায়েন্ট শুরু করার রুট
wppconnect.create({
    session: 'escs-session',
    folderNameToken: 'tokens', // সেশন সেভ রাখার ফোল্ডার
    autoClose: 0,
    waitForLogin: true, 
    catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
        console.log('QR Code generated! Please scan.');
        latestQRImage = base64Qr;
    },
    statusFind: (statusSession, session) => {
        console.log('Status Session: ', statusSession);
        if (statusSession === 'inChat' || statusSession === 'isLogged' || statusSession === 'successChat') {
            latestQRImage = null;
            console.log('WhatsApp session is securely connected!');
        }
    },
    headless: true,
    devtools: false,
    useChrome: true,
    debug: false,
    logQR: false, // টার্মিনালে কোড প্রিন্ট হওয়া বন্ধ করা হলো
    puppeteerOptions: {
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process', 
            '--disable-gpu'
        ]
    }
})
.then((client) => {
    waClient = client;
    latestQRImage = null;
    console.log('WhatsApp Client is Ready & Online!');
})
.catch((error) => console.log('WPPConnect Init Error:', error));

// টেস্ট রুট
app.get('/', (req, res) => {
    res.send('Ekota Sanchay Co-operative Society (ESCS) WhatsApp API is Running!');
});

// কিউআর কোড এবং পেয়ারিং কোড ইন্টারফেস
app.get('/qr', (req, res) => {
    if (latestQRImage) {
        const html = `
        <!DOCTYPE html>
        <html lang="bn">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Connect - ESCS</title>
            <style>
                body { font-family: Arial, sans-serif; text-align: center; margin-top: 40px; background-color: #f0f2f5; }
                .container { background: white; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); display: inline-block; max-width: 450px; width: 90%; }
                h2 { color: #333; font-size: 18px; }
                img { max-width: 100%; border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 20px; }
                .pairing-section { margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; }
                input { width: 90%; padding: 12px; margin-bottom: 15px; border: 1px solid #ccc; border-radius: 5px; font-size: 16px; text-align: center; }
                button { background-color: #25D366; color: white; border: none; padding: 12px 20px; font-size: 16px; font-weight: bold; border-radius: 5px; cursor: pointer; width: 100%; transition: 0.3s; }
                button:hover { background-color: #128C7E; }
                #code-display { font-size: 28px; font-weight: bold; letter-spacing: 5px; color: #075E54; margin-top: 20px; }
                .note { color: #666; font-size: 13px; margin-bottom: 15px; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>১. কিউআর কোড স্ক্যান করুন</h2>
                <img src="${latestQRImage}" alt="QR Code">
                
                <div class="pairing-section">
                    <h2>২. অথবা ৮-সংখ্যার কোড ব্যবহার করুন</h2>
                    <p class="note">আপনার হোয়াটসঅ্যাপ নম্বরটি দিন (কান্ট্রি কোড সহ, যেমন: 88017XXXXXXXX)</p>
                    <input type="text" id="phone" placeholder="88017XXXXXXXX" required>
                    <button onclick="getCode()">কোড তৈরি করুন</button>
                    <div id="code-display"></div>
                </div>
            </div>

            <script>
                async function getCode() {
                    const phone = document.getElementById('phone').value.trim();
                    const display = document.getElementById('code-display');
                    
                    if(!phone) { alert('দয়া করে ফোন নম্বর দিন!'); return; }
                    display.innerText = 'অপেক্ষা করুন...';
                    
                    try {
                        const response = await fetch('/get-pairing-code', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ phone: phone })
                        });
                        const data = await response.json();
                        if(data.status === 'success') { display.innerText = data.code; } 
                        else { display.innerText = 'এরর: ' + data.message; }
                    } catch(err) { display.innerText = 'কোড আনতে সমস্যা হয়েছে!'; }
                }
            </script>
        </body>
        </html>
        `;
        res.send(html);
    } else {
        res.send(`
            <div style="font-family: Arial; text-align: center; margin-top: 50px;">
                <h2 style="color: #25D366;">✅ WhatsApp Session is Active!</h2>
                <p style="color: #555;">আপনার অ্যাকাউন্ট সফলভাবে কানেক্টেড আছে। মোবাইল অফলাইনে থাকলেও মেসেজ ডেলিভারি হবে।</p>
            </div>
        `);
    }
});

// ৮ সংখ্যার পেয়ারিং কোড তৈরি
app.post('/get-pairing-code', async (req, res) => {
    const { phone } = req.body;
    if (!waClient) return res.status(500).json({ status: 'error', message: 'WhatsApp client is starting...' });

    try {
        const cleanPhone = phone.replace(/[^0-9]/g, ''); 
        const code = await waClient.getAuthCode(cleanPhone);
        res.json({ status: 'success', code: code });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// মেসেজ পাঠানোর নিরাপদ রুট (অটো-রিট্রাই ফিচার সহ)
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    
    if (!waClient) {
        return res.status(503).json({ status: 'error', message: 'API is currently offline or reconnecting.' });
    }

    try {
        const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        
        // রিট্রাই মেকানিজম: কোনো কারণে ফেইল হলে ৩ বার চেষ্টা করবে
        let success = false;
        let lastError = null;

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await waClient.sendText(formattedPhone, message);
                success = true;
                break; // সফল হলে লুপ থেকে বেরিয়ে যাবে
            } catch (err) {
                lastError = err;
                console.log(`Attempt ${attempt} failed. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, 2000)); // ২ সেকেন্ড অপেক্ষা করে আবার চেষ্টা করবে
            }
        }

        if (success) {
            res.json({ status: 'success', message: 'Message sent successfully!' });
        } else {
            throw lastError; // ৩ বারই ফেইল করলে মেইন catch ব্লকে পাঠাবে
        }

    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to send message after multiple attempts.', details: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
