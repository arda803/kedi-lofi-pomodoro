// ============================================================
// Kedi Lo-Fi Pomodoro — renderer.js v8.1
// 🐛 Fix: Kedi SVG tema + renderLibrary perf + debounce + media token
// ============================================================
console.log('🟢 renderer.js v8.1 yükleniyor...');

// ─── Electron modülleri ──────────────────────────────────────
let ipc = null, nodePath = null, pathToFileURL = null;
try {
    ipc = require('electron').ipcRenderer;
    nodePath = require('path');
    pathToFileURL = require('url').pathToFileURL;
    console.log('🟢 Electron modülleri yüklendi');
} catch (e) {
    console.error('🔴 Electron modülleri yüklenemedi:', e);
}

// 🎵 Medya servis bilgileri
let mediaToken = '';
let mediaOrigin = '';

// ─── Sabitler ────────────────────────────────────────────────
const RING_CIRCUMFERENCE = 2 * Math.PI * 90;
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'avi']);
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']);
const MAX_CHAT_MESSAGES = 300;
const MAX_TASK_LENGTH = 200;
const MAX_HISTORY = 50;
const SEARCH_DEBOUNCE_MS = 150;
const SUPPRESS_ERROR_MS = 500;

const $ = (id) => document.getElementById(id);

function fatalError(msg) {
    const b = $('catBubble');
    if (b) {
        b.textContent = '⚠️ ' + msg;
        b.classList.add('show');
        b.style.background = 'rgba(255,80,80,.3)';
    }
    console.error('FATAL:', msg);
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const DEFAULT_SETTINGS = {
    version: 1,
    focus: 25, break: 5, longBreak: 15, longEvery: 4,
    autoStart: false, soundAlert: true, autoDuck: false,
    sleepTimer: 0, showRemaining: false
};

let settings = { ...DEFAULT_SETTINGS };
let statsData = { version: 1, sessions: [], tasks: [], totalFocusSeconds: 0 };
let library = [];
let queue = [];

const timerState = {
    phase: 'focus',
    isRunning: false,
    timeLeft: 0,
    totalTime: 0,
    roundCount: 0,
    startedAt: null,
    remainingAtPause: 0,
    sleepDeadline: null,
    sleepTimeout: null
};

const playerState = {
    currentIndex: -1,
    shuffle: false,
    repeat: 0,
    trackVolume: 0.6,
    currentType: null,
    isPlaying: false,
    isLoading: false
};

// ─── Oynatıcı iç kontrol ─────────────────────────────────────
let _playToken = 0;
let _suppressMediaErrorsUntil = 0;   // ⚡ timestamp tabanlı
let _isSeeking = false;
let _loadTimeout = null;
let _lastEndedAt = 0;
let _seekDragging = false;
let _searchTimer = null;             // ⚡ debounce
let _renderLibraryScheduled = false; // ⚡ RAF-throttle

// ─── Tema ve UI state ────────────────────────────────────────
let currentTheme = 'midi';
let libraryViewMode = 'list';

let playHistory = [];
try {
    const raw = localStorage.getItem('kedi-history');
    if (raw) playHistory = JSON.parse(raw).filter(x => x && x.path);
} catch (e) { playHistory = []; }

let activeTaskId = null;
let ambienceMuted = false;
let ambienceVolumes = { rain: 0, thunder: 0, cafe: 0, fire: 0, wind: 0, waves: 0, birds: 0, crickets: 0, keyboard: 0 };
let masterVolume = 0.85;

// ─── Yardımcılar ─────────────────────────────────────────────
function fmtTime(s) {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function todayKey() { return new Date().toISOString().slice(0, 10); }

function weekStart() {
    const d = new Date();
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - (day - 1));
    d.setHours(0, 0, 0, 0);
    return d;
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
}

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function getFileExt(filePath) {
    if (!filePath) return '';
    const dot = filePath.lastIndexOf('.');
    return dot >= 0 ? filePath.slice(dot + 1).toLowerCase() : '';
}

function isVideoFile(fp) { return VIDEO_EXTS.has(getFileExt(fp)); }
function isAudioFile(fp) { return AUDIO_EXTS.has(getFileExt(fp)); }

function parseTrackName(rawName) {
    if (!rawName) return { title: 'Bilinmeyen', artist: '' };
    let name = rawName.replace(/^\d+[\s.\-_]+/, '').trim();
    const m = name.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (m) return { artist: m[1].trim(), title: m[2].trim() };
    name = name.replace(/_+/g, ' ').trim();
    return { title: name || rawName, artist: '' };
}

function filePathToUrl(fp) {
    if (!fp) return '';
    if (mediaOrigin && mediaToken) {
        return `${mediaOrigin}/__media?token=${mediaToken}&path=${encodeURIComponent(fp)}`;
    }
    if (pathToFileURL) return pathToFileURL(fp).href;
    return 'file:///' + fp.replace(/\\/g, '/').replace(/^\//, '');
}

function extractYouTubeId(input) {
    if (!input) return null;
    const url = input.trim();
    if (/^[a-zA-Z0-9_-]{11}$/.test(url)) return url;
    const patterns = [
        /youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
        /youtu\.be\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
        /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
        /music\.youtube\.com\/watch\?.*v=([a-zA-Z0-9_-]{11})/,
        /[?&]v=([a-zA-Z0-9_-]{11})/
    ];
    for (const pat of patterns) {
        const m = url.match(pat);
        if (m) return m[1];
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// İSTATİSTİK
// ═══════════════════════════════════════════════════════════════
function countToday() { const k = todayKey(); return statsData.sessions.filter(s => s.date === k).reduce((a, b) => a + b.count, 0); }
function countWeek() { const ws = weekStart().getTime(); return statsData.sessions.filter(s => new Date(s.date).getTime() >= ws).reduce((a, b) => a + b.count, 0); }
function countTotal() { return statsData.sessions.reduce((a, b) => a + b.count, 0); }
function fmtHours(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return h > 0 ? `${h}s ${m}dk` : `${m}dk`;
}

async function loadStats() {
    if (!ipc) return;
    try {
        const d = await ipc.invoke('stats:load');
        if (d && typeof d === 'object') {
            statsData = { version: 1, sessions: [], tasks: [], totalFocusSeconds: 0, ...d };
            statsData.sessions = statsData.sessions.filter(s => s && s.date && typeof s.count === 'number');
            statsData.tasks = statsData.tasks.filter(t => t && t.id && t.text);
        }
    } catch (e) { console.warn('stats load:', e); }
}

async function saveStats() {
    if (!ipc) return;
    try { await ipc.invoke('stats:save', statsData); } catch (e) { console.warn('stats save:', e); }
}

function addSession() {
    const k = todayKey();
    let entry = statsData.sessions.find(s => s.date === k);
    if (entry) entry.count++;
    else statsData.sessions.push({ date: k, count: 1 });
    statsData.totalFocusSeconds += settings.focus * 60;

    if (activeTaskId) {
        const task = statsData.tasks.find(t => t.id === activeTaskId);
        if (task) task.pomodoros = (task.pomodoros || 0) + 1;
    }
    saveStats();
    renderStats();
    renderTasks();
}

// ═══════════════════════════════════════════════════════════════
// KÜTÜPHANE
// ═══════════════════════════════════════════════════════════════
async function loadLibrary() {
    if (!ipc) return;
    try {
        const d = await ipc.invoke('library:load');
        if (Array.isArray(d)) {
            library = d.filter(x => x && x.path && x.id).map(t => ({ ...t, url: filePathToUrl(t.path) }));
        }
    } catch (e) { console.warn('library load:', e); }
}

async function saveLibrary() {
    if (!ipc) return;
    const clean = library.map(({ id, name, path, added }) => ({ id, name, path, added }));
    try { await ipc.invoke('library:save', clean); } catch (e) { console.warn('library save:', e); }
}

function addFilesToLibrary(files) {
    if (!files || !files.length) return;
    let added = 0;
    for (const fp of files) {
        if (!fp) continue;
        if (library.some(t => t.path === fp)) continue;
        const base = nodePath ? nodePath.basename(fp, nodePath.extname(fp)) : fp.split(/[/\\]/).pop().replace(/\.[^.]+$/, '');
        const parsed = parseTrackName(base);
        library.push({
            id: uid(),
            name: parsed.artist ? `${parsed.artist} - ${parsed.title}` : parsed.title,
            artist: parsed.artist,
            title: parsed.title,
            path: fp,
            url: filePathToUrl(fp),
            added: Date.now()
        });
        added++;
    }
    if (added > 0) {
        saveLibrary();
        renderLibrary();
        showBubble(`${added} parça eklendi 🎵`);
        toast(`✅ ${added} parça kütüphaneye eklendi`, 'success', 2500);
    }
}

// ⚡ Yeni: sadece highlight güncelle (perf)
function _updatePlayingHighlight() {
    const cur = queue[playerState.currentIndex];
    const curPath = cur ? cur.path : null;

    document.querySelectorAll('#libraryList .track-item').forEach(li => {
        const id = li.getAttribute('data-id');
        const track = library.find(t => t.id === id);
        const shouldPlay = track && curPath && track.path === curPath;
        li.classList.toggle('playing', !!shouldPlay);
    });

    document.querySelectorAll('#queueList .track-item').forEach((li, i) => {
        li.classList.toggle('playing', i === playerState.currentIndex);
    });
}

// ⚡ RAF-throttle: aynı frame'de birden fazla çağrıyı birleştir
function _scheduleRenderLibrary() {
    if (_renderLibraryScheduled) return;
    _renderLibraryScheduled = true;
    requestAnimationFrame(() => {
        _renderLibraryScheduled = false;
        renderLibrary();
    });
}

function renderLibrary() {
    const ul = $('libraryList');
    if (!ul) return;

    ul.classList.toggle('grid-view', libraryViewMode === 'grid');

    const search = ($('libSearch')?.value || '').toLowerCase().trim();
    const filtered = search
        ? library.filter(t => (t.name || '').toLowerCase().includes(search))
        : library;

    if ($('libraryCount')) {
        $('libraryCount').textContent = search
            ? `${filtered.length} / ${library.length} parça`
            : `${library.length} parça`;
    }

    if ($('clearSearch')) {
        $('clearSearch').style.display = search ? 'block' : 'none';
    }

    ul.innerHTML = '';
    if (!filtered.length) {
        const msg = library.length === 0
            ? 'Kütüphanen boş 🎵<br><small>MP3, WAV veya video dosyalarını sürükle-bırak yap ya da "Dosya"ya tıkla.</small>'
            : '🔍 Arama sonucu yok.';
        ul.innerHTML = `<li class="empty-hint" style="grid-column:1/-1">${msg}</li>`;
        return;
    }

    const cur = queue[playerState.currentIndex];
    const curPath = cur ? cur.path : null;

    const frag = document.createDocumentFragment();
    filtered.forEach((t) => {
        const li = document.createElement('li');
        const isVid = isVideoFile(t.path);
        const isCurrent = curPath && t.path === curPath;

        li.className = 'track-item' + (isCurrent ? ' playing' : '');
        li.setAttribute('data-id', t.id);

        const emoji = isVid ? '🎬' : '🎵';
        const sub = t.artist ? t.artist : (isVid ? 'Video' : 'Ses');
        const badge = isVid ? 'VIDEO' : 'AUDIO';

        li.innerHTML = `
            <div class="trk-cover">${emoji}</div>
            <span class="trk-name" title="${escapeHtml(t.path)}">
                ${escapeHtml(t.title || t.name)}
                <span class="trk-sub">${escapeHtml(sub)}</span>
            </span>
            <span class="trk-badge">${badge}</span>
            <button class="trk-act add" title="Kuyruğa ekle" aria-label="Kuyruğa ekle">＋</button>
            <button class="trk-act play" title="Çal" aria-label="Çal">▶</button>
            <button class="trk-act del" title="Sil" aria-label="Sil">✕</button>`;

        li.querySelector('.add').onclick = (e) => {
            e.stopPropagation();
            enqueueLocal(t, false);
            toast(`${t.title || t.name} kuyruğa eklendi`, 'success', 2000);
        };
        li.querySelector('.play').onclick = (e) => { e.stopPropagation(); enqueueLocal(t, true); };
        li.querySelector('.del').onclick = (e) => {
            e.stopPropagation();
            library = library.filter(x => x.id !== t.id);
            saveLibrary();
            renderLibrary();
            toast('Kütüphaneden kaldırıldı', 'info', 1800);
        };
        li.ondblclick = () => enqueueLocal(t, true);
        li.onclick = (e) => {
            if (e.target.closest('button')) return;
            enqueueLocal(t, false);
        };

        frag.appendChild(li);
    });
    ul.appendChild(frag);
}

// ═══════════════════════════════════════════════════════════════
// KUYRUK
// ═══════════════════════════════════════════════════════════════
function enqueueLocal(track, playNow = false) {
    const item = {
        id: uid(),
        type: 'local',
        name: track.name,
        path: track.path,
        url: track.url || filePathToUrl(track.path)
    };
    queue.push(item);
    renderQueue();
    if (playNow) {
        playerState.currentIndex = queue.length - 1;
        playCurrent();
    } else if (playerState.currentIndex === -1 && !playerState.isPlaying) {
        playerState.currentIndex = 0;
        playCurrent();
    }
}

function enqueueYoutube(urlOrId) {
    const id = extractYouTubeId(urlOrId);
    if (!id) { showBubble('⚠️ Geçersiz YouTube URL'); return false; }
    if (queue.some(q => q.type === 'youtube' && q.videoId === id)) {
        showBubble('Bu video zaten kuyruğa ekli');
        return false;
    }
    queue.push({
        id: uid(),
        type: 'youtube',
        name: 'YouTube: ' + id,
        videoId: id,
        url: `https://www.youtube.com/watch?v=${id}`
    });
    renderQueue();
    if (playerState.currentIndex === -1) {
        playerState.currentIndex = 0;
        playCurrent();
    }
    return true;
}

function renderQueue() {
    const ul = $('queueList');
    if (!ul) return;
    ul.innerHTML = '';
    if (!queue.length) {
        ul.innerHTML = '<li class="empty-hint">Kuyruk boş.<br><small>Kütüphaneden ekle veya YouTube URL gir.</small></li>';
        if ($('queueCount')) $('queueCount').textContent = '';
        return;
    }
    const frag = document.createDocumentFragment();
    queue.forEach((t, i) => {
        const li = document.createElement('li');
        const isVid = t.type === 'local' && isVideoFile(t.path);
        const isYt = t.type === 'youtube';
        const isCurrent = i === playerState.currentIndex;
        li.className = 'track-item' + (isCurrent ? ' playing' : '');
        li.innerHTML = `
            <div class="trk-cover">${isYt ? '📺' : (isVid ? '🎬' : '🎵')}</div>
            <span class="trk-name">
                ${escapeHtml(t.name)}
                <span class="trk-sub">${isYt ? 'YouTube' : (isVid ? 'Video' : 'Yerel')}</span>
            </span>
            <span class="trk-badge ${isYt ? 'yt' : ''}">${isYt ? 'YT' : 'LOCAL'}</span>
            <button class="trk-act del" title="Kaldır" aria-label="Kaldır">✕</button>`;
        li.onclick = () => { playerState.currentIndex = i; playCurrent(); };
        li.querySelector('.del').onclick = (e) => {
            e.stopPropagation();
            queue.splice(i, 1);
            if (i < playerState.currentIndex) playerState.currentIndex--;
            else if (i === playerState.currentIndex) {
                stopPlayback();
                playerState.currentIndex = Math.min(playerState.currentIndex, queue.length - 1);
            }
            renderQueue();
        };
        frag.appendChild(li);
    });
    ul.appendChild(frag);
    if ($('queueCount')) {
        $('queueCount').textContent = `${queue.length} parça`;
    }
}

// ═══════════════════════════════════════════════════════════════
// 🎵 OYNATICI
// ═══════════════════════════════════════════════════════════════
const localMedia = $('localMedia');

function _isStale(token) { return token !== _playToken; }

function _effectiveVolume() {
    const shouldDuck = settings.autoDuck
        && timerState.isRunning
        && timerState.phase === 'focus';
    return shouldDuck ? playerState.trackVolume * 0.3 : playerState.trackVolume;
}

function _fadeVolume(el, target, durMs = 400) {
    if (!el) return;
    const start = el.volume;
    const startT = performance.now();
    function step(t) {
        const p = Math.min(1, (t - startT) / durMs);
        const e = 1 - Math.pow(1 - p, 3);
        try { el.volume = Math.max(0, Math.min(1, start + (target - start) * e)); } catch (_) { }
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function _applyVolume() {
    if (!localMedia) return;
    if (playerState.currentType === 'youtube') return;
    const target = _effectiveVolume();
    if (Math.abs(localMedia.volume - target) > 0.01) {
        _fadeVolume(localMedia, target, 700);
    }
}

// ⚡ Token tabanlı suppress
function _safeClearMedia() {
    if (!localMedia) return;
    _suppressMediaErrorsUntil = performance.now() + SUPPRESS_ERROR_MS;
    try {
        localMedia.pause();
        localMedia.removeAttribute('src');
        localMedia.load();
    } catch (e) { }
}

function _isSuppressingErrors() {
    return performance.now() < _suppressMediaErrorsUntil;
}

function getYouTubeOrigin() {
    try { return encodeURIComponent(location.origin || 'http://127.0.0.1'); }
    catch (e) { return 'http%3A%2F%2F127.0.0.1'; }
}

// ─── Media Session ──────────────────────────────────────────
function updateMediaSession(t) {
    if (!('mediaSession' in navigator)) return;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: t.title || t.name || 'Bilinmeyen',
            artist: t.artist || (t.type === 'youtube' ? 'YouTube' : 'Kedi Lo-Fi'),
            album: 'Kedi Lo-Fi Pomodoro 🐾',
            artwork: [
                { src: 'assets/kedu.png', sizes: '256x256', type: 'image/png' }
            ]
        });
    } catch (e) { }
}

function _setupMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    try {
        ms.setActionHandler('play', () => { if (!playerState.isPlaying) togglePlayTrack(); });
        ms.setActionHandler('pause', () => { if (playerState.isPlaying) togglePlayTrack(); });
        ms.setActionHandler('previoustrack', () => prevTrack());
        ms.setActionHandler('nexttrack', () => nextTrack());
        ms.setActionHandler('seekbackward', (d) => { if (localMedia) localMedia.currentTime = Math.max(0, localMedia.currentTime - (d.seekOffset || 10)); });
        ms.setActionHandler('seekforward', (d) => { if (localMedia && isFinite(localMedia.duration)) localMedia.currentTime = Math.min(localMedia.duration, localMedia.currentTime + (d.seekOffset || 10)); });
        ms.setActionHandler('seekto', (d) => { if (localMedia && d.seekTime != null) localMedia.currentTime = d.seekTime; });
    } catch (e) { }
}

function _setPlaybackState(state) {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = state; } catch (_) { }
}

// ─── Başlık güncelle ────────────────────────────────────────
function updateWindowTitle() {
    const t = queue[playerState.currentIndex];
    if (t && playerState.isPlaying) {
        const prefix = playerState.isLoading ? '⏳ ' : '🎵 ';
        document.title = `${prefix}${t.name} — Kedi Lo-Fi`;
    } else if (timerState.isRunning) {
        document.title = `⏱ ${fmtTime(timerState.timeLeft)} — ${phaseLabelShort()} 🐾`;
    } else {
        document.title = 'Kedi Lo-Fi Pomodoro 🐾';
    }
}

// ═══════════════════════════════════════════════════════════════
// 🎯 OYNATMA ÇEKIRDEĞİ
// ═══════════════════════════════════════════════════════════════
function playCurrent() {
    const { currentIndex } = playerState;
    if (!queue.length || currentIndex < 0 || currentIndex >= queue.length) {
        stopPlayback();
        return;
    }
    const t = queue[currentIndex];
    const isYt = t.type === 'youtube';
    const isVid = isVideoFile(t.path);

    if ($('trackTitle')) $('trackTitle').textContent = t.name;
    if ($('trackArtist')) $('trackArtist').textContent = isYt ? 'YouTube'
        : (t.artist ? t.artist : (isVid ? 'Video' : 'Yerel dosya'));
    if ($('trackCover')) $('trackCover').textContent = isYt ? '📺' : (isVid ? '🎬' : '🎵');

    playerState.isLoading = true;
    updateWindowTitle();

    if (isYt) {
        _playYouTube(t);
    } else {
        _playLocal(t);
    }

    playerState.isPlaying = true;
    if ($('playPauseTrack')) $('playPauseTrack').textContent = '⏸';
    _setPlaybackState('playing');
    updateMediaSession(t);
    _pushHistory(t);
    renderQueue();
    // ⚡ Full re-render yerine sadece highlight
    _updatePlayingHighlight();
    _setVisualizerActive(true);
}

function _playLocal(t) {
    _hideYouTube();
    if (!localMedia) return;

    const myToken = ++_playToken;
    const isVideo = isVideoFile(t.path);
    playerState.currentType = isVideo ? 'video' : 'audio';

    if ($('localMediaArea')) $('localMediaArea').style.display = isVideo ? 'block' : 'none';

    _safeClearMedia();

    if ($('seekBar')) $('seekBar').value = 0;
    if ($('curTime')) $('curTime').textContent = '0:00';
    if ($('durTime')) $('durTime').textContent = '0:00';

    const url = t.url || filePathToUrl(t.path);
    localMedia.volume = 0;
    localMedia.src = url;

    if (_loadTimeout) clearTimeout(_loadTimeout);
    _loadTimeout = setTimeout(() => {
        if (_isStale(myToken)) return;
        if (localMedia.readyState < 2) {
            console.warn('⏱ Yükleme zaman aşımı:', t.name);
            showBubble('⚠️ Dosya açılamadı');
            playerState.isLoading = false;
            nextTrack(true);
        }
    }, 12000);

    const p = localMedia.play();
    if (p && typeof p.then === 'function') {
        p.then(() => {
            if (_isStale(myToken)) return;
            playerState.isLoading = false;
            if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }
            _fadeVolume(localMedia, _effectiveVolume(), 500);
            updateWindowTitle();
        }).catch(e => {
            if (_isStale(myToken)) return;
            playerState.isLoading = false;
            if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }

            if (e.name === 'AbortError') return;
            if (e.name === 'NotAllowedError') {
                showBubble('🔇 Otomatik oynatma engellendi, tıkla');
                playerState.isPlaying = false;
                if ($('playPauseTrack')) $('playPauseTrack').textContent = '▶';
                _setPlaybackState('paused');
                _setVisualizerActive(false);
                return;
            }
            console.warn('🎵 play() reddedildi:', e.name, e.message);
            showBubble('⚠️ Dosya oynatılamadı');
            setTimeout(() => nextTrack(true), 800);
        });
    }
}

