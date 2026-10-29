/**
 * Network simulation for QA (payment-link.html and widget-mock.html).
 *
 * Wraps window.fetch and intercepts widget API calls (/payment/v1/widget/*),
 * except the token endpoint used by the test app itself. Everything else goes
 * to whatever fetch was installed before this file (the real API, or the mock
 * backend on widget-mock.html).
 *
 * Settings are kept in localStorage so they survive a reload.
 * The shared panel UI is rendered by NetSim.mountPanel(container).
 */
(function () {
    const KEY = 'apibayar.testapp.netsim';
    const WIDGET_PREFIX = '/payment/v1/widget/';
    const SKIP = ['/payment/v1/widget/token/server'];

    const ENDPOINTS = {
        'payment/request': 'Lanjutkan Pembayaran (payment/request)',
        'payment-channels': 'Daftar metode (payment-channels)',
        'payment/status': 'Cek status (payment/status)',
        'payment/cancel': 'Batalkan (payment/cancel)',
    };

    const MODES = {
        off: 'Normal (tanpa simulasi)',
        delay: 'Delay lalu diteruskan',
        timeout: 'Timeout (request menggantung)',
        offline: 'Offline / jaringan terputus',
        busy: '409 sedang diproses (40906)',
        error: 'Error dari BE (status + pesan)',
    };

    const DEFAULTS = {
        enabled: false,
        endpoint: 'payment/request',
        mode: 'off',
        delaySec: 5,
        count: 0,
        errorStatus: 400,
        errorMessage: 'Maksimal pembayaran untuk metode ini adalah Rp10.000.000.',
        limits: '',
        widgetScript: '',
    };

    const state = { cfg: load(), hits: 0, log: [] };
    const listeners = [];

    function load() {
        try {
            return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
        } catch (_) {
            return { ...DEFAULTS };
        }
    }

    function save(patch) {
        state.cfg = { ...state.cfg, ...patch };
        state.hits = 0;
        try {
            localStorage.setItem(KEY, JSON.stringify(state.cfg));
        } catch (_) {}
        notify();
    }

    function notify() {
        listeners.forEach((fn) => {
            try { fn(state); } catch (_) {}
        });
    }

    function record(entry) {
        state.log.unshift({ at: new Date().toLocaleTimeString('id-ID'), ...entry });
        state.log = state.log.slice(0, 50);
        notify();
    }

    /** Parse "QRIS=10000000" lines; "*" applies to every channel. */
    function parseLimits(text) {
        const map = {};
        String(text || '')
            .split(/[\n,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .forEach((line) => {
                const m = line.match(/^([\w*-]+)(?:\/([\w-]+))?\s*=\s*([\d.]+)$/);
                if (!m) return;
                const key = m[2] ? `${m[1].toUpperCase()}/${m[2].toUpperCase()}` : m[1].toUpperCase();
                map[key] = Number(m[3]);
            });
        return map;
    }

    /** Apply limit overrides the same way BE does: nominal + admin fee > limit. */
    function applyLimits(json) {
        const map = parseLimits(state.cfg.limits);
        if (!Object.keys(map).length || !json || !json.data || !Array.isArray(json.data.paymentMethods)) return json;
        const nominal = Number(json.data.nominal) || 0;
        json.data.paymentMethods.forEach((method) => {
            (method.paymentChannels || []).forEach((ch) => {
                const code = String(ch.code || ch.id || '').toUpperCase();
                const methodId = String(method.id || '').toUpperCase();
                const limit = map[`${methodId}/${code}`] ?? map[code] ?? map['*'];
                if (limit === undefined) return;
                const fee = (Number(ch.userChargeNominal) || 0) + (nominal * (Number(ch.userChargePercentage) || 0)) / 100;
                ch.maxTransactionLimit = limit;
                ch.isAvailable = limit <= 0 || nominal + fee <= limit;
                if (ch.isAvailable) delete ch.unavailableReason;
                else ch.unavailableReason = 'max_amount';
            });
        });
        return json;
    }

    function sleep(ms, signal) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(resolve, ms);
            if (signal) {
                signal.addEventListener('abort', () => {
                    clearTimeout(t);
                    reject(new DOMException('The operation was aborted.', 'AbortError'));
                });
            }
        });
    }

    function hang(signal) {
        return new Promise((_, reject) => {
            if (signal) {
                signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
            }
        });
    }

    function jsonResponse(status, body) {
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    }

    const baseFetch = window.fetch.bind(window);

    async function forward(endpoint, input, init) {
        const res = await baseFetch(input, init);
        if (endpoint !== 'payment-channels' || !state.cfg.enabled || !state.cfg.limits.trim() || !res.ok) return res;
        const json = applyLimits(await res.clone().json().catch(() => null));
        if (!json) return res;
        record({ endpoint, action: 'override limit', note: state.cfg.limits.replace(/\s+/g, ' ') });
        return jsonResponse(res.status, json);
    }

    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : input && input.url;
        let path = '';
        try { path = new URL(url, location.href).pathname; } catch (_) {}
        if (!path.startsWith(WIDGET_PREFIX) || SKIP.includes(path)) return baseFetch(input, init);

        const endpoint = path.slice(WIDGET_PREFIX.length);
        const cfg = state.cfg;
        const signal = init && init.signal;
        const targeted = cfg.enabled && cfg.mode !== 'off' && cfg.endpoint === endpoint;
        const withinCount = !cfg.count || state.hits < cfg.count;

        if (!targeted || !withinCount) {
            record({ endpoint, action: 'diteruskan' });
            return forward(endpoint, input, init);
        }

        state.hits += 1;
        const nth = cfg.count ? ` (${state.hits}/${cfg.count})` : ` (#${state.hits})`;
        switch (cfg.mode) {
            case 'delay':
                record({ endpoint, action: `delay ${cfg.delaySec} dtk${nth}` });
                await sleep(Math.max(0, Number(cfg.delaySec) || 0) * 1000, signal);
                return forward(endpoint, input, init);
            case 'timeout':
                record({ endpoint, action: `timeout${nth}`, note: 'menunggu widget membatalkan request' });
                return hang(signal);
            case 'offline':
                record({ endpoint, action: `offline${nth}` });
                throw new TypeError('Failed to fetch');
            case 'busy':
                record({ endpoint, action: `409 40906${nth}` });
                return jsonResponse(409, {
                    status: 'Conflict',
                    code: '40906',
                    errorCode: '40906',
                    message: 'Pembayaran Anda sedang diproses. Mohon tunggu sebentar.',
                });
            case 'error': {
                const status = Number(cfg.errorStatus) || 400;
                record({ endpoint, action: `error ${status}${nth}`, note: cfg.errorMessage });
                return jsonResponse(status, { status: 'Error', message: cfg.errorMessage });
            }
            default:
                return forward(endpoint, input, init);
        }
    };

    const PANEL_HTML = `
        <div class="card__head">
            <h2 style="margin:0">Simulasi Jaringan <span class="muted small" style="text-transform:none;letter-spacing:0">(QA)</span></h2>
            <span class="badge" data-ns="badge"><span class="dot"></span><span data-ns="badgeText">Nonaktif</span></span>
        </div>
        <p class="muted small" style="margin-top:0">
            Mensimulasikan delay, timeout, offline, 409, atau error BE pada request widget
            (<span class="mono">/payment/v1/widget/*</span>) tanpa mengubah server. Pembuatan token tidak terpengaruh.
            Pengaturan berlaku untuk widget berikutnya yang dibuka dan tersimpan di browser ini.
        </p>

        <label class="check" style="margin-bottom:12px">
            <input type="checkbox" data-ns="enabled">
            <span>Aktifkan simulasi</span>
        </label>

        <div data-ns="body">
            <div class="grid-2">
                <div class="field">
                    <span class="field__label">Endpoint</span>
                    <select data-ns="endpoint"></select>
                </div>
                <div class="field">
                    <span class="field__label">Skenario</span>
                    <select data-ns="mode"></select>
                </div>
            </div>

            <div class="grid-2">
                <div class="field" data-ns="delayField">
                    <span class="field__label">Delay (detik)</span>
                    <input type="number" data-ns="delaySec" min="0" step="1">
                    <span class="muted small">Widget membatalkan request setelah 30 dtk dan mengulang hingga ±45 dtk.</span>
                </div>
                <div class="field">
                    <span class="field__label">Berlaku untuk</span>
                    <select data-ns="count">
                        <option value="0">Semua request</option>
                        <option value="1">1 request pertama</option>
                        <option value="2">2 request pertama</option>
                        <option value="3">3 request pertama</option>
                    </select>
                    <span class="muted small">Setelah itu request diteruskan normal (untuk uji retry berhasil).</span>
                </div>
            </div>

            <div class="grid-2" data-ns="errorFields">
                <div class="field">
                    <span class="field__label">HTTP status</span>
                    <input type="number" data-ns="errorStatus" min="400" max="599" step="1">
                </div>
                <div class="field">
                    <span class="field__label">Pesan error</span>
                    <input type="text" data-ns="errorMessage">
                </div>
            </div>

            <div class="field">
                <span class="field__label">Override limit channel <span class="muted small">(opsional)</span></span>
                <textarea data-ns="limits" rows="3" class="mono" placeholder="QRIS=10000000&#10;VA/BNI=100000000&#10;*=20000000"></textarea>
                <span class="muted small">
                    Satu baris per channel: <span class="mono">KODE=limit</span> atau <span class="mono">METODE/KODE=limit</span>,
                    <span class="mono">*</span> = semua channel. Diterapkan ke respons payment-channels
                    (nominal + admin fee &gt; limit → nonaktif). Kosongkan untuk memakai limit dari BE.
                </span>
            </div>

            <div class="field">
                <span class="field__label">URL widget <span class="muted small">(opsional)</span></span>
                <input type="url" data-ns="widgetScript" class="mono" placeholder="kosong = widget environment aktif">
                <span class="muted small">Untuk mengetes build widget lain sebelum deploy. Muat ulang halaman setelah mengubah.</span>
            </div>

            <div class="row">
                <button class="btn btn--ghost btn--sm" data-ns="resetCounter" type="button">Reset hitungan</button>
                <button class="btn btn--ghost btn--sm" data-ns="reset" type="button">Reset pengaturan</button>
                <button class="btn btn--ghost btn--sm" data-ns="clearLog" type="button">Bersihkan log</button>
            </div>

            <pre class="output" data-ns="log" style="margin-top:12px;max-height:220px;overflow:auto">Belum ada request widget.</pre>
        </div>`;

    function mountPanel(container) {
        if (!container) return;
        container.innerHTML = PANEL_HTML;
        const el = (name) => container.querySelector(`[data-ns="${name}"]`);
        const fill = (sel, entries) => {
            sel.innerHTML = Object.entries(entries).map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
        };
        fill(el('endpoint'), ENDPOINTS);
        fill(el('mode'), MODES);

        const fields = ['enabled', 'endpoint', 'mode', 'delaySec', 'count', 'errorStatus', 'errorMessage', 'limits', 'widgetScript'];
        const cfg = state.cfg;
        fields.forEach((f) => {
            if (f === 'enabled') el(f).checked = cfg.enabled;
            else el(f).value = String(cfg[f]);
        });

        const read = () => save({
            enabled: el('enabled').checked,
            endpoint: el('endpoint').value,
            mode: el('mode').value,
            delaySec: Number(el('delaySec').value) || 0,
            count: Number(el('count').value) || 0,
            errorStatus: Number(el('errorStatus').value) || 400,
            errorMessage: el('errorMessage').value,
            limits: el('limits').value,
            widgetScript: el('widgetScript').value,
        });
        fields.forEach((f) => el(f).addEventListener(f === 'limits' || f === 'errorMessage' ? 'input' : 'change', read));

        el('resetCounter').addEventListener('click', () => { state.hits = 0; notify(); });
        el('clearLog').addEventListener('click', () => { state.log = []; notify(); });
        el('reset').addEventListener('click', () => {
            if (!confirm('Kembalikan semua pengaturan simulasi ke default?')) return;
            save({ ...DEFAULTS });
            location.reload();
        });

        listeners.push((s) => {
            const c = s.cfg;
            el('body').style.opacity = c.enabled ? '' : '0.5';
            el('delayField').style.display = c.mode === 'delay' ? '' : 'none';
            el('errorFields').style.display = c.mode === 'error' ? '' : 'none';
            const on = api.active;
            el('badge').className = 'badge ' + (on ? 'badge--on' : 'badge--off');
            el('badgeText').textContent = on
                ? (c.mode !== 'off' ? `${MODES[c.mode]} · ${c.endpoint}` : 'Override limit / widget')
                : 'Nonaktif';
            el('log').textContent = s.log.length
                ? s.log.map((l) => `${l.at}  ${l.endpoint.padEnd(17)} ${l.action}${l.note ? '  — ' + l.note : ''}`).join('\n')
                : 'Belum ada request widget.';
        });
        notify();
    }

    const api = {
        ENDPOINTS,
        MODES,
        get config() { return { ...state.cfg }; },
        get log() { return state.log.slice(); },
        get active() {
            return state.cfg.enabled && (state.cfg.mode !== 'off' || !!state.cfg.limits.trim() || !!state.cfg.widgetScript.trim());
        },
        set: save,
        reset() { save({ ...DEFAULTS }); },
        resetCounter() { state.hits = 0; notify(); },
        clearLog() { state.log = []; notify(); },
        mountPanel,
        /** Optional widget script override (e.g. a local build) — only when simulation is on. */
        widgetScript() { return state.cfg.enabled && state.cfg.widgetScript.trim() ? state.cfg.widgetScript.trim() : ''; },
    };
    window.NetSim = api;
})();
