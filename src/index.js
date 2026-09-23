import 'dotenv/config';
import conta from './routes/conta.js';
import uploads, { validarMidiasRecebidas } from './routes/uploads.js';
import { contexto } from './helpers/request-context.js';
import { protegerSaida } from './helpers/governanca.js';
import { registrarAcesso } from './helpers/access-log.js';
import legal from './routes/legal.js';

import express from 'express';
import handlebars from 'express-handlebars';
import path from 'path';
import flash from 'connect-flash';
import passport from 'passport';
import { fileURLToPath } from 'url';
import moment from 'moment';
import { limitarRequisicoes } from './config/rate-limit.js';
import { criarSessao } from './config/session.js';
import { securityHeaders, forceHttps, sanitizeMongo, csrfProtection } from './config/security.js';
import { otimizarMidiaNaRenderizacao } from './helpers/midia.js';
import admin from "./routes/admin.js";
import users from './routes/user.js';
import categories from './routes/categories.js';
import project from './routes/project.js';
import protocolos from './routes/protocolos.js';
import edicao from './routes/edicao.js';
import auth from './config/auth.js';
import { conectarBanco } from './config/db.js';
import './models/user.js';

const app = express();

// Arquivos sobem diretamente ao Cloudinary. O Express recebe campos e URLs,
// evitando ultrapassar o limite de payload da Vercel.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
app.use(sanitizeMongo);

auth(passport);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- VARIÁVEIS DE AMBIENTE ---
// Cloud e chave pública do reCAPTCHA são configurados por ambiente. A chave
// precisa ser configurada para v3 e para o domínio deste ambiente.
const isProduction = process.env.NODE_ENV === 'production';
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '';

// Já os segredos não têm padrão seguro: avisamos alto e claro se faltarem.
/*
 * Os estáticos são servidos com cache de 7 dias. Sem uma marca na URL, um CSS
 * corrigido só chegaria ao visitante depois que o cache expirasse — por isso a
 * versão entra como parâmetro nos links do layout.
 */
const VERSAO_ESTATICOS = process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || String(Date.now());

const requiredEnv = ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'RECAPTCHA_SITE_KEY', 'RECAPTCHA_SECRET', 'JWT_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
    console.warn(`AVISO: variáveis de ambiente ausentes -> ${missingEnv.join(', ')}`);
}

if (isProduction && (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32)) {
    throw new Error('Configure JWT_SECRET com pelo menos 32 caracteres em produção.');
}

if (!process.env.JWT_SECRET) {
    console.warn('AVISO: JWT_SECRET ausente. Usando chave padrão — defina uma no ambiente.');
}

// --- CONFIGURAÇÕES ---

// Passport
// O Render e a Vercel colocam o app atrás de um proxy: sem isso o cookie "secure"
// não é enviado e o req.protocol não reflete o esquema original da requisição.
app.set('trust proxy', 1);
app.use(securityHeaders);
app.use(forceHttps);

// Arquivos estáticos (CSS, JS e imagens) vêm antes da sessão e do rate limit:
// não devem criar sessão nem consumir a cota de requisições do visitante.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '7d' }));

// Conexão e store são reutilizados pelas requisições da instância aquecida.
let middlewareSessao;
app.use(async (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    try {
        const conexao = await conectarBanco();
        if (!middlewareSessao) {
            middlewareSessao = criarSessao(conexao, process.env.JWT_SECRET || 'secretKeyVozAtiva');
        }
        if (req.path === '/health' && req.method === 'GET') {
            return res.json({ status: 'ok' });
        }
        middlewareSessao(req, res, next);
    } catch {
        console.error('Não foi possível inicializar a conexão com o banco.');
        res.status(503).send('Serviço temporariamente indisponível. Tente novamente em instantes.');
    }
});

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use(csrfProtection);
app.use(contexto);
app.use(protegerSaida);
app.use(registrarAcesso);