function _playYouTube(t) {
    ++_playToken;
    _safeClearMedia();
    if ($('localMediaArea')) $('localMediaArea').style.display = 'none';

    if ($('youtubeArea')) $('youtubeArea').style.display = 'flex';
    if ($('youtubePlayer')) {
        $('youtubePlayer').innerHTML = `<iframe
            src="https://www.youtube-nocookie.com/embed/${t.videoId}?autoplay=1&rel=0&modestbranding=1&playsinline=1&enablejsapi=1"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
            frameborder="0"
            title="${escapeHtml(t.name)}"></iframe>`;
    }
    playerState.currentType = 'youtube';
    playerState.isLoading = false;
    updateWindowTitle();
}

function _hideYouTube() {
    if ($('youtubeArea')) $('youtubeArea').style.display = 'none';
    if ($('youtubePlayer')) $('youtubePlayer').innerHTML = '';
}

function stopPlayback() {
    ++_playToken;
    playerState.isPlaying = false;
    playerState.isLoading = false;
    playerState.currentType = null;

    if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }

    _safeClearMedia();
    _hideYouTube();
    if ($('localMediaArea')) $('localMediaArea').style.display = 'none';

    if ($('playPauseTrack')) $('playPauseTrack').textContent = '▶';
    if ($('trackTitle')) $('trackTitle').textContent = 'Şarkı yok';
    if ($('trackArtist')) $('trackArtist').textContent = 'Kütüphaneden ekle veya YouTube URL gir';
    if ($('trackCover')) $('trackCover').textContent = '🎵';
    if ($('curTime')) $('curTime').textContent = '0:00';
    if ($('durTime')) $('durTime').textContent = '0:00';
    if ($('seekBar')) $('seekBar').value = 0;

    _setPlaybackState('none');
    _setVisualizerActive(false);
    updateWindowTitle();
    renderQueue();
    _updatePlayingHighlight();
}

