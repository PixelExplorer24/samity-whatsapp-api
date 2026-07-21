const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

let waClient = null;
let latestQRImage = null; // ব্রাউজারে দেখানোর জন্য কিউআর কোড ইমেজ সেভ রাখার ভ্যারিয়েবল

// হোয়াটসঅ্যাপ ক্লায়েন্ট শুরু করার রুট
wppconnect.create({
    session: 'samity-session',
    catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
        console.log('QR Code generated! Please scan.');
        // base64Qr ডেটা সরাসরি ইমেজ তৈরির জন্য সেভ করে রাখা হলো
        latestQRImage = base64Qr;
    },
    statusFind: (statusSession, session) => {
        console.log('Status Session: ', statusSession);
        // স্ক্যান সফল হলে কিউআর কোড ভ্যারিয়েবলটি ক্লিয়ার করে দেওয়া
        if (statusSession === 'inChat' || statusSession === 'success') {
            latestQRImage = null;
        }
    },
    headless: true,
    devtools: false,
    useChrome: true,
    debug: false,
    logQR: true, // চাইলে টার্মিনালের প্রিন্ট বন্ধ করতে এখানে false করে দিতে পারেন
    // Render বা Linux সার্ভারে রান করার জন্য এই অংশটুকু অত্যন্ত জরুরি
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
    console.log('WhatsApp Client is Ready!');
})
.catch((error) => console.log(error));

// টেস্ট রুট
app.get('/', (req, res) => {
    res.send('Samity WhatsApp API Server is Running!');
});

// ব্রাউজারে পরিষ্কার কিউআর কোড দেখার রুট (যেমন: your-app.onrender.com/qr)
app.get('/qr', (req, res) => {
    if (latestQRImage) {
        const matches = latestQRImage.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            const imgBuffer = Buffer.from(matches[2], 'base64');
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': imgBuffer.length
            });
            res.end(imgBuffer);
        } else {
            res.send('Invalid QR data format.');
        }
    } else {
        res.send('<h2>QR Code is not ready yet, already scanned, or session is active!</h2>');
    }
});

// মেসেজ পাঠানোর API Endpoint
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    
    if (!waClient) {
        return res.status(500).json({ status: 'error', message: 'WhatsApp client is not ready yet.' });
    }

    try {
        // নম্বর ফরম্যাট ঠিক করা (যেমন: 88017XXXXXXXX@c.us)
        const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        await waClient.sendText(formattedPhone, message);
        res.json({ status: 'success', message: 'Message sent successfully!' });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
