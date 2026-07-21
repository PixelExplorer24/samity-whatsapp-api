const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

let waClient = null;

// হোয়াটসঅ্যাপ ক্লায়েন্ট শুরু করার রুট
wppconnect.create({
    session: 'samity-session',
    catchQR: (base64Qr, asciiQR, attempts, urlCode) => {
        console.log('QR Code generated! Please scan.');
    },
    statusFind: (statusSession, session) => {
        console.log('Status Session: ', statusSession);
    },
    headless: true,
    devtools: false,
    useChrome: true,
    debug: false,
    logQR: true,
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
    console.log('WhatsApp Client is Ready!');
})
.catch((error) => console.log(error));

// টেস্ট রুট
app.get('/', (req, res) => {
    res.send('Samity WhatsApp API Server is Running!');
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