function togglePlayTrack() {
    if (!queue.length) return;
    if (playerState.currentIndex === -1) {
        playerState.currentIndex = 0;
        playCurrent();
        return;
    }
    const t = queue[playerState.currentIndex];
    if (!t) return;

    if (t.type === 'local' && localMedia) {
        if (localMedia.paused) {
            localMedia.play().catch(e => console.warn('play:', e));
            playerState.isPlaying = true;
            if ($('playPauseTrack')) $('playPauseTrack').textContent = '⏸';
            _setPlaybackState('playing');
            _applyVolume();
            _setVisualizerActive(true);
        } else {
            localMedia.pause();
            playerState.isPlaying = false;
            if ($('playPauseTrack')) $('playPauseTrack').textContent = '▶';
            _setPlaybackState('paused');
            _setVisualizerActive(false);
        }
        updateWindowTitle();
    } else if (t.type === 'youtube') {
        const area = $('youtubeArea');
        if (area) {
            const hidden = area.style.display === 'none';
            area.style.display = hidden ? 'flex' : 'none';
            playerState.isPlaying = hidden;
            if ($('playPauseTrack')) $('playPauseTrack').textContent = hidden ? '⏸' : '▶';
            _setPlaybackState(hidden ? 'playing' : 'paused');
            _setVisualizerActive(hidden);
        }
    }
}

