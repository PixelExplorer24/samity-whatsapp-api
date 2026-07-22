const express = require('express');
const cors = require('cors');
const wppconnect = require('@wppconnect-team/wppconnect');

const app = express();

// CORS চালু করা হলো (যাতে যেকোনো লোকাল বা ক্লাউড সাইট থেকে এপিআই কল করা যায়)
app.use(cors());
app.use(express.json());

let whatsappClient = null;
let qrCodeData = null;

// WPPConnect ক্লায়েন্ট তৈরি করা হচ্ছে
wppconnect.create({
    session: 'samity-session',
    catchQR: (base64Qr, asciiQR) => {
        console.log('QR কোড তৈরি হয়েছে! দয়া করে স্ক্যান করুন।');
        qrCodeData = base64Qr; // QR কোড সেভ করে রাখা হচ্ছে ওয়েব পেজে দেখানোর জন্য
    },
    statusFind: (statusSession) => {
        console.log('সেশন স্ট্যাটাস:', statusSession);
        if (statusSession === 'isLogged' || statusSession === 'inChat') {
            qrCodeData = null; // লগইন হয়ে গেলে QR কোড মুছে ফেলা হবে
        }
    },
    headless: true,
    useChrome: false
})
.then((client) => {
    whatsappClient = client;
    console.log('✅ WhatsApp API সফলভাবে কানেক্ট হয়েছে এবং মেসেজ পাঠানোর জন্য প্রস্তুত!');
})
.catch((error) => {
    console.log('❌ WhatsApp ক্লায়েন্ট চালু হতে সমস্যা হয়েছে:', error);
});

// ১. মূল পেজ (QR কোড দেখার এবং UptimeRobot এর জন্য)
app.get('/', (req, res) => {
    if (whatsappClient) {
        res.send('<h2 style="color:green; text-align:center; margin-top:50px;">✅ API সচল আছে এবং WhatsApp কানেক্টেড!</h2>');
    } else if (qrCodeData) {
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2>১. হোয়াটসঅ্যাপ কানেক্ট করতে কিউআর কোড স্ক্যান করুন</h2>
                <img src="${qrCodeData}" alt="QR Code" style="border: 2px solid #ccc; border-radius: 10px; padding: 10px; margin-top: 20px;" />
                <p style="color: #666; margin-top: 15px;">স্ক্যান করা হয়ে গেলে পেজটি রিলোড দিন।</p>
            </div>
        `);
    } else {
        res.send('<h2 style="color:orange; text-align:center; margin-top:50px;">⏳ সার্ভার চালু হচ্ছে, অনুগ্রহ করে একটু অপেক্ষা করুন...</h2>');
    }
});

// ২. মেসেজ পাঠানোর API রাউট (POST Request)
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;

        // ভ্যালিডেশন চেক
        if (!phone || !message) {
            return res.status(400).json({ 
                success: false, 
                message: 'ফোন নম্বর এবং মেসেজ উভয়ই দিতে হবে!' 
            });
        }

        // ক্লায়েন্ট রেডি আছে কি না চেক
        if (!whatsappClient) {
            return res.status(500).json({ 
                success: false, 
                message: 'হোয়াটসঅ্যাপ এখনো কানেক্ট হয়নি! লিংকে গিয়ে আগে QR কোড স্ক্যান করুন।' 
            });
        }

        // নম্বর ফরম্যাট করা (যেমন: 88017XXXXXXXX@c.us)
        const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;

        // মেসেজ পাঠানো
        await whatsappClient.sendText(formattedPhone, message);

        res.status(200).json({ 
            success: true, 
            message: 'মেসেজ সফলভাবে পাঠানো হয়েছে!',
            recipient: phone 
        });

    } catch (error) {
        console.error('মেসেজ পাঠাতে সমস্যা হয়েছে:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// সার্ভার পোর্ট সেটআপ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 সার্ভার চালু হয়েছে ${PORT} পোর্টে`);
});
