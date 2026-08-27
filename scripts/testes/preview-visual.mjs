/*
 * Servidor de pré-visualização visual — NÃO faz parte da suíte de testes.
 *
 * Sobe os roteadores e assets REAIS do portal contra um MongoDB em memória,
 * com um usuário admin já autenticado, para inspecionar no navegador telas
 * que normalmente exigem login (painel do admin, protocolos).
 *
 * Uso: node scripts/testes/preview-visual.mjs
 * Encerre com Ctrl+C.
 */
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import flash from 'connect-flash';
import mongoose from 'mongoose';
import handlebars from 'express-handlebars';
import moment from 'moment';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(__dirname, '..', '..');

const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoEmMemoria = await MongoMemoryServer.create();
await mongoose.connect(mongoEmMemoria.getUri('preview-visual'), { serverSelectionTimeoutMS: 30000 });

await import('../../src/models/user.js');
await import('../../src/models/categories.js');
await import('../../src/models/denuncias.js');
await import('../../src/models/vitrine.js');

const { default: protocolos } = await import('../../src/routes/protocolos.js');
const { default: admin } = await import('../../src/routes/admin.js');
const { default: edicao } = await import('../../src/routes/edicao.js');
const { default: categorias } = await import('../../src/routes/categories.js');
const { default: users } = await import('../../src/routes/user.js');
const { otimizarMidiaNaRenderizacao } = await import('../../src/helpers/midia.js');

const User = mongoose.model('users');
const Chamado = mongoose.model('chamados');
const Denuncia = mongoose.model('denuncias');
const Vitrine = mongoose.model('vitrine');

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
const IMG = (nome) => `https://res.cloudinary.com/${CLOUD}/image/upload/f_auto,q_auto/v1/${nome}.jpg`;

const gestor = await User.create({ name: 'Gestor Municipal', email: 'gestor@preview.local', password: 'x', areAdmin: true });
const cidadao = await User.create({ name: 'Maria Souza', email: 'maria@preview.local', password: 'x', profession: 'Autônoma' });

await Chamado.create({
    titulo: 'Asfalto desgastado', descricao: 'Necessidade de reparo no asfalto do bairro São Vicente.',
    localizacao: 'Rua Jonas Oliveira Lopes, Cariús', imagens: [IMG('a')],
    usuario: cidadao._id, status: 'Em Atendimento',
    historico: [{ autor: cidadao._id, papel: 'cidadao', texto: 'Piorou com a chuva.', createdAt: new Date() }]
});
await Chamado.create({
    titulo: 'Postes não funcionais', descricao: 'Problema de iluminação na rua, os postes pararam de funcionar.',
    localizacao: 'Rua Padre José Sobreira, Cariús', imagens: [IMG('b')], usuario: cidadao._id, status: 'Novo'
});
await Denuncia.create({
    tipoOcorrencia: 'Vandalismo', titulo: 'Vandalismo',
    descricao: 'Durante um protesto, atearam fogo em um ônibus.',
    localizacao: 'Rua Pascoal Stopelli, Cariús', imagens: [IMG('c')],
    usuario: cidadao._id, status: 'Novo', privada: true
});
await Denuncia.create({
    tipoOcorrencia: 'Foco de Queimada', titulo: 'Foco de Queimada',
    descricao: 'Queimada no topo da serra.', localizacao: 'Cariús, Serra',
    imagens: [IMG('d')], usuario: cidadao._id, status: 'Novo', privada: false
});
await Vitrine.create({
    categoria: 'Alimentação', titulo: 'Bolo de pote', descricao: 'Vendo bolos de pote, faço entrega na sede de Cariús.',
    contato: '88999999999', localizacao: 'Rua Primeiro de Maio, Cariús',
    imagens: [IMG('e')], usuario: cidadao._id
});

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'preview', resave: false, saveUninitialized: true }));
app.use(flash());

// ?como=gestor|cidadao faz login por SESSÃO (persiste via cookie, como no app
// real) — assim os fetch() do busca-viva.js carregam a identidade sozinhos.
const usuarios = { gestor, cidadao };
app.use((req, res, next) => {
    if (req.query.como && usuarios[req.query.como]) {
        req.session.usuarioChave = req.query.como;
    }
    const chave = req.session.usuarioChave;
    req.user = chave ? usuarios[chave] : undefined;
    req.isAuthenticated = () => Boolean(req.user);
    req.flash = req.flash || (() => []);
    res.locals.csrfToken = 'token-preview';
    req.session.csrfToken = 'token-preview';
    res.locals.user = req.user || null;
    res.locals.cloudinaryCloudName = CLOUD;
    res.locals.cloudinaryUploadPreset = 'Portal-Voz-Ativa';
    res.locals.recaptchaSiteKey = 'preview';
    res.locals.versaoEstaticos = 'preview';
    next();
});

app.engine('handlebars', handlebars.engine({
    defaultLayout: 'main',
    helpers: {
        eq: (a, b) => a === b,
        ifNotEquals: function (a, b, o) { return a !== b ? o.fn(this) : o.inverse(this); },
        slice: (s, a, b) => (typeof s === 'string' ? s.slice(a, b) : ''),
        gt: (a, b) => a > b,
        formatDate: (d) => moment(d).format('DD/MM/YYYY [às] HH:mm'),
        formatDay: (d) => moment(d).format('DD/MM/YYYY'),
        fromNow: (d) => moment(d).locale('pt-br').fromNow(),
        concat: (...a) => a.slice(0, -1).join(''),
        recortar: (t, l) => (typeof t === 'string' && t.length > (l || 140) ? t.slice(0, l) + '…' : t || '')
    },
    runtimeOptions: { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true }
}));
app.set('view engine', 'handlebars');
app.set('views', path.join(RAIZ, 'src', 'views'));
app.use(express.static(path.join(RAIZ, 'src', 'public')));
app.use(otimizarMidiaNaRenderizacao);

app.get('/', (req, res) => res.render('index'));
app.use('/protocolos', protocolos);
app.use('/admin', admin);
app.use('/categories', edicao);
app.use('/categories', categorias);
app.use('/users', users);

const PORTA = 4571;
app.listen(PORTA, () => {
    console.log(`Preview visual em http://localhost:${PORTA}`);
    console.log(`Admin (gestor):  http://localhost:${PORTA}/admin/painel?como=gestor`);
    console.log(`Cidadão:         http://localhost:${PORTA}/protocolos?como=cidadao`);
    console.log(`Público:         http://localhost:${PORTA}/categories/denuncias_sigilosas/hub`);
});