// Entrega as imagens do Cloudinary em WebP/AVIF, sem alterar o que está no banco.
app.use(otimizarMidiaNaRenderizacao);

// Middleware
app.use((req, res, next) => {
    res.locals.success_msg = req.flash("success_msg");
    res.locals.error_msg = req.flash("error_msg");
    res.locals.error = req.flash("error");
    res.locals.user = req.user || null; // Essencial para o Hub identificar o usuário logado
    res.locals.cloudinaryCloudName = CLOUDINARY_CLOUD_NAME;
    res.locals.recaptchaSiteKey = RECAPTCHA_SITE_KEY;
    res.locals.versaoEstaticos = VERSAO_ESTATICOS;
    next();
});

const Limiter = limitarRequisicoes('global', {
    windowMs: 10*60*1000,
    max: 300,
    message: "Muitas requisições desse IP, tente novamente daqui a 10 minutos.",
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(Limiter);


// Handlebars
app.engine('handlebars', handlebars.engine({
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views', 'layouts'),
    partialsDir: path.join(__dirname, 'views', 'partials'),
    helpers: {
        eq: function (v1, v2) {
            return v1 === v2;
        },
        ifNotEquals: function (arg1, arg2, options) {
            return (arg1 !== arg2) ? options.fn(this) : options.inverse(this);
        },
        slice: function(str, start, end) {
            if (typeof str === 'string') {
                return str.slice(start, end);
            }
            return "";
        },
        gt: function(a, b) {
            return a > b;
        },
        formatDate: (date) => {
            return moment(date).format('DD/MM/YYYY [às] HH:mm');
        },
        formatDay: (date) => {
            return moment(date).format('DD/MM/YYYY');
        },
        // "há 3 dias", usado na linha do tempo do protocolo
        fromNow: (date) => {
            return moment(date).locale('pt-br').fromNow();
        },
        // Concatena valores para montar links e ids nas views
        concat: (...args) => {
            return args.slice(0, -1).join('');
        },
        // Recorta um texto longo preservando a palavra final
        recortar: (texto, limite) => {
            const maximo = typeof limite === 'number' ? limite : 140;
            if (typeof texto !== 'string' || texto.length <= maximo) return texto || '';
            return texto.slice(0, texto.lastIndexOf(' ', maximo)) + '…';
        }
    },
    runtimeOptions: {
        allowProtoPropertiesByDefault: true,
        allowProtoMethodsByDefault: true,
    }
}));

app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// --- ROTAS ---
app.use('/uploads', uploads);
app.use(validarMidiasRecebidas);
app.use(conta);
app.use(legal);

app.get('/', (req, res) => {
    res.render('index');
});

app.use('/categories', edicao);
app.use('/categories', categories);
app.use('/admin', admin);
app.use('/users', users);
app.use('/project', project);
app.use('/protocolos', protocolos);

// A Vercel importa o app, sem abrir porta. npm start continua funcionando.
export default app;

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const grande = error.type === 'entity.too.large';
    const invalido = error.type === 'entity.parse.failed';
    console.error('Falha na requisição:', grande ? 'payload excedido' : invalido ? 'JSON inválido' : 'erro interno');
    res.status(grande ? 413 : invalido ? 400 : 500).send(grande
        ? 'Envie os arquivos pelo seletor de mídia. O formulário excedeu o tamanho permitido.'
        : 'Não foi possível concluir a solicitação. Tente novamente.');
});

if (!process.env.VERCEL && process.argv[1] && path.resolve(process.argv[1]) === __filename) {
    const PORT = process.env.PORT || 8080;
    try {
        await conectarBanco();
        app.listen(PORT, () => console.log('Portal Voz Ativa em http://localhost:' + PORT));
    } catch {
        console.error('Servidor não iniciado: verifique a configuração e o acesso ao MongoDB.');
        process.exitCode = 1;
    }
}
// [Melhoria Proativa Adicionada: validações e integrações de governança aplicadas ao fluxo existente]
