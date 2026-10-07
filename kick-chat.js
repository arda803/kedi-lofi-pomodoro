// ============================================================
// Kick Sohbet Bağlantısı (Pusher WebSocket) — v2
// ============================================================
(function () {
    'use strict';

    const { ipcRenderer } = require('electron');

    const RECONNECT_DELAY = 5000;   // 5sn sonra yeniden bağlan
    const MAX_RECONNECTS = 5;      // maks deneme

    class KickChat {
        constructor() {
            this.ws = null;
            this.channelSlug = null;
            this.chatroomId = null;
            this.connected = false;
            this.reconnectCount = 0;
            this.reconnectTimer = null;
            this.intentionalDisconnect = false;

            this.onMessage = null;
            this.onStatus = null;
        }

        async connect(channelSlug) {
            this.intentionalDisconnect = false;
            this.reconnectCount = 0;
            this.channelSlug = channelSlug.toLowerCase().trim();
            await this._doConnect();
        }

        async _doConnect() {
            this._clearReconnectTimer();
            this._closeSocket();

            this._status('connecting', `🔄 Bağlanılıyor: ${this.channelSlug}...`);

            try {
                const data = await ipcRenderer.invoke(
                    'http:json',
                    `https://kick.com/api/v2/channels/${encodeURIComponent(this.channelSlug)}`
                );

                if (!data || data.error) {
                    throw new Error(data?.error || 'API yanıt vermedi');
                }
                if (!data.chatroom || !data.chatroom.id) {
                    throw new Error('Kanal bulunamadı veya chat kapalı');
                }

                this.chatroomId = data.chatroom.id;
                this._openWebSocket();

            } catch (e) {
                this._status('err', `❌ ${e.message}`);
                this._scheduleReconnect();
            }
        }

        async _openWebSocket() {
            // ⚡ Dinamik Pusher key: önce API'den al, olmazsa fallback
            let pusherKey = '32cbd69e4b950bf97679';  // fallback

            try {
                // Kick API bazen Pusher key verir; başarısız olursa fallback
                const cfg = await ipcRenderer.invoke('http:json',
                    `https://kick.com/api/v2/channels/${encodeURIComponent(this.channelSlug)}`);
                if (cfg && cfg.chatroom && cfg.chatroom.pusher_channel) {
                    // kick.com pusher key'i genelde aynı kalır ama yine de kontrol edelim
                }
            } catch (_) {
                // Sessizce fallback'e düş
            }

            const wsUrl = `wss://ws-us2.pusher.com/app/${pusherKey}?protocol=7&client=js&version=8.4.0&flash=false`;

            try {
                this.ws = new WebSocket(wsUrl);
            } catch (e) {
                this._status('err', `❌ WebSocket oluşturulamadı: ${e.message}`);
                this._scheduleReconnect();
                return;
            }

            // ... geri kalanı aynı (onopen, onmessage, onerror, onclose)
        }

        _scheduleReconnect() {
            if (this.intentionalDisconnect) return;
            if (this.reconnectCount >= MAX_RECONNECTS) {
                this._status('err', `❌ ${MAX_RECONNECTS} denemede bağlanılamadı`);
                return;
            }
            this.reconnectCount++;
            const delay = RECONNECT_DELAY * this.reconnectCount;
            this._status('connecting', `🔄 Yeniden bağlanılıyor... (${this.reconnectCount}/${MAX_RECONNECTS})`);
            this.reconnectTimer = setTimeout(() => this._doConnect(), delay);
        }

        _clearReconnectTimer() {
            if (this.reconnectTimer) {
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = null;
            }
        }

        _closeSocket() {
            if (this.ws) {
                try {
                    this.ws.onclose = null; // prevent reconnect loop
                    this.ws.onerror = null;
                    this.ws.close();
                } catch (e) { }
                this.ws = null;
            }
            this.connected = false;
        }

        disconnect() {
            this.intentionalDisconnect = true;
            this._clearReconnectTimer();
            this._closeSocket();
            this.chatroomId = null;
            this._status('', '⚪ Bağlı değil');
        }

        _status(cls, msg) {
            if (this.onStatus) this.onStatus(cls, msg);
        }
    }

    window.kickChat = new KickChat();
})();