// ═══════════════════════════════════════════════════════════════
// 🎯 MERKEZI İLERLEME
// ═══════════════════════════════════════════════════════════════
function _restartCurrent() {
    const t = queue[playerState.currentIndex];
    if (!t) { playCurrent(); return; }
    if (t.type === 'local' && localMedia && playerState.currentType !== 'youtube') {
        try { localMedia.currentTime = 0; } catch (e) { }
        localMedia.play().catch(() => { });
    } else {
        playCurrent();
    }
}

function _advance(direction, isAuto = false) {
    if (!queue.length) { stopPlayback(); return; }

    const n = queue.length;
    const cur = playerState.currentIndex;

    if (direction > 0 && playerState.repeat === 2) {
        _restartCurrent();
        return;
    }

    let next;

    if (n === 1) {
        next = 0;
        if (direction > 0) {
            _restartCurrent();
            return;
        }
    } else if (playerState.shuffle) {
        do { next = Math.floor(Math.random() * n); } while (next === cur);
    } else if (direction > 0) {
        next = cur + 1;
        if (next >= n) next = 0;
    } else {
        next = cur - 1;
        if (next < 0) next = n - 1;
    }

    playerState.currentIndex = next;
    playCurrent();
}

function nextTrack(auto = false) { _advance(1, auto); }

function prevTrack() {
    if (localMedia && playerState.currentType !== 'youtube') {
        if (localMedia.currentTime > 3) {
            localMedia.currentTime = 0;
            return;
        }
    }
    _advance(-1, false);
}

// ═══════════════════════════════════════════════════════════════
// 🎵 MEDYA OLAYLARI
// ═══════════════════════════════════════════════════════════════
if (localMedia) {
    localMedia.addEventListener('timeupdate', () => {
        if (_isSeeking) return;
        if (!localMedia.duration || !isFinite(localMedia.duration)) return;
        const pct = (localMedia.currentTime / localMedia.duration) * 100;
        if ($('seekBar')) $('seekBar').value = pct;
        if ($('curTime')) $('curTime').textContent = fmtTime(localMedia.currentTime);
        if (Math.floor(localMedia.currentTime) !== Math.floor(localMedia._lastTitleTime || -1)) {
            localMedia._lastTitleTime = localMedia.currentTime;
            updateWindowTitle();
        }
    });

    localMedia.addEventListener('loadedmetadata', () => {
        if ($('durTime')) $('durTime').textContent = fmtTime(localMedia.duration);
        if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }
        playerState.isLoading = false;
        updateWindowTitle();
    });

    localMedia.addEventListener('canplay', () => {
        if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }
        playerState.isLoading = false;
        updateWindowTitle();
    });

    localMedia.addEventListener('ended', () => {
        const now = Date.now();
        if (now - _lastEndedAt < 500) {
            console.log('⏭ ended spam engellendi');
            return;
        }
        _lastEndedAt = now;
        console.log('⏭ ended → otomatik sonraki');
        _advance(1, true);
    });

    localMedia.addEventListener('play', () => { _setPlaybackState('playing'); });
    localMedia.addEventListener('pause', () => { if (!localMedia.ended) _setPlaybackState('paused'); });

    localMedia.addEventListener('error', () => {
        // ⚡ Token tabanlı suppress
        if (_isSuppressingErrors()) return;

        const err = localMedia.error;
        const code = err?.code;
        const msg = err?.message || '';

        if (code === 1) return;
        if (code === 4 && !localMedia.currentSrc) return;

        console.warn('🎵 Medya hatası:', code, msg);

        if (_loadTimeout) { clearTimeout(_loadTimeout); _loadTimeout = null; }
        showBubble('⚠️ Dosya oynatılamadı');
        setTimeout(() => _advance(1, true), 800);
    });
}

// ─── Seek bar ───────────────────────────────────────────────
if ($('seekBar')) {
    const seekBar = $('seekBar');

    const _applySeek = (val) => {
        if (!localMedia || !isFinite(localMedia.duration)) return;
        const time = (parseFloat(val) / 100) * localMedia.duration;
        try { localMedia.currentTime = time; } catch (e) { console.warn('seek:', e); }
    };

    seekBar.addEventListener('mousedown', () => { _seekDragging = true; _isSeeking = true; });
    seekBar.addEventListener('touchstart', () => { _seekDragging = true; _isSeeking = true; }, { passive: true });

    seekBar.addEventListener('input', (e) => {
        _isSeeking = true;
        if (localMedia && isFinite(localMedia.duration)) {
            const t = (parseFloat(e.target.value) / 100) * localMedia.duration;
            if ($('curTime')) $('curTime').textContent = fmtTime(t);
        }
    });

    seekBar.addEventListener('change', (e) => {
        _applySeek(e.target.value);
        setTimeout(() => { _isSeeking = false; _seekDragging = false; }, 200);
    });

    seekBar.addEventListener('mouseup', (e) => {
        if (_seekDragging) _applySeek(e.target.value);
        setTimeout(() => { _isSeeking = false; _seekDragging = false; }, 200);
    });
    seekBar.addEventListener('touchend', (e) => {
        if (_seekDragging && e.target.value != null) _applySeek(e.target.value);
        setTimeout(() => { _isSeeking = false; _seekDragging = false; }, 200);
    });
    seekBar.addEventListener('blur', () => { _isSeeking = false; _seekDragging = false; });
}

// ─── Ses ────────────────────────────────────────────────────
if ($('volTrack')) {
    $('volTrack').addEventListener('input', (e) => {
        playerState.trackVolume = parseFloat(e.target.value);
        if ($('valTrack')) $('valTrack').textContent = Math.round(playerState.trackVolume * 100) + '%';
        if (localMedia && playerState.currentType === 'audio') {
            localMedia.volume = _effectiveVolume();
        }
        _updateVolIcon();
        try { localStorage.setItem('kedi-track-vol', String(playerState.trackVolume)); } catch (_) { }
    });
}

// ─── History ────────────────────────────────────────────────
function _pushHistory(t) {
    if (!t || !t.path) return;
    playHistory = playHistory.filter(h => h.path !== t.path);
    playHistory.unshift({ name: t.name, path: t.path, at: Date.now() });
    if (playHistory.length > MAX_HISTORY) playHistory = playHistory.slice(0, MAX_HISTORY);
    try { localStorage.setItem('kedi-history', JSON.stringify(playHistory)); } catch (e) { }
    renderHistory();
}

function renderHistory() {
    const ul = $('historyList');
    if (!ul) return;
    ul.innerHTML = '';
    if (!playHistory.length) {
        ul.innerHTML = '<li class="empty-hint">Henüz bir şey çalınmadı 🎵</li>';
        return;
    }
    const frag = document.createDocumentFragment();
    playHistory.forEach((h, i) => {
        const li = document.createElement('li');
        li.className = 'track-item';
        const d = new Date(h.at);
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        li.innerHTML = `
            <div class="trk-cover">🎵</div>
            <span class="trk-name">
                ${escapeHtml(h.name)}
                <span class="trk-sub">${timeStr}</span>
            </span>
            <button class="trk-act play" title="Çal">▶</button>`;
        li.querySelector('.play').onclick = (e) => {
            e.stopPropagation();
            const inLib = library.find(t => t.path === h.path);
            if (inLib) { enqueueLocal(inLib, true); return; }
            queue.push({
                id: uid(), type: 'local',
                name: h.name, path: h.path, url: filePathToUrl(h.path)
            });
            playerState.currentIndex = queue.length - 1;
            renderQueue();
            playCurrent();
        };
        frag.appendChild(li);
    });
    ul.appendChild(frag);
}

// ═══════════════════════════════════════════════════════════════
// AMBİYANS
// ═══════════════════════════════════════════════════════════════
function ambiencePlay() {
    if (ambienceMuted) return;
    const se = window.soundEngine;
    if (!se) return;
    se.init();
    se.resume();
    const starters = {
        rain: 'startRain', thunder: 'startThunder', cafe: 'startCafe',
        fire: 'startFire', wind: 'startWind', waves: 'startWaves',
        birds: 'startBirds', crickets: 'startCrickets', keyboard: 'startKeyboard'
    };
    Object.keys(ambienceVolumes).forEach(k => {
        if (ambienceVolumes[k] > 0 && starters[k] && typeof se[starters[k]] === 'function') {
            se[starters[k]](ambienceVolumes[k]);
        }
    });
}

function ambienceStop() {
    const se = window.soundEngine;
    if (se) se.stopAll();
}

function bindAmbienceSlider(inputId, key, valId) {
    const input = $(inputId), val = $(valId);
    if (!input) return;
    input.addEventListener('input', (e) => {
        const v = parseFloat(e.target.value);
        ambienceVolumes[key] = v;
        if (val) val.textContent = Math.round(v * 100) + '%';
        const se = window.soundEngine;
        if (!se) return;
        se.init(); se.resume();
        const fnName = 'start' + key.charAt(0).toUpperCase() + key.slice(1);
        if (v > 0) {
            if (typeof se[fnName] === 'function') se[fnName](v);
        } else {
            se.setVolume(key, 0);
            setTimeout(() => { if (se.isChannelActive && !se.isChannelActive(key)) return; se.stop(key); }, 400);
        }
    });
}

