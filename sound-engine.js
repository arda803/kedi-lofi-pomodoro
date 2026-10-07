// ============================================================
// Kedi Lo-Fi Pomodoro — Ses Motoru v4
// Tamamen Web Audio API ile canlı üretilir. Harici dosya YOK.
// ============================================================

class SoundEngine {
    constructor() {
        this.ctx           = null;
        this.masterGain    = null;
        this.reverb        = null;
        this.reverbGain    = null;
        this.channels      = {};
        this.initialized   = false;
        this.masterVolume  = 0.85;
        this.muted         = false;
        this._prebuiltBuffers = {};  // noise bufferları önbelleğe al
    }

    // ──────────────────────────────── KURULUM ────────────────
    init() {
        if (this.initialized) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { console.error('Web Audio API desteklenmiyor'); return; }
        try {
            this.ctx = new AC();

            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
            this.masterGain.connect(this.ctx.destination);

            // Reverb zinciri
            this.reverb = this.ctx.createConvolver();
            this.reverb.buffer = this._makeImpulseResponse(2.5, 2.0);
            this.reverbGain = this.ctx.createGain();
            this.reverbGain.gain.value = 0.30;
            this.reverb.connect(this.reverbGain);
            this.reverbGain.connect(this.masterGain);

            this.initialized = true;
        } catch (e) {
            console.error('SoundEngine init hatası:', e);
        }
    }

    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume().catch(e => console.warn('AudioContext resume:', e));
        }
    }

    suspend() {
        if (this.ctx && this.ctx.state === 'running') {
            this.ctx.suspend().catch(() => {});
        }
    }

    setMasterVolume(v) {
        this.masterVolume = Math.max(0, Math.min(1, v));
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(
                this.muted ? 0 : this.masterVolume,
                this.ctx.currentTime, 0.1
            );
        }
    }

    setMuted(m) {
        this.muted = m;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setTargetAtTime(
                m ? 0 : this.masterVolume,
                this.ctx.currentTime, 0.08
            );
        }
    }

    getMuted() { return this.muted; }

    // ──────────────────────────────── YARDIMCILAR ─────────────
    createChannel(name, vol = 0) {
        if (this.channels[name]) return this.channels[name];
        const gain = this.ctx.createGain();
        gain.gain.value = 0;
        gain.connect(this.masterGain);
        const send = this.ctx.createGain();
        send.gain.value = 0.18;
        gain.connect(send);
        send.connect(this.reverb);

        this.channels[name] = {
            gain, send,
            sources: [],
            timers: [],
            active: false,
            targetVolume: vol
        };
        return this.channels[name];
    }

    setVolume(name, v) {
        const ch = this.channels[name];
        if (!ch || !this.ctx) return;
        ch.targetVolume = v;
        ch.gain.gain.setTargetAtTime(
            this.muted ? 0 : v,
            this.ctx.currentTime, 0.12
        );
    }

    // Önbelleklenmiş gürültü bufferları
    _getNoise(type, sec) {
        const key = `${type}_${sec}`;
        if (!this._prebuiltBuffers[key]) {
            if (type === 'white')  this._prebuiltBuffers[key] = this._makeNoiseBuffer(sec);
            else if (type === 'brown') this._prebuiltBuffers[key] = this._makeBrownNoiseBuffer(sec);
            else if (type === 'pink')  this._prebuiltBuffers[key] = this._makePinkNoiseBuffer(sec);
        }
        return this._prebuiltBuffers[key];
    }

    _makeNoiseBuffer(sec = 2) {
        const len = Math.floor(this.ctx.sampleRate * sec);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return buf;
    }

    _makeBrownNoiseBuffer(sec = 3) {
        const len = Math.floor(this.ctx.sampleRate * sec);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            last = (last + 0.02 * w) / 1.02;
            d[i] = last * 3.5;
        }
        return buf;
    }

    _makePinkNoiseBuffer(sec = 3) {
        const len = Math.floor(this.ctx.sampleRate * sec);
        const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = buf.getChannelData(0);
        let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
        for (let i = 0; i < len; i++) {
            const w = Math.random() * 2 - 1;
            b0 = 0.99886*b0 + w*0.0555179;
            b1 = 0.99332*b1 + w*0.0750759;
            b2 = 0.96900*b2 + w*0.1538520;
            b3 = 0.86650*b3 + w*0.3104856;
            b4 = 0.55000*b4 + w*0.5329522;
            b5 = -0.7616*b5 - w*0.0168980;
            d[i] = (b0+b1+b2+b3+b4+b5+b6 + w*0.5362) * 0.11;
            b6 = w * 0.115926;
        }
        return buf;
    }

    _makeImpulseResponse(duration = 2.5, decay = 2.0) {
        const rate = this.ctx.sampleRate;
        const len  = Math.floor(rate * duration);
        const buf  = this.ctx.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const d = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) {
                d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
            }
        }
        return buf;
    }

    // ──────────────────────────────── 🌧️ YAĞMUR ─────────────
    startRain(volume = 0.3) {
        this.init();
        const ch = this.createChannel('rain', volume);
        if (ch.active) { this.setVolume('rain', volume); return; }
        ch.active = true;

        const src1 = this.ctx.createBufferSource();
        src1.buffer = this._getNoise('pink', 3);
        src1.loop = true;
        const lp1 = this.ctx.createBiquadFilter();
        lp1.type = 'lowpass'; lp1.frequency.value = 1400; lp1.Q.value = 0.4;
        const hp1 = this.ctx.createBiquadFilter();
        hp1.type = 'highpass'; hp1.frequency.value = 250;
        src1.connect(hp1); hp1.connect(lp1); lp1.connect(ch.gain);
        src1.start();
        ch.sources.push(src1);

        const src2 = this.ctx.createBufferSource();
        src2.buffer = this._getNoise('white', 2);
        src2.loop = true;
        const bp2 = this.ctx.createBiquadFilter();
        bp2.type = 'bandpass'; bp2.frequency.value = 5000; bp2.Q.value = 0.8;
        const g2 = this.ctx.createGain(); g2.gain.value = 0.12;
        src2.connect(bp2); bp2.connect(g2); g2.connect(ch.gain);
        src2.start();
        ch.sources.push(src2);

        const dropsTimer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            if (Math.random() > 0.4) this._playDrop(ch.gain);
        }, 280);
        ch.timers.push(dropsTimer);

        this.setVolume('rain', volume);
    }

    _playDrop(dest) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'sine';
        const f0 = 1800 + Math.random() * 1200;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(400, t + 0.09);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.06 + Math.random() * 0.04, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.14);
    }

    // ──────────────────────────────── ⛈️ GÖK GÜRÜLTÜSÜ ──────
    startThunder(volume = 0.3) {
        this.init();
        const ch = this.createChannel('thunder', volume);
        if (ch.active) { this.setVolume('thunder', volume); return; }
        ch.active = true;

        const src = this.ctx.createBufferSource();
        src.buffer = this._getNoise('brown', 4);
        src.loop = true;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 200;
        const g = this.ctx.createGain(); g.gain.value = 0.4;
        src.connect(lp); lp.connect(g); g.connect(ch.gain);
        src.start();
        ch.sources.push(src);

        const thunderTimer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            if (Math.random() > 0.85) this._playThunderBoom(ch.gain);
        }, 4000);
        ch.timers.push(thunderTimer);

        this.setVolume('thunder', volume);
    }

    _playThunderBoom(dest) {
        if (!this.ctx) return;
        const t   = this.ctx.currentTime;
        const dur = 2.5 + Math.random() * 1.5;
        const src = this.ctx.createBufferSource();
        src.buffer = this._makeBrownNoiseBuffer(dur);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(400, t);
        lp.frequency.exponentialRampToValueAtTime(80, t + dur);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.6, t + 0.15);
        g.gain.setValueAtTime(0.5, t + 0.4);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(lp); lp.connect(g); g.connect(dest);
        src.start(t); src.stop(t + dur);
    }

    // ──────────────────────────────── ☕ KAFE ─────────────────
    startCafe(volume = 0.3) {
        this.init();
        const ch = this.createChannel('cafe', volume);
        if (ch.active) { this.setVolume('cafe', volume); return; }
        ch.active = true;

        const src = this.ctx.createBufferSource();
        src.buffer = this._getNoise('brown', 3);
        src.loop = true;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 0.6;
        const g = this.ctx.createGain(); g.gain.value = 0.7;
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 0.12;
        const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.25;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        lfo.start();
        src.connect(bp); bp.connect(g); g.connect(ch.gain);
        src.start();
        ch.sources.push(src, lfo);

        const clinkTimer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            if (Math.random() > 0.55) this._playClink(ch.gain);
        }, 700);
        ch.timers.push(clinkTimer);

        const chatterTimer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            if (Math.random() > 0.70) this._playChatter(ch.gain);
        }, 2500);
        ch.timers.push(chatterTimer);

        this.setVolume('cafe', volume);
    }

    _playClink(dest) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(2400 + Math.random() * 1000, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.55);
    }

    _playChatter(dest) {
        if (!this.ctx) return;
        const t   = this.ctx.currentTime;
        const dur = 0.3 + Math.random() * 0.4;
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = 120 + Math.random() * 80;
        const formant = this.ctx.createBiquadFilter();
        formant.type = 'bandpass'; formant.frequency.value = 800 + Math.random() * 400; formant.Q.value = 3;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.02, t + 0.05);
        g.gain.setValueAtTime(0.02, t + dur - 0.1);
        g.gain.linearRampToValueAtTime(0, t + dur);
        osc.connect(formant); formant.connect(g); g.connect(dest);
        osc.start(t); osc.stop(t + dur + 0.05);
    }

    // ──────────────────────────────── 🔥 ATEŞ ─────────────────
    startFire(volume = 0.3) {
        this.init();
        const ch = this.createChannel('fire', volume);
        if (ch.active) { this.setVolume('fire', volume); return; }
        ch.active = true;

        const src = this.ctx.createBufferSource();
        src.buffer = this._getNoise('brown', 3);
        src.loop = true;
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 700;
        const g = this.ctx.createGain(); g.gain.value = 0.35;
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 0.4;
        const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.12;
        lfo.connect(lfoG); lfoG.connect(g.gain);
        lfo.start();
        src.connect(lp); lp.connect(g); g.connect(ch.gain);
        src.start();
        ch.sources.push(src, lfo);

        const popTimer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            const count = 1 + Math.floor(Math.random() * 3);
            for (let i = 0; i < count; i++) {
                setTimeout(() => { if (ch.active) this._playCrackle(ch.gain); }, Math.random() * 300);
            }
        }, 200);
        ch.timers.push(popTimer);

        this.setVolume('fire', volume);
    }

    _playCrackle(dest) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'square';
        o.frequency.setValueAtTime(60 + Math.random() * 500, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.08 + Math.random() * 0.12, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.05);
    }

    // ──────────────────────────────── 🎐 RÜZGAR ──────────────
    startWind(volume = 0.3) {
        this.init();
        const ch = this.createChannel('wind', volume);
        if (ch.active) { this.setVolume('wind', volume); return; }
        ch.active = true;

        const src = this.ctx.createBufferSource();
        src.buffer = this._getNoise('pink', 3);
        src.loop = true;
        const bp = this.ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.4;
        const lfo = this.ctx.createOscillator();
        lfo.frequency.value = 0.08;
        const lfoG = this.ctx.createGain(); lfoG.gain.value = 250;
        lfo.connect(lfoG); lfoG.connect(bp.frequency);
        lfo.start();
        const g = this.ctx.createGain(); g.gain.value = 0.7;
        const lfo2 = this.ctx.createOscillator();
        lfo2.frequency.value = 0.15;
        const lfo2G = this.ctx.createGain(); lfo2G.gain.value = 0.2;
        lfo2.connect(lfo2G); lfo2G.connect(g.gain);
        lfo2.start();
        src.connect(bp); bp.connect(g); g.connect(ch.gain);
        src.start();
        ch.sources.push(src, lfo, lfo2);

        this.setVolume('wind', volume);
    }

    // ──────────────────────────────── 🌊 DALGA ────────────────
    startWaves(volume = 0.3) {
        this.init();
        const ch = this.createChannel('waves', volume);
        if (ch.active) { this.setVolume('waves', volume); return; }
        ch.active = true;

        const src = this.ctx.createBufferSource();
        src.buffer = this._getNoise('brown', 3);
        src.loop = true;
        const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800;
        const hp = this.ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 100;
        const g = this.ctx.createGain(); g.gain.value = 0.2;
        const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.14;
        const lfoG = this.ctx.createGain(); lfoG.gain.value = 0.5;
        lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
        src.connect(hp); hp.connect(lp); lp.connect(g); g.connect(ch.gain);
        src.start();
        ch.sources.push(src, lfo);

        this.setVolume('waves', volume);
    }

    // ──────────────────────────────── 🐦 KUŞ ─────────────────
    startBirds(volume = 0.3) {
        this.init();
        const ch = this.createChannel('birds', volume);
        if (ch.active) { this.setVolume('birds', volume); return; }
        ch.active = true;

        const timer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            if (Math.random() > 0.6) {
                const notes = 2 + Math.floor(Math.random() * 3);
                for (let i = 0; i < notes; i++) {
                    setTimeout(() => { if (ch.active) this._playChirp(ch.gain); }, i * 90 + Math.random() * 50);
                }
            }
        }, 1200);
        ch.timers.push(timer);

        this.setVolume('birds', volume);
    }

    _playChirp(dest) {
        if (!this.ctx) return;
        const t  = this.ctx.currentTime;
        const o  = this.ctx.createOscillator();
        const g  = this.ctx.createGain();
        o.type   = 'sine';
        const f0 = 2500 + Math.random() * 2000;
        const f1 = f0 + (Math.random() - 0.5) * 1500;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(f1, 100), t + 0.08);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.06, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.14);
    }

    // ──────────────────────────────── 🦗 CIRCIR ───────────────
    startCrickets(volume = 0.3) {
        this.init();
        const ch = this.createChannel('crickets', volume);
        if (ch.active) { this.setVolume('crickets', volume); return; }
        ch.active = true;

        const timer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            for (let i = 0; i < 4; i++) {
                setTimeout(() => { if (ch.active) this._playCricket(ch.gain); }, i * 45);
            }
            if (Math.random() > 0.7) {
                setTimeout(() => {
                    for (let i = 0; i < 3; i++) {
                        setTimeout(() => { if (ch.active) this._playCricket(ch.gain); }, i * 45);
                    }
                }, 400);
            }
        }, 900);
        ch.timers.push(timer);

        this.setVolume('crickets', volume);
    }

    _playCricket(dest) {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        const o = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        o.type = 'square';
        o.frequency.value = 4200 + Math.random() * 400;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        o.connect(g); g.connect(dest);
        o.start(t); o.stop(t + 0.035);
    }

    // ──────────────────────────────── 💻 KLAVYE ───────────────
    startKeyboard(volume = 0.3) {
        this.init();
        const ch = this.createChannel('keyboard', volume);
        if (ch.active) { this.setVolume('keyboard', volume); return; }
        ch.active = true;

        const timer = setInterval(() => {
            if (!ch.active || !this.ctx) return;
            const keys = 2 + Math.floor(Math.random() * 4);
            for (let i = 0; i < keys; i++) {
                setTimeout(() => { if (ch.active) this._playKey(ch.gain); }, i * (60 + Math.random() * 40));
            }
        }, 1500 + Math.random() * 1000);
        ch.timers.push(timer);

        this.setVolume('keyboard', volume);
    }

    _playKey(dest) {
        if (!this.ctx) return;
        const t   = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this._makeNoiseBuffer(0.03);
        const bp  = this.ctx.createBiquadFilter();
        bp.type   = 'bandpass';
        bp.frequency.value = 2500 + Math.random() * 2000;
        bp.Q.value = 2;
        const g   = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.05, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
        src.connect(bp); bp.connect(g); g.connect(dest);
        src.start(t); src.stop(t + 0.04);
    }

    // ──────────────────────────────── 🔔 ZİL ─────────────────
    playBell() {
        this.init();
        this.resume();
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        [1046.50, 1318.51, 1567.98].forEach((f, i) => {
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = 'sine'; o.frequency.value = f;
            const s = t + i * 0.13;
            g.gain.setValueAtTime(0, s);
            g.gain.linearRampToValueAtTime(0.22, s + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, s + 1.8);
            o.connect(g); g.connect(this.masterGain);
            const send = this.ctx.createGain(); send.gain.value = 0.3;
            g.connect(send); send.connect(this.reverb);
            o.start(s); o.stop(s + 1.9);
        });
    }

    // ──────────────────────────────── 🐾 MIRLAMA ──────────────
    playPurr(dur = 1.5) {
        this.init();
        this.resume();
        if (!this.ctx) return;
        const t   = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g   = this.ctx.createGain();
        const lfo = this.ctx.createOscillator();
        const lfoG = this.ctx.createGain();
        osc.type = 'sawtooth'; osc.frequency.value = 28;
        lfo.frequency.value = 26; lfoG.gain.value = 14;
        lfo.connect(lfoG); lfoG.connect(osc.frequency);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.09, t + 0.1);
        g.gain.setValueAtTime(0.09, t + dur - 0.2);
        g.gain.linearRampToValueAtTime(0, t + dur);
        const lp = this.ctx.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = 400;
        osc.connect(lp); lp.connect(g); g.connect(this.masterGain);
        osc.start(t); lfo.start(t);
        osc.stop(t + dur); lfo.stop(t + dur);
    }

    // ──────────────────────────────── 🎉 SEANS BİTİŞİ ────────
    playComplete() {
        this.init();
        this.resume();
        this.playBell();
        setTimeout(() => { if (this.ctx) this.playPurr(1.2); }, 500);
    }

    // ──────────────────────────────── PRESET'LER ──────────────
    applyPreset(name) {
        const presets = {
            study:   { rain: 0.35, cafe: 0.20, fire: 0.00, wind: 0.00, thunder: 0.00, waves: 0.00, birds: 0.00, crickets: 0.00, keyboard: 0.30 },
            relax:   { rain: 0.30, cafe: 0.00, fire: 0.35, wind: 0.15, thunder: 0.00, waves: 0.00, birds: 0.20, crickets: 0.00, keyboard: 0.00 },
            night:   { rain: 0.25, cafe: 0.00, fire: 0.30, wind: 0.20, thunder: 0.15, waves: 0.00, birds: 0.00, crickets: 0.35, keyboard: 0.00 },
            beach:   { rain: 0.00, cafe: 0.00, fire: 0.00, wind: 0.20, thunder: 0.00, waves: 0.55, birds: 0.30, crickets: 0.00, keyboard: 0.00 },
            forest:  { rain: 0.20, cafe: 0.00, fire: 0.15, wind: 0.15, thunder: 0.00, waves: 0.00, birds: 0.40, crickets: 0.20, keyboard: 0.00 },
            storm:   { rain: 0.55, cafe: 0.00, fire: 0.00, wind: 0.35, thunder: 0.50, waves: 0.00, birds: 0.00, crickets: 0.00, keyboard: 0.00 },
            silence: { rain: 0.00, cafe: 0.00, fire: 0.00, wind: 0.00, thunder: 0.00, waves: 0.00, birds: 0.00, crickets: 0.00, keyboard: 0.00 }
        };
        const p = presets[name];
        if (!p) return null;

        this.stopAll();
        this.init();
        this.resume();

        const starters = {
            rain:     (v) => this.startRain(v),
            cafe:     (v) => this.startCafe(v),
            fire:     (v) => this.startFire(v),
            wind:     (v) => this.startWind(v),
            thunder:  (v) => this.startThunder(v),
            waves:    (v) => this.startWaves(v),
            birds:    (v) => this.startBirds(v),
            crickets: (v) => this.startCrickets(v),
            keyboard: (v) => this.startKeyboard(v)
        };

        Object.keys(p).forEach(key => {
            if (p[key] > 0 && starters[key]) starters[key](p[key]);
        });

        return p;
    }

    // ──────────────────────────────── DURDURMA ────────────────
    stop(name) {
        const ch = this.channels[name];
        if (!ch || !this.ctx) return;
        ch.active = false;
        try {
            ch.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.12);
        } catch (e) {}
        // Kaynaklarımızı durdur
        ch.sources.forEach(s => {
            try { s.stop(); } catch (e) {}
        });
        // Zamanlayıcıları temizle
        ch.timers.forEach(t => clearInterval(t));
        // Kanalı kısa bir gecikmeyle tamamen sil (fade tamamlansin)
        setTimeout(() => {
            if (this.channels[name] === ch) {
                ch.sources = [];
                ch.timers  = [];
                delete this.channels[name];
            }
        }, 600);
    }

    stopAll() {
        Object.keys(this.channels).forEach(name => this.stop(name));
    }

    getActiveChannels() {
        return Object.keys(this.channels).filter(n => this.channels[n] && this.channels[n].active);
    }

    isChannelActive(name) {
        return !!(this.channels[name] && this.channels[name].active);
    }
}

window.soundEngine = new SoundEngine();
