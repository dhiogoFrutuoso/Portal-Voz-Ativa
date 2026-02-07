import express from 'express';
import handlebars from 'express-handlebars';
import bodyParser from 'body-parser';
import mongoose from 'mongoose';
import path from 'path';
import session from 'express-session';
import flash from 'connect-flash';
import passport from 'passport';
import { fileURLToPath } from 'url';
import moment from 'moment';
import { engine } from 'express-handlebars';
import admin from "./routes/admin.js";
import users from './routes/user.js';
import categories from './routes/categories.js';
import project from './routes/project.js';
import auth from './config/auth.js';
import db from './config/db.js';
import './models/user.js';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

auth(passport);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- CONFIGURAÇÕES ---

// Passport
app.use(session({
    secret: 'secretKeyVozAtiva', // Chave de segurança para o ecossistema digital
    resave: true,
    saveUninitialized: true
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

// Middleware
app.use((req, res, next) => {
    res.locals.success_msg = req.flash("success_msg");
    res.locals.error_msg = req.flash("error_msg");
    res.locals.error = req.flash("error");
    res.locals.user = req.user || null; // Essencial para o Hub identificar o usuário logado
    next();
});

// BodyParser
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(bodyParser.json({ limit: '50mb' }));

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

// Arquivos Estáticos (CSS, JS e Imagens dos Chamados)
app.use(express.static(path.join(__dirname, 'public')));

// Mongoose
mongoose.Promise = global.Promise;
mongoose.connect(db.mongoURI)
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
});