bindAmbienceSlider('volRain', 'rain', 'valRain');
bindAmbienceSlider('volThunder', 'thunder', 'valThunder');
bindAmbienceSlider('volCafe', 'cafe', 'valCafe');
bindAmbienceSlider('volFire', 'fire', 'valFire');
bindAmbienceSlider('volWind', 'wind', 'valWind');
bindAmbienceSlider('volWaves', 'waves', 'valWaves');
bindAmbienceSlider('volBirds', 'birds', 'valBirds');
bindAmbienceSlider('volCrickets', 'crickets', 'valCrickets');
bindAmbienceSlider('volKeyboard', 'keyboard', 'valKeyboard');

if ($('masterVol')) {
    $('masterVol').addEventListener('input', (e) => {
        masterVolume = parseFloat(e.target.value);
        if ($('valMaster')) $('valMaster').textContent = Math.round(masterVolume * 100) + '%';
        if (window.soundEngine) window.soundEngine.setMasterVolume(masterVolume);
    });
}

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const se = window.soundEngine;
        if (!se) return;
        se.init(); se.resume();
        const preset = se.applyPreset(btn.dataset.preset);
        if (!preset) return;
        Object.keys(preset).forEach(key => {
            if (key in ambienceVolumes) {
                ambienceVolumes[key] = preset[key];
                const capKey = key.charAt(0).toUpperCase() + key.slice(1);
                const input = $('vol' + capKey), valEl = $('val' + capKey);
                if (input) input.value = preset[key];
                if (valEl) valEl.textContent = Math.round(preset[key] * 100) + '%';
            }
        });
        showBubble(`🎯 ${btn.textContent.trim()} modu`);
    });
});

if ($('muteBtn')) {
    $('muteBtn').addEventListener('click', () => {
        ambienceMuted = !ambienceMuted;
        const se = window.soundEngine;
        if (se) se.setMuted(ambienceMuted);
        if (ambienceMuted) ambienceStop();
        else if (timerState.isRunning) ambiencePlay();
        $('muteBtn').textContent = ambienceMuted ? '🔊 Ambiyansı Aç (M)' : '🔇 Tümünü Sessize Al (M)';
    });
}

// ═══════════════════════════════════════════════════════════════
// POMODORO TIMER
// ═══════════════════════════════════════════════════════════════
let _rafHandle = null;

function durationFor(p) {
    if (p === 'focus') return settings.focus * 60;
    if (p === 'break') return settings.break * 60;
    return settings.longBreak * 60;
}

function phaseLabel() {
    if (timerState.phase === 'focus') return '🎯 Odak';
    if (timerState.phase === 'break') return '☕ Kısa Mola';
    return '🌙 Uzun Mola';
}

function phaseLabelShort() {
    if (timerState.phase === 'focus') return 'ODAK';
    if (timerState.phase === 'break') return 'KISA MOLA';
    return 'UZUN MOLA';
}

function _timerLoop() {
    if (!timerState.isRunning) return;
    const now = Date.now();
    const elapsed = (now - timerState.startedAt) / 1000;
    const remaining = Math.max(0, timerState.remainingAtPause - elapsed);
    timerState.timeLeft = remaining;
    updateDisplay();
    if (remaining <= 0) {
        timerState.timeLeft = 0;
        completePhase();
        return;
    }
    _rafHandle = requestAnimationFrame(_timerLoop);
}

function start() {
    if (timerState.isRunning) return;
    if (_rafHandle) { cancelAnimationFrame(_rafHandle); _rafHandle = null; }

    if (timerState.timeLeft <= 0) {
        timerState.timeLeft = timerState.totalTime = durationFor(timerState.phase);
    }
    timerState.isRunning = true;
    timerState.startedAt = Date.now();
    timerState.remainingAtPause = timerState.timeLeft;

    const ca = $('catArea');
    if (ca) {
        ca.classList.remove('sleeping');
        ca.classList.add('stretching');
        setTimeout(() => ca.classList.remove('stretching'), 1200);
    }
    ambiencePlay();
    _applyVolume();
    _updateButtons();
    _rafHandle = requestAnimationFrame(_timerLoop);
    updateDisplay();
    updateWindowTitle();
}

function pause() {
    if (!timerState.isRunning) return;
    timerState.isRunning = false;
    if (_rafHandle) { cancelAnimationFrame(_rafHandle); _rafHandle = null; }
    const elapsed = (Date.now() - timerState.startedAt) / 1000;
    timerState.remainingAtPause = Math.max(0, timerState.remainingAtPause - elapsed);
    timerState.timeLeft = timerState.remainingAtPause;
    ambienceStop();
    _applyVolume();
    _updateButtons();
    updateDisplay();
    updateWindowTitle();
}

function reset() {
    pause();
    timerState.timeLeft = timerState.totalTime = timerState.remainingAtPause = durationFor(timerState.phase);
    updateDisplay();
    updateWindowTitle();
}

function skip() { completePhase(); }

function completePhase() {
    timerState.isRunning = false;
    if (_rafHandle) { cancelAnimationFrame(_rafHandle); _rafHandle = null; }
    ambienceStop();

    if (settings.soundAlert && window.soundEngine) {
        window.soundEngine.playComplete();
    }

    if (timerState.phase === 'focus') {
        addSession();
        timerState.roundCount++;
        renderRoundDots();
        const isLong = (timerState.roundCount % settings.longEvery) === 0;
        timerState.phase = isLong ? 'longbreak' : 'break';
        document.body.classList.remove('phase-focus');
        document.body.classList.toggle('phase-longbreak', isLong);
        document.body.classList.toggle('phase-break', !isLong);
        const ca = $('catArea');
        if (ca) ca.classList.add('sleeping');
        showBubble(isLong ? '🌙 Uzun mola zamanı!' : '☕ Mola zamanı!', 3000);
        _notify('Odak Tamamlandı! 🐾', isLong ? '🌙 Uzun mola zamanı.' : '☕ Kısa mola zamanı.');
        toast(isLong ? '🌙 Uzun mola zamanı!' : '☕ Kısa mola zamanı!', 'success', 4000);
    } else {
        timerState.phase = 'focus';
        document.body.classList.remove('phase-break', 'phase-longbreak');
        document.body.classList.add('phase-focus');
        const ca = $('catArea');
        if (ca) ca.classList.remove('sleeping');
        showBubble('🎯 Odak başlıyor!', 3000);
        _notify('Mola Bitti! 🌙', 'Odaklanma zamanı.');
        toast('🎯 Odaklanma zamanı!', 'success', 4000);
    }

    timerState.timeLeft = timerState.totalTime = timerState.remainingAtPause = durationFor(timerState.phase);
    if ($('phase')) $('phase').textContent = phaseLabelShort();
    _updateButtons();
    updateDisplay();
    _applyVolume();
    updateWindowTitle();

    if (settings.autoStart) setTimeout(start, 1500);
}

function _notify(title, body) {
    if (!ipc) return;
    try { ipc.send('notify', { title, body }); } catch (e) { }
}

function _updateButtons() {
    const startBtn = $('startBtn'), pauseBtn = $('pauseBtn');
    if (startBtn) startBtn.style.display = timerState.isRunning ? 'none' : '';
    if (pauseBtn) pauseBtn.style.display = timerState.isRunning ? '' : 'none';
}

function updateDisplay() {
    if ($('timer')) $('timer').textContent = fmtTime(timerState.timeLeft);
    const ring = $('ringProgress');
    if (ring && timerState.totalTime > 0) {
        const ratio = timerState.timeLeft / timerState.totalTime;
        ring.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - ratio);
    }
    if ($('roundLabel')) {
        $('roundLabel').textContent = `${(timerState.roundCount % settings.longEvery) + 1} / ${settings.longEvery}`;
    }
    if (ipc) {
        try {
            ipc.send('tray:update', {
                isRunning: timerState.isRunning,
                phaseLabel: `${phaseLabel()} — ${fmtTime(timerState.timeLeft)}`,
                tooltip: `Kedi Lo-Fi Pomodoro\n${phaseLabel()} — ${fmtTime(timerState.timeLeft)}`
            });
        } catch (e) { }
    }
    if (!playerState.isPlaying) updateWindowTitle();
}

function renderRoundDots() {
    const el = $('roundDots');
    if (!el) return;
    el.innerHTML = '';
    const completed = timerState.roundCount % settings.longEvery;
    for (let i = 0; i < settings.longEvery; i++) {
        const s = document.createElement('span');
        if (i < completed) s.classList.add('filled');
        el.appendChild(s);
    }
    if ($('roundLabel')) {
        $('roundLabel').textContent = `${completed + 1} / ${settings.longEvery}`;
    }
}

