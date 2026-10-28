#!/usr/bin/env node
// 小紅書登入守門員：給 Telegram 機器人下載小紅書用的「專用登入」（跟自己平常瀏覽的瀏覽器分開）
//
//   node xhs_guard.js check   每天跑：還登入著就開一次首頁保持登入；登出了就走 login
//   node xhs_guard.js login   傳 TG 提醒回電腦點桌面捷徑登入，然後在背景等最多 3 小時
//   node xhs_guard.js qr      備用：把 QR code 截圖傳到 TG（需要另一台裝置顯示給手機掃）
//   node xhs_guard.js wait    同 login，但不再傳提醒（已經提醒過時用）
//   node xhs_guard.js status  只印出目前有沒有登入（給下載前檢查用）
//
// 下載小紅書時用這個資料夾的 cookies：
//   yt-dlp --cookies-from-browser "firefox:$HOME/.claude/channels/telegram/xhs_guard/profile" ...
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const HOME = os.homedir();
const DIR = __dirname;
const PROFILE = path.join(DIR, 'profile');
const LOG = path.join(DIR, 'xhs_guard.log');
const PIDFILE = path.join(DIR, 'login.pid');
const TG_DIR = path.join(HOME, '.claude/channels/telegram');
const FIREFOX = '/Applications/Firefox.app/Contents/MacOS/firefox';
const EXPLORE = 'https://www.xiaohongshu.com/explore';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const QR_ROUNDS = 3;              // 最多傳幾張 QR code
const QR_WAIT_MS = 3 * 60 * 1000; // 每張最多等 3 分鐘

const sleep = ms => new Promise(r => setTimeout(r, ms));

function log(msg) {
  const ts = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Taipei' });
  fs.appendFileSync(LOG, `${ts} ${msg}\n`);
}

function tgConfig() {
  const env = fs.readFileSync(path.join(TG_DIR, '.env'), 'utf8');
  const token = (env.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m) || [])[1].trim();
  const chat = JSON.parse(fs.readFileSync(path.join(TG_DIR, 'access.json'), 'utf8')).allowFrom[0];
  return { token, chat };
}

async function tgText(text) {
  try {
    const { token, chat } = tgConfig();
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text }),
    });
  } catch (e) { log('TG 文字傳送失敗: ' + e.message); }
}

async function tgPhoto(png, caption) {
  try {
    const { token, chat } = tgConfig();
    const fd = new FormData();
    fd.append('chat_id', chat);
    fd.append('caption', caption);
    fd.append('photo', new Blob([png], { type: 'image/png' }), 'xhs_qr.png');
    const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: fd });
    return (await r.json()).ok;
  } catch (e) { log('TG 圖片傳送失敗: ' + e.message); return false; }
}

