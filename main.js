// ============================================================
// Kedi Lo-Fi Pomodoro — main.js (v5 — Güvenli Yerel Medya Servisi)
// ============================================================
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const serveHandler = require('serve-handler');

// 🔊 Audio autoplay izni
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let tray = null;
let localServer = null;
let localPort = 0;
let isQuitting = false;
let alwaysOnTop = false;
let miniMode = false;

// 🎵 Medya servis tokeni (her başlatmada yenilenir)
const mediaToken = crypto.randomBytes(24).toString('hex');

// ─── Güvenli dosya yolları ───────────────────────────────────
const DATA_DIR = app.getPath('userData');
const statsFile = () => path.join(DATA_DIR, 'stats.json');
const libraryFile = () => path.join(DATA_DIR, 'library.json');
const settingsFile = () => path.join(DATA_DIR, 'settings.json');

// ─── JSON yardımcıları ────────────────────────────────────────
function loadJson(file, fallback) {
    try {
        if (fs.existsSync(file)) {
            const raw = fs.readFileSync(file, 'utf-8');
            const parsed = JSON.parse(raw);
            return parsed;
        }
    } catch (e) {
        console.error('loadJson hatası:', file, e.message);
        try {
            const backup = file + '.bak';
            if (fs.existsSync(file)) fs.renameSync(file, backup);
        } catch (_) { }
    }
    return fallback;
}

function saveJson(file, data) {
    try {
        const tmp = file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
        fs.renameSync(tmp, file);
        return true;
    } catch (e) {
        console.error('saveJson hatası:', file, e.message);
        return false;
    }
}

// ─── Medya servis yardımcıları ────────────────────────────────
const MEDIA_MIMES = {
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac',
    '.aac': 'audio/aac', '.opus': 'audio/opus',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime', '.m4v': 'video/x-m4v',
    '.ogv': 'video/ogg', '.avi': 'video/x-msvideo'
};

function getMediaMime(fp) {
    return MEDIA_MIMES[path.extname(fp).toLowerCase()] || 'application/octet-stream';
}

function serveMediaFile(req, res, filePath) {
    let stat;
    try {
        stat = fs.statSync(filePath);
        if (!stat.isFile()) throw new Error('not a file');
    } catch (e) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    const mimeType = getMediaMime(filePath);
    const range = req.headers.range;

    // Range istekleri (seek için şart)
    if (range) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (m) {
            let start = m[1] === '' ? 0 : parseInt(m[1], 10);
            let end = m[2] === '' ? stat.size - 1 : parseInt(m[2], 10);
            if (isNaN(start) || start < 0) start = 0;
            if (isNaN(end) || end >= stat.size) end = stat.size - 1;
            if (start > end) {
                res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
                res.end();
                return;
            }
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stat.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': end - start + 1,
                'Content-Type': mimeType,
                'Cache-Control': 'no-store'
            });
            const stream = fs.createReadStream(filePath, { start, end });
            stream.on('error', () => { try { res.end(); } catch (_) { } });
            stream.pipe(res);
            return;
        }
    }

    // Tam dosya
    res.writeHead(200, {
        'Content-Length': stat.size,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
    });
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { try { res.end(); } catch (_) { } });
    stream.pipe(res);
}

// ─── Yerel HTTP sunucu ────────────────────────────────────────
function startLocalServer() {
    return new Promise((resolve, reject) => {
        try {
            localServer = http.createServer((req, res) => {
                // 🎵 Yerel medya servis route'u
                if (req.url.startsWith('/__media')) {
                    const qIdx = req.url.indexOf('?');
                    const params = new URLSearchParams(qIdx >= 0 ? req.url.slice(qIdx + 1) : '');
                    const token = params.get('token');
                    const filePath = params.get('path') || '';

                    if (token !== mediaToken || !filePath) {
                        res.writeHead(403, { 'Content-Type': 'text/plain' });
                        res.end('Forbidden');
                        return;
                    }
                    serveMediaFile(req, res, filePath);
                    return;
                }

                // Normal statik dosyalar
                serveHandler(req, res, {
                    public: __dirname,
                    cleanUrls: false,
                    headers: [
                        {
                            source: '**/*',
                            headers: [
                                { key: 'Access-Control-Allow-Origin', value: '*' },
                                { key: 'Access-Control-Allow-Headers', value: '*' }
                            ]
                        }
                    ]
                });
            });

            localServer.on('error', (err) => {
                console.error('Sunucu hatası:', err);
                reject(err);
            });

            localServer.listen(0, '127.0.0.1', () => {
                localPort = localServer.address().port;
                console.log('🌐 Yerel sunucu: http://127.0.0.1:' + localPort);
                resolve(localPort);
            });
        } catch (e) {
            reject(e);
        }
    });
}