// ─── Uyku zamanlayıcı ──────────────────────────────────────
function setSleepTimer(minutes) {
    if (timerState.sleepTimeout) {
        clearTimeout(timerState.sleepTimeout);
        timerState.sleepTimeout = null;
    }
    timerState.sleepDeadline = null;

    if (!minutes || minutes <= 0) {
        showBubble('⏰ Uyku zamanlayıcı kapatıldı');
        return;
    }
    timerState.sleepDeadline = Date.now() + minutes * 60 * 1000;
    timerState.sleepTimeout = setTimeout(() => {
        stopPlayback();
        ambienceStop();
        showBubble('⏰ Uyku zamanlayıcı: Müzik durduruldu', 4000);
        toast('⏰ Uyku zamanlayıcı: Müzik durduruldu', 'info', 5000);
        _notify('⏰ Uyku Zamanı', 'Müzik otomatik durduruldu.');
        timerState.sleepDeadline = null;
        timerState.sleepTimeout = null;
        if ($('setSleepTimer')) $('setSleepTimer').value = '0';
    }, minutes * 60 * 1000);
    showBubble(`⏰ ${minutes} dakika sonra duracak`);
    toast(`⏰ ${minutes} dk sonra müzik duracak`, 'success', 2500);
}

function toggleFullscreen() {
    const isFs = document.body.classList.toggle('fullscreen');
    if (isFs && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => { });
    } else if (!isFs && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => { });
    }
}

// ═══════════════════════════════════════════════════════════════
// KICK
// ═══════════════════════════════════════════════════════════════
function addChatMessage(sender, content, isCmd = false) {
    const log = $('chatLog');
    if (!log) return;
    const empty = log.querySelector('.empty-hint');
    if (empty) empty.remove();
    const d = document.createElement('div');
    d.className = 'chat-msg' + (isCmd ? ' cmd' : '');
    d.innerHTML = `<span class="sender">${escapeHtml(sender)}:</span> ${escapeHtml(content)}`;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    while (log.children.length > MAX_CHAT_MESSAGES) log.removeChild(log.firstChild);
}

function handleKickMessage(sender, content) {
    const trimmed = content.trim();
    if (!trimmed) return;
    addChatMessage(sender, trimmed);
    const lower = trimmed.toLowerCase();
    const commands = ['!sr ', '!song ', '!şarkı ', '!sarki '];
    for (const cmd of commands) {
        if (lower.startsWith(cmd)) {
            const query = trimmed.slice(cmd.length).trim();
            if (!query) return;
            addChatMessage(sender, `🎵 İstek: ${query}`, true);
            const ytId = extractYouTubeId(query);
            if (ytId) {
                enqueueYoutube(ytId);
                addChatMessage('🤖', `YouTube kuyruğa eklendi: ${ytId}`, true);
            } else {
                const found = library.find(t => (t.name || '').toLowerCase().includes(query.toLowerCase()));
                if (found) {
                    enqueueLocal(found, false);
                    addChatMessage('🤖', `Kütüphaneden eklendi: ${found.name}`, true);
                } else {
                    addChatMessage('🤖', `Bulunamadı: ${query}`, true);
                }
            }
            return;
        }
    }
}

function attachKickHandlers() {
    if (!window.kickChat) { console.warn('kickChat modülü yok'); return; }
    window.kickChat.onMessage = handleKickMessage;
    window.kickChat.onStatus = (cls, msg) => {
        const el = $('liveStatus');
        const btn = $('connectKick');
        if (el) {
            el.className = 'live-status' + (cls === 'on' ? ' on' : cls === 'err' ? ' err' : cls === 'connecting' ? ' connecting' : '');
            el.textContent = msg;
        }
        if (btn) btn.textContent = window.kickChat.connected ? 'Kes' : 'Bağlan';
    };
}

// ═══════════════════════════════════════════════════════════════
// GÖREVLER
// ═══════════════════════════════════════════════════════════════
function addTask() {
    const input = $('taskInput');
    if (!input) return;
    const text = input.value.trim().slice(0, MAX_TASK_LENGTH);
    if (!text) return;
    statsData.tasks.push({ id: uid(), text, done: false, pomodoros: 0, created: Date.now() });
    input.value = '';
    saveStats();
    renderTasks();
}

function renderTasks() {
    const ul = $('taskList');
    if (!ul) return;
    ul.innerHTML = '';
    const active = statsData.tasks.filter(t => !t.done);
    const done = statsData.tasks.filter(t => t.done);
    const sorted = [...active, ...done];
    if (!sorted.length) {
        ul.innerHTML = '<li class="empty-hint">Bugün neye odaklanacaksın? 🐾<br><small>Görev ekleyerek odaklanma süreni takip et.</small></li>';
        return;
    }
    const frag = document.createDocumentFragment();
    for (const t of sorted) {
        const li = document.createElement('li');
        li.className = 'task-item' + (t.done ? ' done' : '') + (t.id === activeTaskId ? ' active' : '');
        li.innerHTML = `
            <input type="checkbox" ${t.done ? 'checked' : ''} aria-label="Görevi tamamla">
            <span class="task-text">${escapeHtml(t.text)}</span>
            <span class="task-pomo" title="${t.pomodoros || 0} Pomodoro">🍅 ${t.pomodoros || 0}</span>
            <button class="task-del" aria-label="Görevi sil">✕</button>`;
        li.querySelector('input[type="checkbox"]').addEventListener('change', (e) => {
            t.done = e.target.checked; saveStats(); renderTasks();
        });
        li.querySelector('.task-del').addEventListener('click', (e) => {
            e.stopPropagation();
            statsData.tasks = statsData.tasks.filter(x => x.id !== t.id);
            if (activeTaskId === t.id) activeTaskId = null;
            saveStats(); renderTasks();
        });
        li.addEventListener('click', (e) => {
            if (e.target.matches('input, button')) return;
            activeTaskId = activeTaskId === t.id ? null : t.id;
            renderTasks();
        });
        frag.appendChild(li);
    }
    ul.appendChild(frag);
}

function renderStats() {
    if ($('statToday')) $('statToday').textContent = countToday();
    if ($('statWeek')) $('statWeek').textContent = countWeek();
    if ($('statTotal')) $('statTotal').textContent = countTotal();
    if ($('statHours')) $('statHours').textContent = fmtHours(statsData.totalFocusSeconds || 0);
}

// ═══════════════════════════════════════════════════════════════
// AYARLAR
// ═══════════════════════════════════════════════════════════════
function loadSettings() {
    try {
        const raw = localStorage.getItem('kedi-settings');
        if (raw) {
            const parsed = JSON.parse(raw);
            settings = { ...DEFAULT_SETTINGS, ...parsed };
        }
        const tv = localStorage.getItem('kedi-track-vol');
        if (tv) playerState.trackVolume = parseFloat(tv);
    } catch (e) { console.warn('settings load:', e); }

    if ($('setFocus')) $('setFocus').value = settings.focus;
    if ($('setBreak')) $('setBreak').value = settings.break;
    if ($('setLongBreak')) $('setLongBreak').value = settings.longBreak;
    if ($('setLongEvery')) $('setLongEvery').value = settings.longEvery;
    if ($('setAutoStart')) $('setAutoStart').checked = settings.autoStart;
    if ($('setSoundAlert')) $('setSoundAlert').checked = settings.soundAlert;
    if ($('setAutoDuck')) $('setAutoDuck').checked = settings.autoDuck;
    if ($('volTrack')) { $('volTrack').value = playerState.trackVolume; }
    if ($('valTrack')) $('valTrack').textContent = Math.round(playerState.trackVolume * 100) + '%';

    timerState.phase = 'focus';
    timerState.timeLeft = timerState.totalTime = timerState.remainingAtPause = durationFor('focus');
}

function saveSettings() {
    settings.focus = Math.max(1, Math.min(120, parseInt($('setFocus')?.value) || 25));
    settings.break = Math.max(1, Math.min(60, parseInt($('setBreak')?.value) || 5));
    settings.longBreak = Math.max(1, Math.min(60, parseInt($('setLongBreak')?.value) || 15));
    settings.longEvery = Math.max(1, Math.min(10, parseInt($('setLongEvery')?.value) || 4));
    settings.autoStart = $('setAutoStart')?.checked || false;
    settings.soundAlert = $('setSoundAlert')?.checked !== false;
    settings.autoDuck = $('setAutoDuck')?.checked || false;
    try { localStorage.setItem('kedi-settings', JSON.stringify(settings)); } catch (e) { }
    if (!timerState.isRunning) {
        timerState.timeLeft = timerState.totalTime = timerState.remainingAtPause = durationFor(timerState.phase);
        updateDisplay();
    }
    _applyVolume();
    renderRoundDots();
    showBubble('Ayarlar kaydedildi ✅');
    toast('💾 Ayarlar kaydedildi', 'success', 2000);
}

