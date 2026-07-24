const express = require('express');
const cors = require('cors');
const wppconnect = require('@wppconnect-team/wppconnect');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { MongoClient } = require('mongodb');
const { exec } = require('child_process'); // ব্রাউজার ক্র্যাশ রোধ করতে প্রসেস ক্লিন করার জন্য

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = 'mongodb+srv://samityAdmin:samity123@cluster0.rnh0xw2.mongodb.net/?appName=Cluster0'; 
const DB_NAME = 'whatsapp_api';
const COLLECTION_NAME = 'sessions';
const SESSION_NAME = 'samity-session';
const TOKEN_DIR = path.join(__dirname, 'tokens', SESSION_NAME);

let whatsappClient = null;
let qrCodeData = null;
let pairingCodeStr = null;
let clientStatus = 'Initializing...';
let isSystemStarting = false;

// MongoDB থেকে আগের সেশন রিস্টোর করার ফাংশন
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
            fs.unlinkSync(zipPath);
            return true; 
        } else {
            console.log('⚠️ ডাটাবেসে আগের কোনো সেশন পাওয়া যায়নি।');
            return false; 
        }
    } catch (error) {
        console.error('❌ সেশন রিস্টোর করতে সমস্যা:', error.message);
        return false;
    } finally {
        await client.close();
    }
}

// সেশন MongoDB তে ব্যাকআপ নেওয়ার ফাংশন
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
            { upsert: true }
        );
        console.log('✅ সেশন সফলভাবে MongoDB তে সুরক্ষিত করা হয়েছে! এখন ফোন অফলাইনে থাকলেও API কাজ করবে।');
    } catch (error) {
        console.error('❌ সেশন ব্যাকআপ করতে সমস্যা:', error.message);
    } finally {
        await client.close();
    }
}

// ব্রাউজার ক্র্যাশ এড়াতে পূর্বের সেশন ক্লিন করার ফাংশন
async function killBrowserAndReset() {
    console.log('🛑 Switching mode: Clearing old browser instances...');
    clientStatus = 'Switching mode...';
    
    if (whatsappClient) {
        try { await whatsappClient.close(); } catch (e) {}
        whatsappClient = null;
    }

    return new Promise((resolve) => {
        isSystemStarting = false;
        qrCodeData = null;
        pairingCodeStr = null;
        
        try {
            exec('pkill -f chrome', (err) => {
                const lockFile = path.join(TOKEN_DIR, 'SingletonLock');
                if (fs.existsSync(lockFile)) {
                    try { fs.unlinkSync(lockFile); } catch (e) {}
                }
                resolve();
            });
        } catch (e) {
            resolve();
        }
    });
}

// সিস্টেম চালু করার মূল ফাংশন
async function startSystem(phoneNumber = null) {
    if (isSystemStarting) return;
    
    isSystemStarting = true;
    clientStatus = 'Starting WhatsApp Client...';

    const options = {
        session: SESSION_NAME,
        autoClose: 0,
        qrTimeout: 0,
        browserArgs: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ],
        catchQR: (base64Qr, asciiQR) => {
            console.log('QR কোড তৈরি হয়েছে!');
            qrCodeData = base64Qr;
            clientStatus = 'QR Code Ready. Please scan or use pairing code.';
        },
        statusFind: async (statusSession) => {
            console.log('সেশন স্ট্যাটাস:', statusSession);
            clientStatus = `Session Status: ${statusSession}`;
            if (statusSession === 'isLogged' || statusSession === 'inChat') {
                qrCodeData = null;
                pairingCodeStr = null;
                isSystemStarting = false;
                clientStatus = 'Connected & Ready!';
                await backupSessionToMongo(); 
            }
        },
        headless: true,
        useChrome: false
    };

    if (phoneNumber) {
        options.phoneNumber = phoneNumber;
        options.catchLinkCode = (str) => {
            console.log('✅ Pairing Code তৈরি হয়েছে:', str);
            pairingCodeStr = str;
            clientStatus = `Pairing Code Generated`;
        };
    }

    wppconnect.create(options)
    .then((client) => {
        whatsappClient = client;
        isSystemStarting = false;
        if (clientStatus !== 'Connected & Ready!') {
            clientStatus = 'Waiting for scan or pairing code...';
        }
    })
    .catch((error) => {
        console.log('❌ WhatsApp ক্লায়েন্ট চালু হতে সমস্যা বা মোড পরিবর্তন করা হয়েছে:', error.message);
        isSystemStarting = false;
    });
}

