import 'dotenv/config';

import express from 'express';
import handlebars from 'express-handlebars';
import mongoose from 'mongoose';
import path from 'path';
import session from 'express-session';
import flash from 'connect-flash';
import passport from 'passport';
import { fileURLToPath } from 'url';
import moment from 'moment';
import { engine } from 'express-handlebars';
import rateLimit from 'express-rate-limit';
import { securityHeaders, forceHttps, sanitizeMongo, csrfProtection } from './config/security.js';
import admin from "./routes/admin.js";
import users from './routes/user.js';
import categories from './routes/categories.js';
import project from './routes/project.js';
import auth from './config/auth.js';
import db from './config/db.js';
import './models/user.js';

const app = express();

// A mídia sobe direto do navegador para o Cloudinary; pelo servidor passa apenas
// a foto de perfil em base64, limitada a 5 MB no validador.
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ limit: '8mb', extended: true }));
app.use(sanitizeMongo);

auth(passport);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- VARIÁVEIS DE AMBIENTE ---
// Os valores públicos (cloud do Cloudinary, preset de upload e site key do reCAPTCHA)
// ficam expostos no HTML de qualquer forma, então mantemos um padrão embutido para o
// deploy não quebrar caso a variável não esteja definida no Render/Vercel.
const isProduction = process.env.NODE_ENV === 'production';
const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
const CLOUDINARY_UPLOAD_PRESET = process.env.CLOUDINARY_UPLOAD_PRESET || 'Portal-Voz-Ativa';
const RECAPTCHA_SITE_KEY = process.env.RECAPTCHA_SITE_KEY || '6LcE53YtAAAAABUiDGr2DSTfhu3oCFhPEkOa8LCV';

// Já os segredos não têm padrão seguro: avisamos alto e claro se faltarem.
const requiredEnv = ['CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'RECAPTCHA_SECRET', 'SESSION_SECRET'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
    console.warn(`AVISO: variáveis de ambiente ausentes -> ${missingEnv.join(', ')}`);
}

if (!process.env.SESSION_SECRET) {
    console.warn('AVISO: SESSION_SECRET ausente. Usando chave padrão — defina uma no ambiente.');
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

app.use(session({
    secret: process.env.SESSION_SECRET || 'secretKeyVozAtiva', // Chave de segurança para o ecossistema digital
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: 'auto', // HTTPS em produção, HTTP no ambiente local — decidido pela conexão
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 dias
    }
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use(csrfProtection);

// Middleware
app.use((req, res, next) => {
    res.locals.success_msg = req.flash("success_msg");
    res.locals.error_msg = req.flash("error_msg");
    res.locals.error = req.flash("error");
    res.locals.user = req.user || null; // Essencial para o Hub identificar o usuário logado
    res.locals.cloudinaryCloudName = CLOUDINARY_CLOUD_NAME;
    res.locals.cloudinaryUploadPreset = CLOUDINARY_UPLOAD_PRESET;
    res.locals.recaptchaSiteKey = RECAPTCHA_SITE_KEY;
    next();
});

const Limiter = rateLimit({
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
        }
    },
    runtimeOptions: {
        allowProtoPropertiesByDefault: true,
        allowProtoMethodsByDefault: true,
    }
}));

app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));

// Mongoose
mongoose.set('strictQuery', true)
mongoose.Promise = global.Promise;
mongoose.connect(db.mongoURI, { serverSelectionTimeoutMS: 120000 })
    .then(() => {
        console.log('Conectado ao MongoDB do Voz Ativa com sucesso!');
    }).catch((err) => {
        console.log('Erro ao conectar ao banco de dados: ' + err);
    });

// --- ROTAS ---

app.get('/', (req, res) => {
    res.render('index');
});

app.use('/categories', categories);
app.use('/admin', admin);
app.use('/users', users);
app.use('/project', project);

// --- INICIALIZAÇÃO ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Servidor rodando em http://localhost:${PORT}`);
    console.log(`Portal Voz Ativa - Cariús 2026`);
    console.log(`Ambiente: ${isProduction ? 'produção' : 'desenvolvimento'}`);
});