// 從機器人 profile 的 cookies.sqlite 讀 cookie（先複製一份，避免跟執行中的瀏覽器搶鎖）
function cookieHeader() {
  const db = path.join(PROFILE, 'cookies.sqlite');
  if (!fs.existsSync(db)) return '';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xhsck-'));
  try {
    for (const f of ['cookies.sqlite', 'cookies.sqlite-wal']) {
      if (fs.existsSync(path.join(PROFILE, f))) fs.copyFileSync(path.join(PROFILE, f), path.join(tmp, f));
    }
    const out = execFileSync('/usr/bin/sqlite3', [path.join(tmp, 'cookies.sqlite'),
      "select name||'='||value from moz_cookies where host like '%xiaohongshu.com'"], { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).join('; ');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function isLoggedIn() {
  const cookie = cookieHeader();
  if (!cookie.includes('web_session=')) return false;
  // 網路一時不通就當作「還沒登入」，下一輪再查，不要讓整個等待流程掛掉
  try {
    const r = await fetch(EXPLORE, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(20000) });
    return /"loggedIn":true/.test(await r.text());
  } catch (e) {
    log('isLoggedIn 連線失敗（略過這輪）: ' + e.message);
    return false;
  }
}

async function launch() {
  fs.mkdirSync(PROFILE, { recursive: true });
  return puppeteer.launch({
    browser: 'firefox', executablePath: FIREFOX, headless: true,
    userDataDir: PROFILE, args: ['--width=1280', '--height=900'],
    // 2026-10-24：ISP DNS 會把 edith.xiaohongshu.com 指到壞節點（顯示「工程薯正在努力抢修」），改走加密 DNS
    extraPrefsFirefox: {
      'network.trr.mode': 3,
      'network.trr.uri': 'https://dns.google/dns-query',
      'network.trr.bootstrapAddr': '8.8.8.8',
    },
  });
}

async function keepAlive() {
  const b = await launch();
  try {
    const p = await b.newPage();
    await p.goto(EXPLORE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(15000);
  } finally { await b.close(); }
}

function profileInUse() {
  try {
    execFileSync('/usr/bin/pgrep', ['-f', '--', `--profile ${PROFILE}`]);
    return true;
  } catch (_) { return false; }
}

function takePid() {
  // 同時只留一個等待流程：再跑一次時，關掉舊的
  if (fs.existsSync(PIDFILE)) {
    const old = Number(fs.readFileSync(PIDFILE, 'utf8'));
    try { process.kill(old, 'SIGTERM'); } catch (_) {}
  }
  fs.writeFileSync(PIDFILE, String(process.pid));
}

function releasePid() {
  try { if (Number(fs.readFileSync(PIDFILE, 'utf8')) === process.pid) fs.unlinkSync(PIDFILE); } catch (_) {}
}

// 預設做法：提醒使用者回電腦點桌面捷徑登入，然後在背景等，登入成功就通知
// （2026-10-24 實測：小紅書 App 不一定能從相簿掃 QR code，所以不傳 QR 圖）
const NOTIFY_WAIT_MS = 3 * 60 * 60 * 1000;
async function notifyFlow(silent = false) {
  takePid();
  try {
    if (!silent) await tgText('🔐 機器人的小紅書登入過期了，小紅書網址暫時抓不到。\n\n' +
      '方便的時候回到電腦：\n' +
      '1️⃣ 點兩下桌面的「小紅書機器人登入」\n' +
      '2️⃣ 用手機小紅書 App「掃一掃」掃電腦螢幕上的 QR code\n' +
      '3️⃣ 登入後把那個視窗關掉就好\n\n' +
      '我會自己偵測，登入成功會再通知你 👍');
    log(silent ? 'wait: 不再提醒，背景等使用者登入' : 'notify: 已通知使用者回電腦登入');
    const until = Date.now() + NOTIFY_WAIT_MS;
    while (Date.now() < until) {
      await sleep(30000);
      if (await isLoggedIn()) {
        log('notify: 登入成功');
        await tgText('✅ 小紅書重新登入成功！之後傳小紅書網址給我就能直接處理了。');
        return true;
      }
    }
    log('notify: 3 小時內沒有登入，停止等待');
    return false;
  } finally { releasePid(); }
}

// 備用做法：把 QR code 截圖傳到 TG（需要另一台裝置顯示 QR code 給手機掃）
async function qrFlow() {
  takePid();
  if (profileInUse()) {
    await tgText('機器人登入視窗已經在電腦上開著了，直接在那個視窗掃碼登入就好。');
    releasePid();
    return false;
  }
  const b = await launch();
  try {
    const p = await b.newPage();
    await p.setViewport({ width: 1280, height: 900 });
    await p.goto(EXPLORE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    for (let round = 1; round <= QR_ROUNDS; round++) {
      if (round > 1) await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
      let box;
      try {
        await p.waitForSelector('.login-container img.qrcode-img', { timeout: 30000 });
        await sleep(1500);
        box = await p.$('.login-container');
      } catch (_) {
        if (await isLoggedIn()) { log('login: 其實已經登入'); return true; }
        log('login: 找不到登入 QR code（小紅書可能改版）');
        await tgText('⚠️ 小紅書登入頁打不開或改版了，找不到 QR code。請回我「小紅書登入」再試一次，或在電腦上處理。');
        return false;
      }
      const png = await box.screenshot({ type: 'png' });
      const left = round === QR_ROUNDS ? '（這是最後一張）' : '';
      const sent = await tgPhoto(png,
        `🔐 小紅書登入過期了，請掃這個 QR code 重新登入${left}\n\n` +
        `📱 小紅書 App →「掃一掃」→ 選右下角「相簿」→ 選這張圖\n` +
        `⏱️ 大約 3 分鐘內有效；過期會自動再傳一張（最多 ${QR_ROUNDS} 張）`);
      log(`login: 已傳第 ${round} 張 QR code (sent=${sent})`);
      const until = Date.now() + QR_WAIT_MS;
      while (Date.now() < until) {
        await sleep(3000);
        const state = await p.evaluate(() => {
          const c = document.querySelector('.login-container');
          return { open: !!c, text: c ? c.innerText : '' };
        }).catch(() => ({ open: true, text: '' }));
        if (!state.open && await isLoggedIn()) {
          log('login: 登入成功');
          await tgText('✅ 小紅書重新登入成功！之後傳小紅書網址給我就能直接處理了。');
          return true;
        }
        if (/过期|失效/.test(state.text)) break;
      }
      // 頁面上看起來沒變化，但可能已經登入了，再確認一次
      if (await isLoggedIn()) {
        log('login: 登入成功（cookie 確認）');
        await tgText('✅ 小紅書重新登入成功！');
        return true;
      }
    }
    log('login: QR code 都過期了，沒有掃');
    await tgText('⌛ 小紅書的 QR code 都過期了。方便的時候回我「小紅書登入」，我再傳一張新的給你。');
    return false;
  } finally {
    await b.close().catch(() => {});
    releasePid();
  }
}

(async () => {
  const mode = process.argv[2] || 'check';
  if (mode === 'status') {
    console.log((await isLoggedIn()) ? 'logged_in' : 'logged_out');
    return;
  }
  if (mode === 'login') { await notifyFlow(); return; }
  if (mode === 'wait') { await notifyFlow(true); return; }  // 已經提醒過，只在背景等登入
  if (mode === 'qr') { await qrFlow(); return; }
  // check
  if (await isLoggedIn()) {
    if (profileInUse()) { log('check: 登入中（視窗開著，略過保持登入）'); return; }
    await keepAlive();
    log('check: 登入中，已開首頁保持登入');
    return;
  }
  log('check: 偵測到登出，通知使用者回電腦登入');
  await notifyFlow();
})().catch(async e => {
  log('錯誤: ' + (e.stack || e.message));
  process.exitCode = 1;
});