// ফ্রন্টএন্ড UI (ইউজার ইন্টারফেস)
app.get('/', (req, res) => {
    if (whatsappClient) {
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2 style="color:green;">✅ API সচল আছে এবং WhatsApp কানেক্টেড!</h2>
                <p style="color:#555;">আপনার ফোন অফলাইনে থাকলেও এটি নিরবচ্ছিন্নভাবে মেসেজ পাঠাতে পারবে।</p>
                <p>Status: <b>${clientStatus}</b></p>
            </div>
        `);
    } else if (pairingCodeStr) {
        // পেয়ারিং কোড দেখানোর স্ক্রিন
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2>ফোন নাম্বার দিয়ে লিংক করুন</h2>
                <p style="color: #333;">আপনার হোয়াটসঅ্যাপের <b>Linked Devices -> Link with phone number</b> অপশনে যান এবং নিচের কোডটি দিন:</p>
                <p style="font-size: 32px; font-weight: bold; color: #075E54; letter-spacing: 5px; background: #e5ddd5; display: inline-block; padding: 10px 20px; border-radius: 10px; margin-top: 10px;">${pairingCodeStr}</p>
                
                <div style="margin-top: 30px;">
                    <button onclick="startQR()" style="padding: 10px 20px; cursor: pointer; background: #666; color: white; border: none; border-radius: 5px;">কিউআর কোড স্ক্যান করতে ফিরে যান</button>
                </div>
                
                <p style="color: #888; margin-top: 20px;">স্ট্যাটাস: <b>${clientStatus}</b></p>
                <script>
                    setTimeout(() => { window.location.reload(); }, 5000);
                    function startQR() {
                        document.body.style.opacity = '0.5';
                        fetch('/start-qr', { method: 'POST' }).then(() => window.location.reload());
                    }
                </script>
            </div>
        `);
    } else {
        // কিউআর কোড এবং ফোন ইনপুট স্ক্রিন
        res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2>১. হোয়াটসঅ্যাপ কানেক্ট করতে কিউআর কোড স্ক্যান করুন</h2>
                
                ${qrCodeData ? `
                    <img src="${qrCodeData}" alt="QR Code" style="border: 2px solid #ccc; border-radius: 10px; padding: 10px; margin-top: 10px; width: 280px; height: 280px;" />
                ` : `
                    <p style="color:orange; margin: 50px 0;">⏳ সার্ভার চালু হচ্ছে এবং কিউআর কোড লোড হচ্ছে...</p>
                `}

                <div style="margin-top: 30px; border-top: 1px solid #ddd; padding-top: 30px; max-width: 400px; margin-left: auto; margin-right: auto;">
                    <h3 style="color: #333;">অথবা, ফোন নাম্বার দিয়ে লিংক করুন</h3>
                    <p style="font-size: 14px; color: #666;">কান্ট্রি কোড সহ নাম্বার দিন (যেমন: 8801XXXXXXXXX)</p>
                    <input type="text" id="phoneInput" placeholder="8801XXXXXXXXX" style="padding: 12px; width: 80%; border-radius: 5px; border: 1px solid #ccc; text-align: center; font-size: 16px; margin-bottom: 15px;">
                    <br>
                    <button onclick="requestPairingCode()" style="padding: 12px 25px; cursor: pointer; background: #25D366; color: white; border: none; border-radius: 5px; font-size: 16px; font-weight: bold;">কোড জেনারেট করুন</button>
                </div>

                <p style="color: #666; margin-top: 20px;">স্ট্যাটাস: <b>${clientStatus}</b></p>
                <p style="color: #888; font-size: 14px;"><i>কানেক্ট করা হয়ে গেলে পেজটি নিজে থেকেই আপডেট হয়ে যাবে...</i></p>
                
                <script>
                    setTimeout(() => { window.location.reload(); }, 5000);

                    function requestPairingCode() {
                        const phone = document.getElementById('phoneInput').value;
                        if (!phone) return alert('দয়া করে ফোন নাম্বার দিন!');
                        
                        document.body.style.opacity = '0.5';
                        fetch('/request-pairing-code', {
                            method: 'POST',
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({ phone })
                        }).then(() => {
                            console.log("Requesting pairing code...");
                        }).catch(console.error);
                    }
                </script>
            </div>
        `);
    }
});

// রাউট: ম্যানুয়ালি QR কোড মোডে ফিরে যাওয়া
app.post('/start-qr', async (req, res) => {
    await killBrowserAndReset();
    startSystem();
    res.status(200).json({ success: true });
});

// রাউট: পেয়ারিং কোড রিকোয়েস্ট করা
app.post('/request-pairing-code', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'ফোন নাম্বার প্রয়োজন!' });
        
        // পূর্বের ব্রাউজার প্রসেস কিল করে নতুন করে ফোন নাম্বার দিয়ে চালু করা হচ্ছে
        await killBrowserAndReset();
        startSystem(phone);
        
        res.status(200).json({ success: true, message: 'পেয়ারিং কোড রিকোয়েস্ট পাঠানো হয়েছে।' });
    } catch (error) {
        console.error('পেয়ারিং কোড রিকোয়েস্ট করতে সমস্যা:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// রাউট: মেসেজ পাঠানো
app.post('/send-message', async (req, res) => {
    try {
        const { phone, message } = req.body;
        if (!phone || !message) {
            return res.status(400).json({ success: false, message: 'ফোন নম্বর এবং মেসেজ উভয়ই দিতে হবে!' });
        }
        if (!whatsappClient) {
            return res.status(500).json({ success: false, message: 'হোয়াটসঅ্যাপ এখনো কানেক্ট হয়নি!' });
        }
        
        const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        await whatsappClient.sendText(formattedPhone, message);
        
        res.status(200).json({ success: true, message: 'মেসেজ সফলভাবে পাঠানো হয়েছে!', recipient: phone });
    } catch (error) {
        console.error('মেসেজ পাঠাতে সমস্যা:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// সার্ভার চালু করা
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`🚀 সার্ভার চালু হয়েছে ${PORT} পোর্টে`);
    
    // প্রথমে ডাটাবেসে চেক করবে আগের কোনো লগিন সেশন আছে কিনা
    await restoreSessionFromMongo();
    
    // সার্ভার চালু হওয়ার সাথে সাথেই অটোমেটিকভাবে সিস্টেম স্টার্ট হবে (QR Code জেনারেট করবে)
    startSystem();
});
