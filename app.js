require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const axios = require('axios');
const Database = require('better-sqlite3');

// ====== CONFIG ======
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const PORT = Number(process.env.PORT || 8092);
const DB_PATH = process.env.DB_PATH || './attendance.db';
const BUSINESS_TIMEZONE = 'Asia/Tashkent';
// ====================

const SHIFT_RULES = {
    '5-2': { label: 'Shift 5-2', workStart: '17:00', workEnd: '02:00' },
    '6-3': { label: 'Shift 6-3', workStart: '18:00', workEnd: '03:00' },
    '7-4': { label: 'Shift 7-4', workStart: '19:00', workEnd: '04:00' }
};

const MAIN_KEYBOARD = {
    reply_markup: {
        keyboard: [
            [{ text: '📊 My Status' }],
            [{ text: '❌ Unregister' }, { text: '🔄 Start' }]
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// ====== ALL EMPLOYEES ======
const EMPLOYEE_SHIFT_MAP = {
    '001': { name: 'Suxrob', shiftKey: '6-3' },
    '18': { name: 'Abdulaziz', shiftKey: '6-3' },
    '002': { name: 'Asadbek Odilov', shiftKey: '7-4' },
    '003': { name: 'Hasanboy', shiftKey: '5-2' },
    '004': { name: 'Akbar Ramadan', shiftKey: '5-2' },
    '0006': { name: 'Farrux', shiftKey: '5-2' },
    '7': { name: 'Fayzulloh Winston', shiftKey: '6-3' },
    '8': { name: 'Diyor Ethan', shiftKey: '6-3' },
    '9': { name: 'Fazliddin Fred', shiftKey: '6-3' },
    '10': { name: 'Asadbek Henry', shiftKey: '5-2' },
    '11': { name: 'Amirshoh Alex', shiftKey: '6-3' },
    '12': { name: 'Lazizbek Leo', shiftKey: '5-2' },
    '14': { name: 'Azizbek Tony', shiftKey: '5-2' },
    '19': { name: 'Jessica', shiftKey: '5-2' },
    '24': { name: 'Sardor', shiftKey: '5-2' },
    '20': { name: 'Hamidullo', shiftKey: '6-3' },
    '036': { name: 'Odina', shiftKey: '6-3' },
    '52': { name: 'Asilbek', shiftKey: '6-3' },
    '49': { name: 'Bexruz', shiftKey: '6-3' },
    '38': { name: 'Otabek', shiftKey: '6-3' },
    '45': { name: 'Ahmad', shiftKey: '6-3' },
    '47': { name: 'Dilshod', shiftKey: '6-3' },
    '41': { name: 'Umrbek', shiftKey: '5-2' },
    '43': { name: 'Nazirbek', shiftKey: '6-3' },
};

const EMPLOYEE_SECRET_KEYS = {
    '001': '4yB!isuxrs',
    '18': 'byyDd5g@aa',
    '002': '#sFtgaays3',
    '003': 'gh#ma9mTsw',
    '004': 'agA8kb&vyk',
    '0006': 'b9afrpiR&y',
    '7': 'Wy!ahyf8nr',
    '8': 'k!wir2Ydwy',
    '9': '2habzgfUc#',
    '10': '&y9Maefska',
    '11': 'nq@ia4mMjr',
    '12': '!rlz2ajKkv',
    '14': 'v4wbRi!raz',
    '19': 'Fp@sjeh8cu',
    '24': 'ms&yaMr2fr',
    '20': 'Cuywh5he@m',
    '036': 'miadqo#D4a',
    '52': 'r2ijdwaJz$',
    '49': 'Tn5@kxpLq!',
    '38': 'Jv#2wrEmb9',
    '45': 'Xc!u7nQdp@',
    '47': 'Zs3&hLytf8',
    '41': 'Pm@9vKrxe!', 
    '43': 'Fp@sjeh5tu',
};
// ==========================

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS registered_users (
    telegram_chat_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,
    registered_at TEXT NOT NULL,
    PRIMARY KEY(telegram_chat_id)
  )
`);

async function sendTelegramToChat(chatId, message, extra = {}) {
    if (!chatId || !TELEGRAM_BOT_TOKEN) return;
    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
            { chat_id: chatId, text: message, parse_mode: 'HTML', ...extra }
        );
    } catch (err) {
        console.error(`Telegram error (chat ${chatId}):`, err.message);
    }
}

async function setBotCommands() {
    if (!TELEGRAM_BOT_TOKEN) return;
    try {
        await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setMyCommands`,
            {
                commands: [
                    { command: 'start', description: 'Start / register with secret key' },
                    { command: 'mystatus', description: 'Check my registration status' },
                    { command: 'unregister', description: 'Unregister from notifications' },
                ]
            }
        );
        console.log('✅ Bot commands menu registered.');
    } catch (err) {
        console.error('Failed to set bot commands:', err.message);
    }
}

// ====== TELEGRAM BOT — PERSONAL REGISTRATION ======
const pendingKeyEntry = new Set();
let pollingOffset = 0;

