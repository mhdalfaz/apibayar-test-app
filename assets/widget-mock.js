/**
 * Mock widget backend for payment-link.html ("Sumber data: Mock").
 *
 * When enabled, widget API calls (/payment/v1/widget/*) are answered in the
 * browser: payment channels with per-channel limits, payment creation,
 * status (Unpaid, or Paid/Failed/Expired after 10 s) and cancel. No token and
 * no server-side transaction. Must be loaded BEFORE network-sim.js so the
 * simulation panel (delay/timeout/offline/409/error) wraps these responses.
 */
(function () {
    const CHANNEL_KEY = 'apibayar.testapp.mockChannels';
    const RESULT_KEY = 'apibayar.testapp.mockResult';
    const PREFIX = '/payment/v1/widget/';
    const METHOD_NAMES = { QR: 'QRIS', VA: 'Virtual Account', BT: 'Bank Transfer', CC: 'Kartu Kredit', EW: 'E-Wallet' };
    const DEFAULT_CHANNELS = [
        'IDR QR QRIS 10000000 0',
        'IDR VA BCA 1000000000 0',
        'IDR VA BRI 250000000 0',
        'IDR VA BNI 100000000 4000',
        'IDR VA BSI 50000000 0',
        'IDR BT BCA 20000000 0',
        'IDR CC CCARD 20000000 0',
        'MYR EW BOOST 1000 0',
        'MYR EW GRABPAY 10000 0',
    ].join('\n');
    const RESULTS = {
        unpaid: 'Tetap menunggu pembayaran (Unpaid)',
        paid: 'Lunas setelah 10 dtk (Paid)',
        failed: 'Gagal setelah 10 dtk (Failed)',
        expired: 'Kedaluwarsa setelah 10 dtk (Expired)',
    };

    const session = { enabled: false, currency: 'IDR', nominal: 0, referenceId: '', payment: null, settleAt: 0, cancelled: false };

    function read(key, fallback) {
        try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; }
    }
    function write(key, value) {
        try { localStorage.setItem(key, value); } catch (_) {}
    }

    function parseChannels(text) {
        return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
            const [currency, method, code, limit, fee] = l.split(/\s+/);
            return {
                currency: (currency || '').toUpperCase(),
                method: (method || '').toUpperCase(),
                code: (code || '').toUpperCase(),
                limit: Number(limit) || 0,
                fee: Number(fee) || 0,
            };
        }).filter((c) => c.currency && c.method && c.code);
    }

    function paymentMethods() {
        const grouped = {};
        parseChannels(api.channelText()).filter((c) => c.currency === session.currency).forEach((c) => {
            if (!grouped[c.method]) {
                grouped[c.method] = { id: c.method, paymentMethodName: METHOD_NAMES[c.method] || c.method, paymentChannels: [] };
            }
            // Same rule as BE: nominal + admin fee must not exceed the provider limit (0 = no limit).
            const available = c.limit <= 0 || session.nominal + c.fee <= c.limit;
            const ch = {
                id: c.code,
                code: c.code,
                name: c.code === 'CCARD' ? 'Kartu Kredit' : c.code,
                userChargeNominal: c.fee,
                userChargePercentage: 0,
                logo: '',
                maxTransactionLimit: c.limit,
                isAvailable: available,
            };
            if (!available) ch.unavailableReason = 'max_amount';
            grouped[c.method].paymentChannels.push(ch);
        });
        return Object.values(grouped);
    }

    function statusName() {
        if (session.cancelled) return 'Cancelled';
        if (!session.payment) return 'Unpaid';
        const result = api.result();
        if (result === 'unpaid' || Date.now() < session.settleAt) return 'Unpaid';
        return { paid: 'Paid', failed: 'Failed', expired: 'Expired' }[result] || 'Unpaid';
    }

    function ok(data) {
        return new Response(JSON.stringify({ status: 'OK', data }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    function createPayment(body) {
        const now = Math.floor(Date.now() / 1000);
        session.payment = {
            id: 'mock-' + now,
            referenceId: session.referenceId,
            nominal: session.nominal + (Number(body.adminFee) || 0),
            currency: session.currency,
            paymentMethod: body.paymentMethodCode,
            paymentChannel: body.paymentChannelCode,
            paymentStatusName: 'Unpaid',
            expiredAt: now + 3600,
            virtualAccountNumber: '8808' + String(now).slice(-10),
            bankAccountNumber: '1234567890',
            qrCode: '00020101021226670016COM.MOCK.WWW0118936000000000000000303UMI51440014ID.CO.QRIS.WWW0215ID20000000000000303UMI5204581253033605802ID5913APIBAYAR MOCK6007JAKARTA6304ABCD',
            eWalletLink: '',
        };
        session.settleAt = Date.now() + 10000;
        return session.payment;
    }

    const realFetch = window.fetch.bind(window);
    window.fetch = async function (input, init) {
        if (!session.enabled) return realFetch(input, init);
        const url = typeof input === 'string' ? input : input && input.url;
        let path = '';
        try { path = new URL(url, location.href).pathname; } catch (_) {}
        if (!path.startsWith(PREFIX)) return realFetch(input, init);

        switch (path.slice(PREFIX.length)) {
            case 'payment/status': {
                const p = session.payment || { referenceId: session.referenceId, nominal: session.nominal };
                return ok({ ...p, currency: session.currency, paymentStatusName: statusName() });
            }
            case 'payment-channels':
                return ok({ nominal: session.nominal, currency: session.currency, referenceId: session.referenceId, paymentMethods: paymentMethods() });
            case 'payment/request':
                return ok(createPayment(JSON.parse((init && init.body) || '{}')));
            case 'payment/cancel':
                session.cancelled = true;
                return ok({});
            default:
                return ok({});
        }
    };

    const api = {
        DEFAULT_CHANNELS,
        RESULTS,
        channelText: () => read(CHANNEL_KEY, DEFAULT_CHANNELS),
        saveChannels: (text) => write(CHANNEL_KEY, text),
        result: () => read(RESULT_KEY, 'unpaid'),
        saveResult: (value) => write(RESULT_KEY, value),
        /** Start a fresh mock session; returns a token-server-like response. */
        start({ currency, nominal, referenceId }) {
            Object.assign(session, { enabled: true, currency, nominal, referenceId, payment: null, settleAt: 0, cancelled: false });
            return { status: 'OK', data: { token: 'mock-token', referenceId, nominal, currency, mock: true } };
        },
        stop() { session.enabled = false; },
        get enabled() { return session.enabled; },
    };
    window.MockBackend = api;
})();
