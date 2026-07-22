const express = require('express');
const wppconnect = require('@wppconnect-team/wppconnect');
const { MongoClient, GridFSBucket } = require('mongodb');
const AdmZip = require('adm-zip');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// --- MongoDB সেটআপ (Render এর Environment Variable থেকে পড়বে) ---
const MONGO_URI = process.env.MONGO_URI; 
if (!MONGO_URI) {
    console.error("⚠️ MONGO_URI environment variable is missing!");
}
const mongoClient = new MongoClient(MONGO_URI);

let waClient = null;
let latestQRImage = null;

// --- রিস্টোর ফাংশন (Render সার্ভার চালুর সময় MongoDB থেকে টোকেন আনবে) ---
async function restoreSession() {
    console.log('Checking for saved session in MongoDB...');
    if (!MONGO_URI) return;
    try {
        await mongoClient.connect();
        const db = mongoClient.db('whatsapp_session_db');
        const bucket = new GridFSBucket(db, { bucketName: 'sessions' });

        const files = await db.collection('sessions.files').find({ filename: 'whatsapp-session.zip' }).toArray();

        if (files.length > 0) {
            await new Promise((resolve, reject) => {
                const downloadStream = bucket.openDownloadStreamByName('whatsapp-session.zip');
                const writeStream = fs.createWriteStream('./whatsapp-session.zip');

                downloadStream.pipe(writeStream);
                writeStream.on('finish', () => {
                    try {
                        const zip = new AdmZip('./whatsapp-session.zip');
                        zip.extractAllTo('./tokens', true);
                        console.log('✅ Session restored successfully from MongoDB!');
                        resolve();
                    } catch (zipErr) {
                        console.log('❌ Error unzipping:', zipErr.message);
                        resolve(); 
                    }
                });
                writeStream.on('error', reject);
            });
        } else {
            console.log('⚠️ No previous session found. Ready for new QR scan.');
        }
    } catch (err) {
        console.log('❌ Restore error:', err.message);
    }
}

// --- ব্যাকআপ ফাংশন (লগইন সফল হলে MongoDB-তে সেভ করবে) ---
async function backupSession() {
    console.log('Backing up session to MongoDB...');
    if (!MONGO_URI) return;
    try {
        await mongoClient.connect();
        const db = mongoClient.db('whatsapp_session_db');
        const bucket = new GridFSBucket(db, { bucketName: 'sessions' });

        // টোকেন ফোল্ডারটিকে জিপ করা
        const zip = new AdmZip();
        zip.addLocalFolder('./tokens');
        zip.writeZip('./whatsapp-session.zip');

        // পুরোনো ব্যাকআপ ফাইল থাকলে মুছে ফেলা
        const existingFiles = await db.collection('sessions.files').find({ filename: 'whatsapp-session.zip' }).toArray();
        for (const file of existingFiles) {
            await bucket.delete(file._id);
        }

        // নতুন জিপ ফাইল আপলোড করা
        fs.createReadStream('./whatsapp-session.zip')
            .pipe(bucket.openUploadStream('whatsapp-session.zip'))
            .on('finish', () => {
                console.log('✅ Session backed up safely to MongoDB!');
            });
    } catch (err) {
        console.log('❌ Backup error:', err.message);
    }
}

// --- হোয়াটসঅ্যাপ ক্লায়েন্ট শুরু করার ফাংশন ---
function startWhatsApp() {
    wppconnect.create({
        session: 'escs-session',
        folderNameToken: 'tokens',
        autoClose: 0,
        waitForLogin: true, 
        catchQR: (base64Qr) => { 
            latestQRImage = base64Qr; 
            console.log('QR Code generated! Please scan from /qr route.');
        },
        statusFind: (statusSession) => {
            console.log('Status Session: ', statusSession);
            if (statusSession === 'isLogged' || statusSession === 'inChat') {
                latestQRImage = null;
                console.log('✅ WhatsApp Session is Connected!');
                // লগইন সফল হওয়ার ৫ সেকেন্ড পর ব্যাকআপ নেবে (যাতে সব ফাইল ঠিকমতো তৈরি হতে পারে)
                setTimeout(backupSession, 5000); 
            }
        },
        headless: true,
        devtools: false,
        useChrome: true,
        logQR: false, 
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
        console.log('✅ WhatsApp Client is Ready & Online!');
    })
    .catch((err) => console.log('❌ WPPConnect Init Error:', err));
}

// --- রুট: টেস্ট এবং QR দেখা ---
app.get('/', (req, res) => {
    res.send('Ekota Sanchay Co-operative Society (ESCS) WhatsApp API is Running!');
});

app.get('/qr', (req, res) => {
    if (latestQRImage) {
        res.send(`<div style="text-align:center; margin-top:50px; font-family:Arial;"><h2>Scan QR Code</h2><img src="${latestQRImage}" style="border: 1px solid #ddd; padding: 10px; border-radius: 8px;"></div>`);
    } else {
        res.send('<div style="text-align:center; margin-top:50px; font-family:Arial;"><h2 style="color:green;">✅ WhatsApp is Active and Ready!</h2><p>আপনার অ্যাকাউন্ট সফলভাবে কানেক্টেড আছে। মোবাইল অফলাইনে থাকলেও মেসেজ ডেলিভারি হবে।</p></div>');
    }
});

// --- রুট: মেসেজ পাঠানো (অটো রিট্রাই ফিচার সহ) ---
app.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!waClient) return res.status(503).json({ status: 'error', message: 'API is offline or starting...' });

    try {
        const formattedPhone = phone.includes('@c.us') ? phone : `${phone}@c.us`;
        
        let success = false;
        let lastError = null;

        // রিট্রাই মেকানিজম: কোনো কারণে ফেইল হলে ২ সেকেন্ড পর পর ৩ বার চেষ্টা করবে
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                await waClient.sendText(formattedPhone, message);
                success = true;
                break; 
            } catch (err) {
                lastError = err;
                console.log(`Attempt ${attempt} failed. Retrying...`);
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (success) {
            res.json({ status: 'success', message: 'Message sent successfully!' });
        } else {
            throw lastError; 
        }

    } catch (error) {
        res.status(500).json({ status: 'error', message: 'Failed to send message', details: error.message });
    }
});

// --- সার্ভার স্টার্ট ---
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    await restoreSession(); // ১. আগে MongoDB থেকে টোকেন ফাইল নামাবে
    startWhatsApp();        // ২. তারপর হোয়াটসঅ্যাপ সেশন চালু করবে
});
