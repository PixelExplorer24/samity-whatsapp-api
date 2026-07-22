const express = require('express');
const cors = require('cors');
const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { MongoClient } = require('mongodb');

const app = express();
// CORS চালু করা হলো
app.use(cors());
app.use(express.json());

// ⚠️ নিচের লিংকে <db_username> এবং <db_password> এর জায়গায় আপনার আসল ইউজারনেম ও পাসওয়ার্ড বসিয়ে দিন
const MONGO_URI = 'mongodb+srv://samityAdmin:samity123@cluster0.rnh0xw2.mongodb.net/?appName=Cluster0'; 
const DB_NAME = 'whatsapp_api';
const COLLECTION_NAME = 'sessions';
const SESSION_NAME = 'samity-session';
const TOKEN_DIR = path.join(__dirname, 'tokens', SESSION_NAME);

let whatsappClient = null;
let qrCodeData = null;

// MongoDB থেকে সেশন রিস্টোর করার ফাংশন
async function restoreSessionFromMongo() {
    console.log('⏳ MongoDB থেকে সেশন খোঁজা হচ্ছে...');
    const client = new MongoClient(MONGO_URI);
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        const sessionData = await db.collection(COLLECTION_NAME).findOne({ sessionName: SESSION_NAME });
        
        if (sessionData && sessionData.zipBuffer) {
            const zipPath = path.join(__dirname, 'temp_session.zip');
            fs.writeFileSync(zipPath, sessionData.zipBuffer.buffer);
            
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(TOKEN_DIR, true);
            console.log('✅ MongoDB থেকে সেশন সফলভাবে রিস্টোর করা হয়েছে!');
            fs.unlinkSync(zipPath); // টেম্পোরারি জিপ ফাইল মুছে ফেলা
        } else {
            console.log('⚠️ ডাটাবেসে আগের কোনো সেশন পাওয়া যায়নি। নতুন করে QR কোড স্ক্যান করতে হবে।');
        }
    } catch (error) {
        console.error('❌ সেশন রিস্টোর করতে সমস্যা:', error.message);
    } finally {
        await client.close();
    }
}

// MongoDB তে সেশন ব্যাকআপ রাখার ফাংশন
async function backupSessionToMongo() {
    if (!fs.existsSync(TOKEN_DIR)) return;
    console.log('⏳ MongoDB তে সেশন ব্যাকআপ নেওয়া হচ্ছে...');
    const client = new MongoClient(MONGO_URI);
    try {
        const zip = new AdmZip();
        zip.addLocalFolder(TOKEN_DIR);
        const zipBuffer = zip.toBuffer();

        await client.connect();
        const db = client.db(DB_NAME);
        
        await db.collection(COLLECTION_NAME).updateOne(
            { sessionName: SESSION_NAME },
            { $set: { zipBuffer: zipBuffer, updatedAt: new Date() } },
            { upsert: true } // না থাকলে তৈরি করবে, থাকলে আপডেট করবে
        );
        console.log('✅ সেশন সফলভাবে MongoDB তে সুরক্ষিত করা হয়েছে!');
    } catch (error) {
        console.error('❌ সেশন ব্যাকআপ করতে সমস্যা:', error.message);
    } finally {
        await client.close();
    }
}

// মূল সিস্টেম চালু করা
async function startSystem() {
    // ১. প্রথমে ডাটাবেস থেকে সেশন নিয়ে আসার চেষ্টা করবে
    await restoreSessionFromMongo();

    // ২. এরপর হোয়াটসঅ্যাপ ক্লায়েন্ট তৈরি করবে
    wppconnect.create({
        session: SESSION_NAME,
        catchQR: (base64Qr, asciiQR) => {
            console.log('QR কোড তৈরি হয়েছে! দয়া করে স্ক্যান করুন।');
            qrCodeData = base64Qr;
        },
        statusFind: async (statusSession) => {
            console.log('সেশন স্ট্যাটাস:', statusSession);
            if (statusSession === 'isLogged' || statusSession === 'inChat') {
                qrCodeData = null;
                // লগইন সফল হলে ডাটাবেসে ব্যাকআপ নিয়ে রাখবে
                await backupSessionToMongo();
            }
        },
        headless: true,
        useChrome: false
    })
    .then((client) => {
        whatsappClient = client;
        console.log('✅ WhatsApp API কানেক্টেড এবং মেসেজ পাঠানোর জন্য প্রস্তুত!');
    })
    .catch((error) => {
        console.log('❌ WhatsApp ক্লায়েন্ট চালু হতে সমস্যা:', error);
    });
}

// স্ট্যাটাস এবং QR কোড পেজ
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

// মেসেজ পাঠানোর রাউট
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;

        if (!phone || !message) {
            return res.status(400).json({ success: false, message: 'ফোন নম্বর এবং মেসেজ উভযই দিতে হবে!' });
        }

        if (!whatsappClient) {
            return res.status(500).json({ success: false, message: 'হোয়াটসঅ্যাপ এখনো কানেক্ট হয়নি! লিংকে গিয়ে QR কোড স্ক্যান করুন।' });
        }

        const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        await whatsappClient.sendText(formattedPhone, message);

        res.status(200).json({ success: true, message: 'মেসেজ সফলভাবে পাঠানো হয়েছে!', recipient: phone });
    } catch (error) {
        console.error('মেসেজ পাঠাতে সমস্যা:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 সার্ভার চালু হয়েছে ${PORT} পোর্টে`);
    startSystem(); // সার্ভার রান হওয়ার সাথে সাথে হোয়াটসঅ্যাপ সিস্টেম স্টার্ট হবে
});
