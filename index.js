const express = require('express');
const cors = require('cors');
const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = 'mongodb+srv://samityAdmin:samity123@cluster0.rnh0xw2.mongodb.net/?appName=Cluster0';[cite: 2]
const DB_NAME = 'whatsapp_api';[cite: 2]
const COLLECTION_NAME = 'sessions';[cite: 2]
const SESSION_NAME = 'samity-session';[cite: 2]
const TOKEN_DIR = path.join(__dirname, 'tokens', SESSION_NAME);[cite: 2]

let whatsappClient = null;
let qrCodeData = null;
let clientStatus = 'Initializing...';[cite: 2]

async function restoreSessionFromMongo() {
    console.log('⏳ MongoDB থেকে সেশন খোঁজা হচ্ছে...');[cite: 2]
    const client = new MongoClient(MONGO_URI);[cite: 2]
    try {
        await client.connect();[cite: 2]
        const db = client.db(DB_NAME);[cite: 2]
        const sessionData = await db.collection(COLLECTION_NAME).findOne({ sessionName: SESSION_NAME });[cite: 2]
        
        if (sessionData && sessionData.zipBuffer) {
            const zipPath = path.join(__dirname, 'temp_session.zip');[cite: 2]
            fs.writeFileSync(zipPath, sessionData.zipBuffer.buffer);[cite: 2]
            
            const zip = new AdmZip(zipPath);[cite: 2]
            zip.extractAllTo(TOKEN_DIR, true);[cite: 2]
            console.log('✅ MongoDB থেকে সেশন সফলভাবে রিস্টোর করা হয়েছে!');[cite: 2]
            fs.unlinkSync(zipPath);[cite: 2]
        } else {
            console.log('⚠️ ডাটাবেসে আগের কোনো সেশন পাওয়া যায়নি। নতুন করে QR কোড স্ক্যান করতে হবে।');[cite: 2]
        }
    } catch (error) {
        console.error('❌ সেশন রিস্টোর করতে সমস্যা:', error.message);[cite: 2]
    } finally {
        await client.close();[cite: 2]
    }
}

async function backupSessionToMongo() {
    if (!fs.existsSync(TOKEN_DIR)) return;[cite: 2]
    console.log('⏳ MongoDB তে সেশন ব্যাকআপ নেওয়া হচ্ছে...');[cite: 2]
    const client = new MongoClient(MONGO_URI);[cite: 2]
    try {
        const zip = new AdmZip();[cite: 2]
        zip.addLocalFolder(TOKEN_DIR);[cite: 2]
        const zipBuffer = zip.toBuffer();[cite: 2]

        await client.connect();[cite: 2]
        const db = client.db(DB_NAME);[cite: 2]
        
        await db.collection(COLLECTION_NAME).updateOne(
            { sessionName: SESSION_NAME },
            { $set: { zipBuffer: zipBuffer, updatedAt: new Date() } },
            { upsert: true }
        );
        console.log('✅ সেশন সফলভাবে MongoDB তে সুরক্ষিত করা হয়েছে!');[cite: 2]
    } catch (error) {
        console.error('❌ সেশন ব্যাকআপ করতে সমস্যা:', error.message);[cite: 2]
    } finally {
        await client.close();[cite: 2]
    }
}

async function startSystem() {
    await restoreSessionFromMongo();[cite: 2]

    wppconnect.create({
        session: SESSION_NAME,[cite: 2]
        autoClose: 0,[cite: 2]
        catchQR: (base64Qr, asciiQR) => {
            console.log('QR কোড তৈরি হয়েছে! দয়া করে স্ক্যান করুন।');[cite: 2]
            qrCodeData = base64Qr;[cite: 2]
            clientStatus = 'QR Code Received. Please scan.';
        },
        statusFind: async (statusSession) => {
            console.log('সেশন স্ট্যাটাস:', statusSession);[cite: 2]
            clientStatus = `Session Status: ${statusSession}`;
            if (statusSession === 'isLogged' || statusSession === 'inChat') {
                qrCodeData = null;[cite: 2]
                clientStatus = 'Connected & Ready!';
                await backupSessionToMongo();[cite: 2]
            }
        },
        headless: true,[cite: 2]
        useChrome: false,[cite: 2]
        puppeteerOptions: {
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    })
    .then((client) => {
        whatsappClient = client;[cite: 2]
        console.log('✅ WhatsApp API কানেক্টেড এবং মেসেজ পাঠানোর জন্য প্রস্তুত!');[cite: 2]
        clientStatus = 'Connected & Ready!';
    })
    .catch((error) => {
        console.log('❌ WhatsApp ক্লায়েন্ট চালু হতে সমস্যা:', error);[cite: 2]
        clientStatus = `Error: ${error.message}`;
    });
}

// মূল হোম পেজ (সরাসরি কিউআর কোড বা স্ট্যাটাস দেখানোর জন্য)
app.get('/', (req, res) => {
    if (whatsappClient) {
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2 style="color:green;">✅ API সচল আছে এবং WhatsApp কানেক্টেড!</h2>
                <p>Status: <b>${clientStatus}</b></p>
            </div>
        `);
    } else if (qrCodeData) {
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2>১. হোয়াটসঅ্যাপ কানেক্ট করতে কিউআর কোড স্ক্যান করুন</h2>
                <img src="${qrCodeData}" alt="QR Code" style="border: 2px solid #ccc; border-radius: 10px; padding: 10px; margin-top: 20px; width: 280px; height: 280px;" />
                <p style="color: #666; margin-top: 15px;">স্ট্যাটাস: <b>${clientStatus}</b></p>
                <p style="color: #888; font-size: 14px;"><i>স্ক্যান করা হয়ে গেলে পেজটি নিজে থেকেই আপডেট হয়ে যাবে...</i></p>
                <script>
                    setTimeout(() => { window.location.reload(); }, 5000);
                </script>
            </div>
        `);
    } else {
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2 style="color:orange;">⏳ সার্ভার চালু হচ্ছে এবং কিউআর কোড লোড হচ্ছে...</h2>
                <p>স্ট্যাটাস: <b>${clientStatus}</b></p>
                <script>
                    setTimeout(() => { window.location.reload(); }, 4000);
                </script>
            </div>
        `);
    }
});

// আলাদাভাবে /qr পেজ হিসেবে দেখতে চাইলে
app.get('/qr', (req, res) => {
    res.redirect('/');
});

app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;[cite: 2]

        if (!phone || !message) {
            return res.status(400).json({ success: false, message: 'ফোন নম্বর এবং মেসেজ উভয়ই দিতে হবে!' });[cite: 2]
        }

        if (!whatsappClient) {
            return res.status(500).json({ success: false, message: 'হোয়াটসঅ্যাপ এখনো কানেক্ট হয়নি! লিংকে গিয়ে QR কোড স্ক্যান করুন।' });[cite: 2]
        }

        const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;[cite: 2]
        await whatsappClient.sendText(formattedPhone, message);[cite: 2]

        res.status(200).json({ success: true, message: 'মেসেজ সফলভাবে পাঠানো হয়েছে!', recipient: phone });[cite: 2]
    } catch (error) {
        console.error('মেসেজ পাঠাতে সমস্যা:', error);[cite: 2]
        res.status(500).json({ success: false, error: error.message });[cite: 2]
    }
});

const PORT = process.env.PORT || 3000;[cite: 2]
app.listen(PORT, () => {
    console.log(`🚀 সার্ভার চালু হয়েছে ${PORT} পোর্টে`);[cite: 2]
    startSystem();[cite: 2]
});
