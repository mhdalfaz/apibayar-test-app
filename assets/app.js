/**
 * Shared helper untuk APIBayar Test App.
 *
 * Penyimpanan bearer token:
 *   - sessionStorage  -> hilang saat tab ditutup
 *   - localStorage    -> hanya aktif jika user mencentang "Ingat di browser"
 *   - TTL (menit)     -> token otomatis kedaluwarsa setelah durasi tertentu
 *   - reload halaman  -> token dibuang kecuali "Ingat di browser" aktif
 */

const STORAGE_KEY = 'apibayar.testapp.bearer';
const META_KEY = 'apibayar.testapp.meta';
const ENV_KEY = 'apibayar.testapp.env';

const ENVIRONMENTS = {
    development: {
        label: 'Development',
        apiBase: 'https://dev.apibayar.com',
        widgetScript: 'https://dev-client.apibayar.com/widget/widget.min.js',
        sandbox: true,
        tokenPrefix: 'dev:',
    },
    production: {
        label: 'Production',
        apiBase: 'https://prd.apibayar.com',
        widgetScript: 'https://client.apibayar.com/widget/widget.min.js',
        sandbox: false,
        tokenPrefix: 'prd:',
    },
};

const App = {
    ENVIRONMENTS,

    /** Environment aktif (default development). */
    env() {
        try {
            const stored = localStorage.getItem(ENV_KEY);
            if (stored && ENVIRONMENTS[stored]) return stored;
        } catch (_) {}
        return 'development';
    },

    setEnv(name) {
        if (!ENVIRONMENTS[name]) return;
        try {
            localStorage.setItem(ENV_KEY, name);
        } catch (_) {}
    },

    config() {
        return ENVIRONMENTS[this.env()];
    },

    meta() {
        try {
            return JSON.parse(sessionStorage.getItem(META_KEY) || 'null') || {};
        } catch (_) {
            return {};
        }
    },

    /** Simpan token + metadata expiry. ttlMinutes = null -> tanpa expiry. */
    save(token, { ttlMinutes = 60, remember = false } = {}) {
        const clean = String(token || '').trim();
        if (!clean) return { ok: false, error: 'Token kosong.' };

        const now = Date.now();
        const meta = {
            savedAt: now,
            expiresAt: ttlMinutes ? now + ttlMinutes * 60 * 1000 : null,
            remember: !!remember,
            detectedEnv: this.detectEnv(clean),
        };

        sessionStorage.setItem(STORAGE_KEY, clean);
        sessionStorage.setItem(META_KEY, JSON.stringify(meta));
        if (remember) {
            try {
                localStorage.setItem(STORAGE_KEY, clean);
                localStorage.setItem(META_KEY, JSON.stringify(meta));
            } catch (_) {}
        } else {
            this.clearPersisted();
        }

        return { ok: true, meta };
    },

    clearPersisted() {
        try {
            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(META_KEY);
        } catch (_) {}
    },

    clear() {
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(META_KEY);
        this.clearPersisted();
    },

    /** Ambil token valid, atau null kalau belum ada / kedaluwarsa. */
    token() {
        let raw = null;
        let source = 'none';
        try {
            raw = sessionStorage.getItem(STORAGE_KEY);
            if (raw) source = 'session';
        } catch (_) {}
        if (!raw) {
            try {
                raw = localStorage.getItem(STORAGE_KEY);
                if (raw) source = 'local';
            } catch (_) {}
        }
        if (!raw) return null;

        let meta = this.meta();
        if (source === 'local') {
            try {
                meta = JSON.parse(localStorage.getItem(META_KEY) || 'null') || meta;
            } catch (_) {}
            if (!meta.remember) {
                this.clear();
                return null;
            }
        }

        if (meta.expiresAt && Date.now() > meta.expiresAt) {
            this.clear();
            return null;
        }

        this.metaCache = meta;
        return raw.trim();
    },

    /** Sisa waktu token dalam detik (null = tanpa expiry). */
    remainingSeconds() {
        const token = this.token();
        if (!token) return null;
        const meta = this.metaCache || this.meta();
        if (!meta || !meta.expiresAt) return null;
        return Math.max(0, Math.floor((meta.expiresAt - Date.now()) / 1000));
    },

    /**
     * Deteksi environment dari prefix token (base64 "dev:xxx" / "prd:xxx").
     * Dipakai untuk memberi tahu user kalau env choice tidak cocok.
     */
    detectEnv(token) {
        try {
            const decoded = atob(String(token).trim());
            if (decoded.startsWith(ENVIRONMENTS.production.tokenPrefix)) return 'production';
            if (decoded.startsWith(ENVIRONMENTS.development.tokenPrefix)) return 'development';
        } catch (_) {}
        return null;
    },

    /** API keymerchant tanpa secret portion, untuk ditampilkan. */
    decodeTokenInfo(token) {
        try {
            const decoded = atob(String(token).trim());
            const idx = decoded.indexOf(':');
            if (idx < 0) return { raw: decoded, apiKey: decoded, apiSecret: '' };
            return {
                raw: decoded,
                apiKey: decoded.slice(0, idx),
                apiSecret: decoded.slice(idx + 1),
            };
        } catch (_) {
            return { raw: '', apiKey: '', apiSecret: '' };
        }
    },

    maskToken(token) {
        const value = String(token || '');
        if (value.length <= 12) return value;
        return `${value.slice(0, 8)}${'*'.repeat(8)}${value.slice(-4)}`;
    },

    async apiFetch(path, { method = 'GET', body, token } = {}) {
        const bearer = token || this.token();
        if (!bearer) throw new Error('Bearer token belum diisi. Buka index.html dulu.');

        const res = await fetch(`${this.config().apiBase}${path}`, {
            method,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${bearer}`,
            },
            body: body ? JSON.stringify(body) : undefined,
        });

        const text = await res.text();
        let json = null;
        try {
            json = JSON.parse(text);
        } catch (_) {}

        if (!res.ok) {
            const message = (json && (json.message || json.error)) || text.slice(0, 300) || res.statusText;
            throw new Error(`HTTP ${res.status}: ${message}`);
        }
        return json;
    },

    /** Muat script widget sesuai environment aktif (hanya sekali). */
    loadWidgetScript() {
        const src = (window.NetSim && window.NetSim.widgetScript()) || this.config().widgetScript;
        return new Promise((resolve, reject) => {
            if (window.APIBayarWidget) return resolve(window.APIBayarWidget);
            const existing = document.querySelector(`script[src="${src}"]`);
            if (existing) {
                existing.addEventListener('load', () => resolve(window.APIBayarWidget));
                existing.addEventListener('error', reject);
                return;
            }
            const el = document.createElement('script');
            el.src = src;
            el.async = true;
            el.onload = () =>
                window.APIBayarWidget ? resolve(window.APIBayarWidget) : reject(new Error('Widget global tidak tersedia.'));
            el.onerror = () => reject(new Error(`Gagal memuat ${src}`));
            document.head.appendChild(el);
        });
    },

    formatSeconds(total) {
        if (total === null || total === undefined) return '—';
        const m = Math.floor(total / 60);
        const s = total % 60;
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },

    formatMoney(value, currency = 'IDR') {
        const amount = Number(value) || 0;
        if (currency === 'MYR') {
            return `RM ${amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        return `Rp ${amount.toLocaleString('id-ID')}`;
    },

    /**
     * Guard halaman selain index: kalau token tidak ada / kedaluwarsa,
     * kembalikan user ke index.html.
     */
    requireToken() {
        const token = this.token();
        if (token) return token;
        const back = encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
        location.replace(`index.html?need=1&next=${back}`);
        return null;
    },

    /**
     * Buang token bila halaman di-load lewat reload/buka ulang,
     * kecuali user memilih "Ingat di browser".
     */
    dropOnReload() {
        let type = 'navigate';
        try {
            const nav = performance.getEntriesByType('navigation')[0];
            if (nav) type = nav.type;
        } catch (_) {}
        if (type !== 'reload' && type !== 'back_forward') return;

        const meta = this.meta();
        if (!meta.savedAt) return;
        if (meta.remember) return;
        this.clear();
    },

    /** Topbar: brand link, status token, link hapus token. */
    mountChrome() {
        const token = this.token();
        const cfg = this.config();

        const bar = document.createElement('header');
        bar.className = 'topbar';
        bar.innerHTML = `
            <div class="topbar__inner">
                <a class="topbar__brand" href="index.html">
                    <span class="topbar__mark">A</span>
                    <span>API Bayar Test App</span>
                </a>
                <div class="topbar__meta">
                    <span class="badge ${token ? 'badge--on' : 'badge--off'}" id="tokenBadge">
                        <span class="dot"></span><span id="tokenBadgeText">${token ? 'token aktif' : 'tanpa token'}</span>
                    </span>
                    <span class="badge ${token ? 'badge--on' : 'badge--off'}">${cfg.label}</span>
                    ${token ? '<a class="badge" href="index.html#token" id="clearTokenLink">hapus token</a>' : ''}
                </div>
            </div>`;

        document.body.prepend(bar);

        const clear = bar.querySelector('#clearTokenLink');
        if (clear) {
            clear.addEventListener('click', (e) => {
                e.preventDefault();
                App.clear();
                location.href = 'index.html';
            });
        }

        if (token) {
            const remaining = App.remainingSeconds();
            const badge = bar.querySelector('#tokenBadgeText');
            if (remaining !== null) {
                const timer = setInterval(() => {
                    const left = App.remainingSeconds();
                    if (left === null) {
                        clearInterval(timer);
                        return;
                    }
                    if (left <= 0) {
                        App.clear();
                        location.reload();
                        return;
                    }
                    badge.textContent = `token ${App.formatSeconds(left)}`;
                }, 1000);
                badge.textContent = `token ${App.formatSeconds(remaining)}`;
            } else {
                badge.textContent = `token ${App.maskToken(token)}`;
            }
        }

        return bar;
    },

    /** Header status realtime untuk halaman index (token state bisa berubah). */
    mountIndexChrome() {
        const host = document.getElementById('tokenStatus');
        if (!host) return;
        const render = () => {
            const token = App.token();
            const remaining = App.remainingSeconds();
            const cfg = App.config();
            if (!token) {
                host.innerHTML = `<span class="badge badge--off"><span class="dot"></span>token belum diisi</span>`;
                return;
            }
            const info = App.decodeTokenInfo(token);
            const expiryText = remaining === null ? 'tanpa expiry' : `expired ${App.formatSeconds(remaining)}`;
            host.innerHTML = `
                <span class="badge badge--on"><span class="dot"></span>${App.maskToken(token)}</span>
                <span class="badge badge--on">${info.apiKey || 'unknown key'}</span>
                <span class="badge badge--on" id="expiryBadge">${expiryText}</span>
                <span class="badge badge--on">${cfg.label}</span>`;
        };
        render();
        setInterval(() => {
            const badge = document.getElementById('expiryBadge');
            const remaining = App.remainingSeconds();
            if (!badge) return;
            if (!App.token()) {
                render();
                return;
            }
            badge.textContent = remaining === null ? 'tanpa expiry' : `expired ${App.formatSeconds(remaining)}`;
        }, 1000);
    },
};

App.dropOnReload();

window.App = App;