async function handleTelegramUpdate(update) {
    const msg = update.message || update.edited_message;
    if (!msg || !msg.text) return;

    const chatId = String(msg.chat.id);
    const text = msg.text.trim();

    if (text === '/start' || text.startsWith('/start ') || text === '🔄 Start') {
        pendingKeyEntry.add(chatId);
        await sendTelegramToChat(chatId,
            '👋 <b>Welcome to the Attendance Bot!</b>\n\n' +
            'To receive your personal attendance notifications, please enter your <b>secret key</b>:',
            MAIN_KEYBOARD
        );
        return;
    }

    if (text === '/mystatus' || text === '📊 My Status') {
        const reg = db.prepare('SELECT employee_id FROM registered_users WHERE telegram_chat_id = ?').get(chatId);
        if (!reg) {
            await sendTelegramToChat(chatId, '❌ You are not registered yet.\n\nUse /start to register with your secret key.', MAIN_KEYBOARD);
            return;
        }
        const empInfo = EMPLOYEE_SHIFT_MAP[reg.employee_id];
        const shiftInfo = empInfo ? SHIFT_RULES[empInfo.shiftKey] : null;
        await sendTelegramToChat(chatId,
            `✅ <b>You are registered!</b>\n\n` +
            `👤 Name: <b>${empInfo?.name || reg.employee_id}</b>\n` +
            `🆔 Employee ID: ${reg.employee_id}\n` +
            (shiftInfo ? `🏷 Shift: ${shiftInfo.label} (${shiftInfo.workStart}–${shiftInfo.workEnd})` : ''),
            MAIN_KEYBOARD
        );
        return;
    }

    if (text === '/unregister' || text === '❌ Unregister') {
        const deleted = db.prepare('DELETE FROM registered_users WHERE telegram_chat_id = ?').run(chatId);
        if (deleted.changes > 0) {
            await sendTelegramToChat(chatId, '✅ You have been unregistered and will no longer receive personal notifications.', MAIN_KEYBOARD);
        } else {
            await sendTelegramToChat(chatId, 'ℹ️ You were not registered.', MAIN_KEYBOARD);
        }
        return;
    }

    if (pendingKeyEntry.has(chatId)) {
        pendingKeyEntry.delete(chatId);
        const enteredKey = text;
        const matchedId = Object.entries(EMPLOYEE_SECRET_KEYS).find(([, key]) => key === enteredKey)?.[0];
        if (!matchedId) {
            await sendTelegramToChat(chatId,
                '❌ <b>Invalid key.</b>\n\nPlease ask your manager for the correct key, then use /start to try again.'
            );
            return;
        }
        db.prepare(`
            INSERT INTO registered_users (telegram_chat_id, employee_id, registered_at)
            VALUES (?, ?, ?)
            ON CONFLICT(telegram_chat_id) DO UPDATE SET
                employee_id = excluded.employee_id,
                registered_at = excluded.registered_at
        `).run(chatId, matchedId, new Date().toISOString());

        const empInfo = EMPLOYEE_SHIFT_MAP[matchedId];
        const shiftInfo = empInfo ? SHIFT_RULES[empInfo.shiftKey] : null;
        await sendTelegramToChat(chatId,
            `✅ <b>Registered successfully!</b>\n\n` +
            `👤 You are now linked as: <b>${empInfo?.name || matchedId}</b>\n` +
            (shiftInfo ? `🏷 Shift: ${shiftInfo.label} (${shiftInfo.workStart}–${shiftInfo.workEnd})\n` : '') +
            `\nYou will receive a personal message every time your attendance is recorded. ` +
            `Use /mystatus to check your registration or /unregister to remove it.`,
            MAIN_KEYBOARD
        );
        console.log(`📲 Registered: ${empInfo?.name || matchedId} (${matchedId}) → chat ${chatId}`);
        return;
    }
}

async function startTelegramPolling() {
    if (!TELEGRAM_BOT_TOKEN) {
        console.error('TELEGRAM_BOT_TOKEN is not set. Polling cannot start.');
        return;
    }
    console.log('📲 Telegram bot polling started.');
    while (true) {
        try {
            const res = await axios.get(
                `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates`,
                { params: { offset: pollingOffset, timeout: 30, allowed_updates: ['message'] }, timeout: 35000 }
            );
            for (const update of (res.data.result || [])) {
                pollingOffset = update.update_id + 1;
                handleTelegramUpdate(update).catch((err) =>
                    console.error('Telegram update handler error:', err.message)
                );
            }
        } catch (err) {
            console.error('Telegram polling error:', err.message);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }
}
// ==================================================

const app = express();
app.use(express.json());

app.get('/', (req, res) => res.send('Personal attendance bot is running'));

app.post('/notify', async (req, res) => {
    const { employeeId, message } = req.body || {};
    if (!employeeId || !message) return res.status(400).send('Missing employeeId or message');
    const row = db.prepare('SELECT telegram_chat_id FROM registered_users WHERE employee_id = ?').get(String(employeeId));
    if (!row) return res.status(404).send('Not registered');
    await sendTelegramToChat(row.telegram_chat_id, message);
    res.send('OK');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Personal bot running on http://0.0.0.0:${PORT}`);
    console.log('Telegram polling will start shortly...\n');
});

setBotCommands();
startTelegramPolling().catch((err) => {
    console.error('Telegram polling fatal error:', err.message);
});