// ─── Bubble ─────────────────────────────────────────────────
function showBubble(text, dur = 2500) {
    const b = $('catBubble');
    if (!b) return;
    b.textContent = text;
    b.classList.add('show');
    clearTimeout(showBubble._t);
    showBubble._t = setTimeout(() => b.classList.remove('show'), dur);
}

// ═══════════════════════════════════════════════════════════════
// 🎨 TEMA SİSTEMİ
// ═══════════════════════════════════════════════════════════════
const THEMES = ['midi', 'sakura', 'ocean', 'forest', 'sunset', 'aurora', 'cocoa', 'mono'];

function _loadTheme() {
    let t = 'midi';
    try { t = localStorage.getItem('kedi-theme') || 'midi'; } catch (_) { }
    if (!THEMES.includes(t)) t = 'midi';
    applyTheme(t);
}

function applyTheme(name) {
    if (!THEMES.includes(name)) name = 'midi';
    currentTheme = name;
    document.documentElement.setAttribute('data-theme', name);
    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === name);
    });
    try { localStorage.setItem('kedi-theme', name); } catch (_) { }
}

// ═══════════════════════════════════════════════════════════════
// 🔔 TOAST
// ═══════════════════════════════════════════════════════════════
function toast(text, type = 'info', dur = 2800) {
    const container = $('toastContainer');
    if (!container) return;
    const el = document.createElement('div');
    el.className = 'toast' + (type === 'success' ? ' success' : type === 'error' ? ' error' : '');
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('fade-out');
        setTimeout(() => el.remove(), 300);
    }, dur);
    while (container.children.length > 5) container.firstChild.remove();
}

// ═══════════════════════════════════════════════════════════════
// 🎵 GÖRSELLEŞTİRİCİ KONTROLÜ
// ═══════════════════════════════════════════════════════════════
function _setVisualizerActive(active) {
    const np = $('nowPlaying');
    if (!np) return;
    np.classList.toggle('playing', !!active);
}

// ═══════════════════════════════════════════════════════════════
// 🖼️ KÜTÜPHANE GÖRÜNÜMÜ
// ═══════════════════════════════════════════════════════════════
function _toggleLibraryView() {
    libraryViewMode = libraryViewMode === 'list' ? 'grid' : 'list';
    const ul = $('libraryList');
    if (ul) ul.classList.toggle('grid-view', libraryViewMode === 'grid');
    if ($('viewToggleBtn')) $('viewToggleBtn').textContent = libraryViewMode === 'grid' ? '☰' : '▦';
    try { localStorage.setItem('kedi-view', libraryViewMode); } catch (_) { }
}

function _updateVolIcon() {
    const icon = $('volIcon');
    if (!icon) return;
    const v = playerState.trackVolume;
    icon.textContent = v === 0 ? '🔇' : v < 0.4 ? '🔈' : v < 0.75 ? '🔊' : '📢';
}

// ─── Tab ────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => {
            b.classList.remove('active');
            b.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        const panel = $('tab-' + btn.dataset.tab);
        if (panel) panel.classList.add('active');
    });
});

// ─── Butonlar ───────────────────────────────────────────────
function bindClick(id, fn) {
    const el = $(id);
    if (el) el.addEventListener('click', fn);
}

bindClick('startBtn', start);
bindClick('pauseBtn', pause);
bindClick('resetBtn', reset);
bindClick('skipBtn', skip);
bindClick('fsBtn', toggleFullscreen);
bindClick('miniBtn', () => document.body.classList.toggle('mini'));
bindClick('helpBtn', () => {
    showBubble('⌨️ Space: Pomodoro • K: Çal/Dur • ←/→: 5sn • J/L: 10sn • Shift+←/→: Şarkı • ↑/↓: Ses • N: Geç', 6000);
});

bindClick('playPauseTrack', togglePlayTrack);
bindClick('nextTrack', () => nextTrack(false));
bindClick('prevTrack', prevTrack);

bindClick('shuffleBtn', () => {
    playerState.shuffle = !playerState.shuffle;
    $('shuffleBtn').classList.toggle('active', playerState.shuffle);
    showBubble(playerState.shuffle ? '🔀 Karıştır açık' : 'Sıralı çalma');
});

bindClick('repeatBtn', () => {
    playerState.repeat = (playerState.repeat + 1) % 3;
    const btn = $('repeatBtn');
    if (btn) {
        btn.classList.toggle('active', playerState.repeat > 0);
        btn.textContent = playerState.repeat === 2 ? '🔂' : '🔁';
    }
    const msgs = ['Tekrar kapalı', '🔁 Tümünü tekrar', '🔂 Tek tekrar'];
    showBubble(msgs[playerState.repeat]);
});

bindClick('addFilesBtn', async () => {
    if (!ipc) return;
    try {
        const files = await ipc.invoke('dialog:openFiles');
        if (files && files.length) addFilesToLibrary(files);
    } catch (e) { showBubble('⚠️ Dosya seçilemedi'); }
});

bindClick('addFolderBtn', async () => {
    if (!ipc) return;
    try {
        const files = await ipc.invoke('dialog:openFolder');
        if (files && files.length) addFilesToLibrary(files);
    } catch (e) { showBubble('⚠️ Klasör okunamadı'); }
});

bindClick('viewToggleBtn', _toggleLibraryView);
bindClick('clearSearch', () => {
    if ($('libSearch')) $('libSearch').value = '';
    renderLibrary();
});
bindClick('volIcon', () => {
    const newVol = playerState.trackVolume > 0 ? 0 : 0.6;
    playerState.trackVolume = newVol;
    if ($('volTrack')) $('volTrack').value = newVol;
    if ($('valTrack')) $('valTrack').textContent = Math.round(newVol * 100) + '%';
    _applyVolume();
    _updateVolIcon();
    try { localStorage.setItem('kedi-track-vol', String(newVol)); } catch (_) { }
});

// ⚡ Arama debounce
if ($('libSearch')) {
    $('libSearch').addEventListener('input', () => {
        clearTimeout(_searchTimer);
        _searchTimer = setTimeout(renderLibrary, SEARCH_DEBOUNCE_MS);
    });
}

bindClick('addYoutubeBtn', () => {
    const v = $('youtubeUrl')?.value.trim();
    if (!v) return;
    if (enqueueYoutube(v)) {
        $('youtubeUrl').value = '';
        showBubble('📺 YouTube kuyruğa eklendi');
        toast('📺 YouTube kuyruğa eklendi', 'success', 2000);
    }
});

if ($('youtubeUrl')) {
    $('youtubeUrl').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') $('addYoutubeBtn').click();
    });
}

bindClick('clearQueue', () => {
    if (!queue.length) return;
    if (confirm('Kuyruk temizlensin mi?')) {
        queue = [];
        playerState.currentIndex = -1;
        stopPlayback();
        renderQueue();
        toast('🗑 Kuyruk temizlendi', 'info', 2000);
    }
});

bindClick('shuffleQueue', () => {
    if (queue.length < 2) return;
    for (let i = queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue[i], queue[j]] = [queue[j], queue[i]];
    }
    playerState.currentIndex = -1;
    renderQueue();
    showBubble('🔀 Kuyruk karıştırıldı');
});

bindClick('openInYoutubeBtn', async () => {
    const { currentIndex } = playerState;
    if (currentIndex < 0 || !queue[currentIndex]) return;
    const t = queue[currentIndex];
    if (t.type !== 'youtube') return;
    const url = `https://www.youtube.com/watch?v=${t.videoId}`;
    if (ipc) {
        try {
            const ok = await ipc.invoke('shell:openExternal', url);
            showBubble(ok ? '🌐 YouTube\'da açıldı' : '⚠️ Açılamadı');
        } catch (e) { }
    }
});

bindClick('closeYoutubeBtn', () => {
    _hideYouTube();
    if (playerState.currentType === 'youtube') {
        playerState.isPlaying = false;
        if ($('playPauseTrack')) $('playPauseTrack').textContent = '▶';
        _setPlaybackState('paused');
        _setVisualizerActive(false);
        updateWindowTitle();
    }
});

