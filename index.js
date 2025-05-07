const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const moment = require('moment-timezone');
const cron = require("node-cron")
require('dotenv').config();

const DB_HOST = process.env.DB_HOST;
const BACKUP_TIME = process.env.BACKUP_TIME || '03:00'; // default 03:00
const WEBHOOK_LOG = process.env.WEBHOOK_LOG;
const WEBHOOK_FILE = process.env.WEBHOOK_FILE;

const databases = [];
for (let i = 1; ; i++) {
    const name = process.env[`DB${i}_NAME`];
    const user = process.env[`DB${i}_USER`];
    const pass = process.env[`DB${i}_PASS`];

    if (!name || !user || !pass) break;

    databases.push({ name, user, pass });
}

const BACKUP_DIR = path.join(__dirname, 'backup');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

function backupDatabase({ name, user, pass }) {
    const fileName = `${name}.sql`;
    const filePath = path.join(BACKUP_DIR, fileName);
    const command = `mysqldump -h ${DB_HOST} -u ${user} -p${pass} ${name} > "${filePath}"`;

    return new Promise((resolve, reject) => {
        exec(command, (err) => {
            if (err) return reject(err);
            resolve(filePath);
        });
    });
}

async function sendLogToDiscord(message, success = true) {
    const embed = {
        username: 'ExecutiveNetworksDB',
        embeds: [{
            color: success ? 0x00FF00 : 0xFF0000,
            title: success ? '✅ Backup Database Berhasil' : '❌ Backup Gagal',
            description: message
        }]
    };

    await axios.post(WEBHOOK_LOG, embed).catch(console.error);
}

async function sendFileToDiscord(filePath) {
    const fileName = path.basename(filePath);
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    
    await axios.post(WEBHOOK_FILE, form, { headers: form.getHeaders() });

    // Hapus file setelah berhasil dikirim
    fs.unlinkSync(filePath);
}

let lastBackupDate = null;

cron.schedule('* * * * *', async () => {
    const jakartaTime = moment().tz('Asia/Jakarta');
    const currentTime = jakartaTime.format('HH:mm');
    
    if (currentTime === BACKUP_TIME && lastBackupDate !== jakartaTime.format('YYYY-MM-DD')) {
        console.log(`[${currentTime} WIB] Menjalankan backup database...`);
        lastBackupDate = jakartaTime.format('YYYY-MM-DD');

        for (const db of databases) {
            try {
                console.log(`Backup: ${db.name}`);
                const filePath = await backupDatabase(db);
                await sendFileToDiscord(filePath);
                await sendLogToDiscord(`File database **${db.name}.sql** berhasil di-backup pukul ${currentTime} WIB.`);
                console.log(`Berhasil backup dan kirim: ${db.name}.sql`);
            } catch (err) {
                await sendLogToDiscord(`Backup gagal untuk **${db.name}**:\n\`\`\`${err.message}\`\`\``, false);
                console.error(`Gagal backup ${db.name}:`, err.message);
            }
        }
    }
});