import crypto from 'crypto';
import helmet from 'helmet';

// ---------------------------------------------------------------------------
// Cabeçalhos de segurança (Helmet + CSP)
// ---------------------------------------------------------------------------
// As views carregam bibliotecas por CDN e trazem <script>/<style> embutidos,
// por isso 'unsafe-inline' continua liberado. A proteção contra XSS no conteúdo
// gerado por usuários vem do escape automático do Handlebars ({{ }}).
const CDN_SCRIPTS = [
    "'self'",
    "'unsafe-inline'",
    'https://cdn.jsdelivr.net',
    'https://code.jquery.com',
    'https://unpkg.com',
    'https://cdnjs.cloudflare.com',
    'https://www.google.com',
    'https://www.gstatic.com',
    'https://upload-widget.cloudinary.com'
];

const CDN_STYLES = [
    "'self'",
    "'unsafe-inline'",
    'https://cdn.jsdelivr.net',
    'https://unpkg.com',
    'https://cdnjs.cloudflare.com',
    'https://fonts.googleapis.com',
    'https://cdn.linearicons.com'
];

export const securityHeaders = helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: CDN_SCRIPTS,
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: CDN_STYLES,
            fontSrc: [
                "'self'",
                'https://cdn.jsdelivr.net',
                'https://fonts.gstatic.com',
                'https://cdnjs.cloudflare.com',
                'https://cdn.linearicons.com',
                'data:'
            ],
            imgSrc: [
                "'self'",
                'data:',
                'blob:',
                'https://res.cloudinary.com',
                'https://*.tile.openstreetmap.org', // Tiles do Leaflet
                'https://unpkg.com', // Ícones do Leaflet
                'https://cdn-icons-png.flaticon.com', // Marcador do mapa de chamados
                'https://www.transparenttextures.com' // Textura de fundo do painel admin
            ],
            mediaSrc: ["'self'", 'https://res.cloudinary.com'],
            connectSrc: [
                "'self'",
                'https://api.cloudinary.com',
                'https://res.cloudinary.com',
                'https://nominatim.openstreetmap.org', // Geocodificação reversa
                'https://www.google.com', // Telemetria do reCAPTCHA Enterprise
                'https://www.gstatic.com'
            ],
            frameSrc: ['https://www.google.com', 'https://recaptcha.google.com'],
            frameAncestors: ["'none'"], // Anti-clickjacking
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            upgradeInsecureRequests: []
        }
    },
    // O portal exibe mídia do Cloudinary; a política restritiva padrão bloquearia.
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: {
        maxAge: 60 * 60 * 24 * 180, // 180 dias
        includeSubDomains: true,
        preload: false
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
});

// ---------------------------------------------------------------------------
// Redirecionamento forçado para HTTPS
// ---------------------------------------------------------------------------
// Render e Vercel encerram o TLS no proxy e repassam o esquema original no
// cabeçalho X-Forwarded-Proto (lido pelo Express graças ao 'trust proxy').
export function forceHttps(req, res, next) {
    const host = req.get('host') || '';
    const ehLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

    // O ambiente local roda em http mesmo quando NODE_ENV=production, então
    // isentamos localhost para não criar um laço de redirecionamento.
    if (process.env.NODE_ENV === 'production' && !ehLocal && req.protocol !== 'https') {
        return res.redirect(308, `https://${host}${req.originalUrl}`);
    }

    next();
}

// ---------------------------------------------------------------------------
// Proteção contra NoSQL Injection
// ---------------------------------------------------------------------------
// Com body-parser em modo extended, `email[$gt]=` chega ao servidor como objeto
// e viraria um operador do Mongo dentro do findOne. Removemos qualquer chave
// iniciada por '$' ou contendo '.' antes que a requisição alcance as rotas.
function limparOperadores(valor, profundidade = 0) {
    if (profundidade > 8 || valor === null || typeof valor !== 'object') {
        return valor;
    }

    if (Array.isArray(valor)) {
        return valor.map((item) => limparOperadores(item, profundidade + 1));
    }

    const limpo = {};
    for (const [chave, conteudo] of Object.entries(valor)) {
        if (chave.startsWith('$') || chave.includes('.')) {
            continue;
        }
        limpo[chave] = limparOperadores(conteudo, profundidade + 1);
    }
    return limpo;
}

export function sanitizeMongo(req, res, next) {
    if (req.body) req.body = limparOperadores(req.body);
    if (req.params) req.params = limparOperadores(req.params);
    next();
}

// ---------------------------------------------------------------------------
// Proteção contra CSRF (token sincronizado por sessão)
// ---------------------------------------------------------------------------
const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfProtection(req, res, next) {
    if (!req.session) {
        return next();
    }

    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    }

    res.locals.csrfToken = req.session.csrfToken;

    if (METODOS_SEGUROS.has(req.method)) {
        return next();
    }

    const enviado = req.body?._csrf || req.get('x-csrf-token') || '';
    const esperado = req.session.csrfToken;

    const bufferEnviado = Buffer.from(String(enviado));
    const bufferEsperado = Buffer.from(esperado);

    const valido =
        bufferEnviado.length === bufferEsperado.length &&
        crypto.timingSafeEqual(bufferEnviado, bufferEsperado);

    if (!valido) {
        console.warn(`CSRF inválido em ${req.method} ${req.originalUrl}`);
        req.flash('error_msg', 'Sessão expirada ou requisição inválida. Recarregue a página e tente novamente.');
        return res.redirect(req.get('referer') || '/');
    }

    next();
}