// ─── Ana pencere ──────────────────────────────────────────────
async function createWindow() {
    const iconPath = path.join(__dirname, 'assets', 'kedu.png');

    mainWindow = new BrowserWindow({
        width: 520, height: 820,
        minWidth: 400, minHeight: 560,
        resizable: true,
        backgroundColor: '#1a1a2e',
        icon: fs.existsSync(iconPath) ? iconPath : undefined,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
            backgroundThrottling: false
        }
    });

    try {
        const port = await startLocalServer();
        mainWindow.loadURL(`http://127.0.0.1:${port}/index.html`);
    } catch (e) {
        console.error('Sunucu başlatılamadı, file:// kullanılıyor:', e);
        mainWindow.loadFile('index.html');
    }

    mainWindow.on('close', (e) => {
        if (!isQuitting) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// ─── Güvenli IPC gönderici ────────────────────────────────────
function send(channel, ...args) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        try { mainWindow.webContents.send(channel, ...args); } catch (e) { }
    }
}

// ─── Tray menüsü ──────────────────────────────────────────────
function buildTrayMenu(state = {}) {
    return Menu.buildFromTemplate([
        {
            label: state.phaseLabel || 'Kedi Lo-Fi Pomodoro 🐾',
            enabled: false
        },
        { type: 'separator' },
        {
            label: state.isRunning ? '⏸ Duraklat' : '▶ Başlat',
            click: () => send('tray:toggle')
        },
        {
            label: '↺ Sıfırla',
            click: () => send('tray:reset')
        },
        { type: 'separator' },
        {
            label: '📂 Göster',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
            }
        },
        {
            label: '📌 Her Zaman Üstte',
            type: 'checkbox',
            checked: alwaysOnTop,
            click: (item) => {
                alwaysOnTop = item.checked;
                if (mainWindow) mainWindow.setAlwaysOnTop(alwaysOnTop);
                send('tray:alwaysOnTop', alwaysOnTop);
            }
        },
        {
            label: '▭ Mini Mod',
            type: 'checkbox',
            checked: miniMode,
            click: (item) => {
                miniMode = item.checked;
                if (mainWindow) {
                    if (miniMode) {
                        mainWindow.setSize(300, 220);
                        mainWindow.setResizable(false);
                    } else {
                        mainWindow.setSize(520, 820);
                        mainWindow.setResizable(true);
                    }
                }
                send('ui:mini', miniMode);
            }
        },
        { type: 'separator' },
        {
            label: '✕ Çıkış',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);
}

function createTray() {
    try {
        const iconPath = path.join(__dirname, 'assets', 'kedu.png');
        let icon;
        if (fs.existsSync(iconPath)) {
            icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
        } else {
            icon = nativeImage.createEmpty();
        }
        tray = new Tray(icon);
        tray.setToolTip('Kedi Lo-Fi Pomodoro 🐾');
        tray.setContextMenu(buildTrayMenu());
        tray.on('click', () => {
            if (!mainWindow) return;
            if (mainWindow.isVisible()) {
                mainWindow.hide();
            } else {
                mainWindow.show();
                mainWindow.focus();
            }
        });
    } catch (e) {
        console.error('Tray oluşturulamadı:', e);
    }
}

// ─── App hazır ────────────────────────────────────────────────
app.whenReady().then(async () => {
    await createWindow();
    createTray();

    // İstatistik
    ipcMain.handle('stats:load', () => {
        return loadJson(statsFile(), { version: 1, sessions: [], tasks: [], totalFocusSeconds: 0 });
    });
    ipcMain.handle('stats:save', (_e, d) => saveJson(statsFile(), d));

    // Kütüphane
    ipcMain.handle('library:load', () => loadJson(libraryFile(), []));
    ipcMain.handle('library:save', (_e, d) => saveJson(libraryFile(), d));

    // Ayarlar
    ipcMain.handle('settings:load', () => loadJson(settingsFile(), null));
    ipcMain.handle('settings:save', (_e, d) => saveJson(settingsFile(), d));

    // Dosya diyaloğu — birden fazla dosya
    ipcMain.handle('dialog:openFiles', async () => {
        if (!mainWindow) return [];
        const r = await dialog.showOpenDialog(mainWindow, {
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: 'Medya Dosyaları', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus', 'mp4', 'webm', 'mkv', 'mov', 'm4v'] },
                { name: 'Ses', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus'] },
                { name: 'Video', extensions: ['mp4', 'webm', 'mkv', 'mov', 'm4v'] }
            ]
        });
        return r.canceled ? [] : r.filePaths;
    });

    // Dosya diyaloğu — klasör
    ipcMain.handle('dialog:openFolder', async () => {
        if (!mainWindow) return [];
        const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
        if (r.canceled || !r.filePaths[0]) return [];
        const dir = r.filePaths[0];
        const exts = ['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus', '.mp4', '.webm', '.mkv', '.mov', '.m4v'];
        try {
            return fs.readdirSync(dir)
                .filter(f => exts.includes(path.extname(f).toLowerCase()))
                .map(f => path.join(dir, f));
        } catch (e) {
            console.error('Klasör okuma hatası:', e);
            return [];
        }
    });

    // Dosya var mı kontrolü
    ipcMain.handle('file:exists', (_e, filePath) => {
        try { return fs.existsSync(filePath); } catch (e) { return false; }
    });

    // HTTP JSON fetch (Kick API için)
    ipcMain.handle('http:json', async (_e, url) => {
        try {
            const res = await fetch(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json'
                },
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            return { error: e.message };
        }
    });

    // Sunucu origin ve medya token
    ipcMain.handle('app:getOrigin', () => `http://127.0.0.1:${localPort}`);
    ipcMain.handle('app:getMediaToken', () => mediaToken);

    // Harici link açma
    ipcMain.handle('shell:openExternal', async (_e, url) => {
        try {
            if (!/^https?:\/\//i.test(url)) return false;
            await shell.openExternal(url);
            return true;
        } catch (e) {
            console.error('Link açılamadı:', e);
            return false;
        }
    });

    // Tray güncelleme
    ipcMain.on('tray:update', (_e, state) => {
        if (!tray) return;
        alwaysOnTop = state.alwaysOnTop ?? alwaysOnTop;
        miniMode = state.miniMode ?? miniMode;
        tray.setToolTip(state.tooltip || 'Kedi Lo-Fi Pomodoro 🐾');
        tray.setContextMenu(buildTrayMenu(state));
    });

    // Bildirim
    ipcMain.on('notify', (_e, { title, body }) => {
        try {
            if (Notification.isSupported()) {
                new Notification({ title, body, silent: false }).show();
            }
        } catch (e) {
            console.error('Bildirim hatası:', e);
        }
    });

    // Pencere kontrolü
    ipcMain.on('window:alwaysOnTop', (_e, val) => {
        alwaysOnTop = val;
        if (mainWindow) mainWindow.setAlwaysOnTop(val);
    });
    ipcMain.on('window:mini', (_e, val) => {
        miniMode = val;
        if (mainWindow) {
            if (val) {
                mainWindow.setSize(300, 220);
                mainWindow.setResizable(false);
            } else {
                mainWindow.setSize(520, 820);
                mainWindow.setResizable(true);
            }
        }
    });
});

// ─── Uygulama yaşam döngüsü ───────────────────────────────────
app.on('window-all-closed', () => {
    if (isQuitting) {
        if (localServer) { try { localServer.close(); } catch (e) { } }
        app.quit();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
    if (localServer) { try { localServer.close(); } catch (e) { } }
});

app.on('activate', () => {
    if (mainWindow) mainWindow.show();
});