bindClick('addTaskBtn', addTask);
if ($('taskInput')) {
    $('taskInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });
}

bindClick('resetStatsBtn', () => {
    if (confirm('Tüm istatistikler ve görevler silinsin mi? Bu işlem geri alınamaz.')) {
        statsData = { version: 1, sessions: [], tasks: [], totalFocusSeconds: 0 };
        activeTaskId = null;
        saveStats(); renderStats(); renderTasks();
        showBubble('İstatistikler sıfırlandı');
        toast('🗑 İstatistikler sıfırlandı', 'info', 2500);
    }
});

// 🎨 Tema kartları
document.querySelectorAll('.theme-card').forEach(card => {
    card.addEventListener('click', () => {
        applyTheme(card.dataset.theme);
        toast(`🎨 Tema: ${card.querySelector('.theme-name')?.textContent || card.dataset.theme}`, 'success', 1800);
    });
});

bindClick('saveSettings', saveSettings);

if ($('setSleepTimer')) {
    $('setSleepTimer').addEventListener('change', (e) => {
        const min = parseInt(e.target.value) || 0;
        setSleepTimer(min);
    });
}

bindClick('clearHistoryBtn', () => {
    if (playHistory.length === 0) return;
    if (confirm('Çalma geçmişi temizlensin mi?')) {
        playHistory = [];
        try { localStorage.removeItem('kedi-history'); } catch (_) { }
        renderHistory();
        showBubble('🗑 Geçmiş temizlendi');
        toast('🗑 Geçmiş temizlendi', 'info', 2000);
    }
});

bindClick('connectKick', () => {
    if (!window.kickChat) { showBubble('⚠️ Kick modülü yüklenemedi'); return; }
    const ch = $('kickChannel')?.value.trim();
    if (!ch) { showBubble('⚠️ Kanal adı girin'); return; }
    if (window.kickChat.connected) {
        window.kickChat.disconnect();
        if ($('connectKick')) $('connectKick').textContent = 'Bağlan';
    } else {
        window.kickChat.connect(ch);
    }
});

// ─── Klavye ─────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select, [contenteditable]')) return;

    if (e.code === 'Space') {
        e.preventDefault();
        timerState.isRunning ? pause() : start();
        return;
    }

    if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.shiftKey) nextTrack(false);
        else if (localMedia && playerState.currentType !== 'youtube' && isFinite(localMedia.duration)) {
            localMedia.currentTime = Math.min(localMedia.duration, localMedia.currentTime + 5);
        }
        return;
    }
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.shiftKey) prevTrack();
        else if (localMedia && playerState.currentType !== 'youtube') {
            localMedia.currentTime = Math.max(0, localMedia.currentTime - 5);
        }
        return;
    }
    if (e.key === 'ArrowUp') {
        e.preventDefault();
        playerState.trackVolume = Math.min(1, playerState.trackVolume + 0.05);
        if ($('volTrack')) $('volTrack').value = playerState.trackVolume;
        if ($('valTrack')) $('valTrack').textContent = Math.round(playerState.trackVolume * 100) + '%';
        _applyVolume();
        _updateVolIcon();
        try { localStorage.setItem('kedi-track-vol', String(playerState.trackVolume)); } catch (_) { }
        return;
    }
    if (e.key === 'ArrowDown') {
        e.preventDefault();
        playerState.trackVolume = Math.max(0, playerState.trackVolume - 0.05);
        if ($('volTrack')) $('volTrack').value = playerState.trackVolume;
        if ($('valTrack')) $('valTrack').textContent = Math.round(playerState.trackVolume * 100) + '%';
        _applyVolume();
        _updateVolIcon();
        try { localStorage.setItem('kedi-track-vol', String(playerState.trackVolume)); } catch (_) { }
        return;
    }

    switch (e.key.toLowerCase()) {
        case 'r': reset(); break;
        case 'm': $('muteBtn')?.click(); break;
        case 'f': toggleFullscreen(); break;
        case 'n': skip(); break;
        case 'p': togglePlayTrack(); break;
        case 'j': if (localMedia && playerState.currentType !== 'youtube') localMedia.currentTime = Math.max(0, localMedia.currentTime - 10); break;
        case 'k': togglePlayTrack(); break;
        case 'l': if (localMedia && playerState.currentType !== 'youtube' && isFinite(localMedia.duration)) localMedia.currentTime = Math.min(localMedia.duration, localMedia.currentTime + 10); break;
        case 's': $('shuffleBtn')?.click(); break;
        case '?': showBubble('⌨️ Space: Pomodoro • K: Çal/Dur • ←/→: 5sn • J/L: 10sn • Shift+←/→: Şarkı • ↑/↓: Ses • N: Geç', 5000); break;
    }
    if (e.key === 'Escape' && document.body.classList.contains('fullscreen')) {
        document.body.classList.remove('fullscreen');
        document.exitFullscreen?.().catch(() => { });
    }
});

// ─── IPC ────────────────────────────────────────────────────
if (ipc) {
    ipc.on('tray:toggle', () => { timerState.isRunning ? pause() : start(); });
    ipc.on('tray:reset', () => reset());
    ipc.on('ui:mini', (e, isMini) => { document.body.classList.toggle('mini', isMini); });
    ipc.on('tray:alwaysOnTop', () => { });
    ipc.on('media:playpause', () => togglePlayTrack());
    ipc.on('media:next', () => nextTrack(false));
    ipc.on('media:prev', () => prevTrack());
}

// ─── Drag & Drop ────────────────────────────────────────────
document.body.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.body.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const files = [...(e.dataTransfer?.files || [])]
        .filter(f => /\.(mp3|wav|ogg|m4a|flac|aac|opus|mp4|webm|mkv|mov|m4v)$/i.test(f.name))
        .map(f => f.path)
        .filter(Boolean);
    if (files.length) addFilesToLibrary(files);
});

// ─── Arka plan kedileri ─────────────────────────────────────
(function initBgCats() {
    try {
        const c = $('bgCats');
        if (!c) return;
        const cats = ['🐱', '🐈', '🐾', '🐈‍⬛', '😺', '😸'];
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 10; i++) {
            const d = document.createElement('div');
            d.className = 'float-cat';
            d.textContent = cats[Math.floor(Math.random() * cats.length)];
            d.style.left = Math.random() * 100 + '%';
            d.style.animationDuration = (18 + Math.random() * 20) + 's';
            d.style.animationDelay = (-Math.random() * 30) + 's';
            d.style.fontSize = (16 + Math.random() * 20) + 'px';
            frag.appendChild(d);
        }
        c.appendChild(frag);
    } catch (e) { console.warn('bgCats:', e); }
})();

// ═══════════════════════════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════════════════════════
(async function boot() {
    console.log('🚀 Boot başlıyor...');

    if (ipc) {
        try {
            mediaToken = await ipc.invoke('app:getMediaToken');
            mediaOrigin = await ipc.invoke('app:getOrigin');
            console.log('🎵 Medya token hazır, origin:', mediaOrigin);
        } catch (e) { console.warn('⚠️ Medya token alınamadı:', e); }
    }

    try { loadSettings(); } catch (e) { fatalError('Ayarlar yüklenemedi: ' + e.message); }
    try { _loadTheme(); } catch (e) { console.warn('tema yükleme:', e); }

    try { await loadStats(); } catch (e) { fatalError('İstatistik yüklenemedi: ' + e.message); }
    try { await loadLibrary(); } catch (e) { fatalError('Kütüphane yüklenemedi: ' + e.message); }

    try { renderStats(); } catch (e) { console.warn('renderStats:', e); }
    try { renderTasks(); } catch (e) { console.warn('renderTasks:', e); }
    try { renderRoundDots(); } catch (e) { console.warn('renderRoundDots:', e); }
    try { renderLibrary(); } catch (e) { console.warn('renderLibrary:', e); }
    try { renderQueue(); } catch (e) { console.warn('renderQueue:', e); }
    try { renderHistory(); } catch (e) { console.warn('renderHistory:', e); }

    if ($('phase')) $('phase').textContent = 'ODAK';
    document.body.classList.add('phase-focus');

    try { updateDisplay(); } catch (e) { }
    _updateButtons();
    try { attachKickHandlers(); } catch (e) { }
    try { _setupMediaSession(); } catch (e) { }

    try {
        const v = localStorage.getItem('kedi-view');
        if (v === 'grid' || v === 'list') {
            libraryViewMode = v;
            if ($('libraryList')) $('libraryList').classList.toggle('grid-view', v === 'grid');
            if ($('viewToggleBtn')) $('viewToggleBtn').textContent = v === 'grid' ? '☰' : '▦';
        }
    } catch (_) { }

    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === currentTheme);
    });

    _updateVolIcon();

    try {
        if (window.soundEngine) {
            window.soundEngine.init();
            const resumeOnInteraction = () => {
                const se = window.soundEngine;
                if (se && se.ctx && se.ctx.state === 'suspended') {
                    se.ctx.resume().then(() => console.log('🔊 AudioContext resumed'));
                }
                document.removeEventListener('click', resumeOnInteraction);
                document.removeEventListener('keydown', resumeOnInteraction);
            };
            document.addEventListener('click', resumeOnInteraction, { once: true });
            document.addEventListener('keydown', resumeOnInteraction, { once: true });
        }
    } catch (e) { console.warn('Ses motoru başlatma:', e); }

    updateWindowTitle();
    console.log('✅ Boot tamamlandı — v8.1');
})();