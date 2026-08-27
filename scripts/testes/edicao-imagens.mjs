/*
 * Regressão: editar uma publicação não pode fazer a imagem sumir.
 *
 * O formulário é lido da página REALMENTE renderizada e reenviado como o
 * navegador faria — foi assim que o bug apareceu: a tela mostra a URL com a
 * transformação de entrega (WebP) e publicações antigas guardam a imagem em
 * base64, então o valor da tela nunca batia com o que estava salvo.
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
await mongoose.connect(mongoEmMemoria.getUri('edicao-imagens'), { serverSelectionTimeoutMS: 30000 });

await import('../../src/models/user.js');
await import('../../src/models/categories.js');
await import('../../src/models/denuncias.js');
await import('../../src/models/vitrine.js');

const { default: edicao } = await import('../../src/routes/edicao.js');
const { otimizarMidiaNaRenderizacao } = await import('../../src/helpers/midia.js');

const User = mongoose.model('users');
const Chamado = mongoose.model('chamados');
const Vitrine = mongoose.model('vitrine');

const autor = await User.create({ name: 'Autor', email: `a${Date.now()}@t.local`, password: 'x' });

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true, limit: '8mb' }));
app.use(session({ secret: 't', resave: false, saveUninitialized: true }));
app.use(flash());
app.use((req, res, next) => {
    req.user = autor;
    req.isAuthenticated = () => true;
    res.locals.csrfToken = 't';
    res.locals.user = autor;
    res.locals.cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
    res.locals.cloudinaryUploadPreset = 'Portal-Voz-Ativa';
    next();
});
app.engine('handlebars', handlebars.engine({
    defaultLayout: 'main',
    helpers: {
        eq: (a, b) => a === b, gt: (a, b) => a > b,
        slice: (s, a, b) => (typeof s === 'string' ? s.slice(a, b) : ''),
        ifNotEquals: function (a, b, o) { return a !== b ? o.fn(this) : o.inverse(this); },
        formatDate: (d) => moment(d).format('DD/MM/YYYY'), formatDay: (d) => moment(d).format('DD/MM/YYYY'),
        fromNow: (d) => moment(d).locale('pt-br').fromNow(), concat: (...a) => a.slice(0, -1).join(''),
        recortar: (t) => t || ''
    },
    runtimeOptions: { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true }
}));
app.set('view engine', 'handlebars');
app.set('views', path.join(RAIZ, 'src', 'views'));
app.use(otimizarMidiaNaRenderizacao);
app.use('/categories', edicao);

const servidor = app.listen(0);
const BASE = `http://127.0.0.1:${servidor.address().port}`;

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
const URL_A = `https://res.cloudinary.com/${CLOUD}/image/upload/v1771469582/a.png`;
const URL_B = `https://res.cloudinary.com/${CLOUD}/image/upload/v1771469583/b.png`;
const URL_NOVA = `https://res.cloudinary.com/${CLOUD}/image/upload/v1771469999/nova.png`;
const BASE64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';

let falhas = 0;
const checar = (ok, texto, detalhe = '') => {
    console.log(`${ok ? 'ok    ' : 'FALHA '} ${texto}${detalhe ? '  (' + detalhe + ')' : ''}`);
    if (!ok) falhas++;
};

// Lê os índices que o formulário renderizado carrega
async function abrirEditor(eixo, id) {
    const html = await (await fetch(`${BASE}/categories/${eixo}/editar/${id}`)).text();
    return [...html.matchAll(/name="imagens_mantidas\[\]"\s+value="([^"]*)"/g)].map((m) => m[1]);
}

async function salvar(eixo, id, campos, mantidos, novas = []) {
    const corpo = new URLSearchParams({ _csrf: 't', ...campos });
    for (const i of mantidos) corpo.append('imagens_mantidas[]', i);
    for (const u of novas) corpo.append('imagens_urls[]', u);

    return fetch(`${BASE}/categories/${eixo}/editar/${id}`, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: corpo.toString()
    });
}

const CAMPOS_MELHORIA = {
    titulo: 'Poste queimado',
    descricao: 'Sem iluminação na rua há uma semana.',
    localizacao: 'Centro, Cariús'
};

try {
    console.log('--- Publicação com imagens do Cloudinary ---');
    const chamado = await Chamado.create({ ...CAMPOS_MELHORIA, imagens: [URL_A, URL_B], usuario: autor._id });
    const id = String(chamado._id);

    let mantidos = await abrirEditor('gestao_de_melhorias', id);
    checar(mantidos.length === 2, 'formulário lista as duas imagens', mantidos.join(','));

    await salvar('gestao_de_melhorias', id, CAMPOS_MELHORIA, mantidos);
    let doc = await Chamado.findById(id).lean();
    checar(doc.imagens.length === 2, 'as duas imagens continuam na publicação', `${doc.imagens.length}`);
    checar(doc.imagens[0] === URL_A && doc.imagens[1] === URL_B, 'URLs gravadas idênticas às originais');
    checar(!doc.imagens.some((u) => u.includes('f_auto')), 'transformação de entrega não é gravada no banco');

    console.log('\n--- Removendo só a segunda imagem ---');
    await salvar('gestao_de_melhorias', id, CAMPOS_MELHORIA, ['0']);
    doc = await Chamado.findById(id).lean();
    checar(doc.imagens.length === 1 && doc.imagens[0] === URL_A, 'sobra apenas a imagem mantida');

    console.log('\n--- Acrescentando uma imagem nova ---');
    await salvar('gestao_de_melhorias', id, CAMPOS_MELHORIA, ['0'], [URL_NOVA]);
    doc = await Chamado.findById(id).lean();
    checar(doc.imagens.length === 2 && doc.imagens[1] === URL_NOVA, 'imagem nova entra junto com a antiga');

    console.log('\n--- Índice inválido não quebra nem apaga ---');
    await salvar('gestao_de_melhorias', id, CAMPOS_MELHORIA, ['0', '1', '99', 'abc', '-3']);
    doc = await Chamado.findById(id).lean();
    checar(doc.imagens.length === 2, 'índices fora da faixa são ignorados', `${doc.imagens.length}`);

    console.log('\n--- Publicação antiga, com imagem em base64 ---');
    const anuncio = await Vitrine.create({
        categoria: 'Alimentação', titulo: 'Bolo de pote', descricao: 'Vendo bolos caseiros.',
        contato: '88999999999', localizacao: 'Centro', imagens: [BASE64], usuario: autor._id
    });
    const idAnuncio = String(anuncio._id);

    mantidos = await abrirEditor('vitrine_do_trabalhador', idAnuncio);
    checar(mantidos.length === 1, 'imagem legada aparece no editor');

    await salvar('vitrine_do_trabalhador', idAnuncio, {
        categoria: 'Alimentação', titulo: 'Bolo de pote', descricao: 'Vendo bolos caseiros e doces.',
        contato: '88999999999', localizacao: 'Centro'
    }, mantidos);

    const anuncioSalvo = await Vitrine.findById(idAnuncio).lean();
    checar(anuncioSalvo.imagens.length === 1 && anuncioSalvo.imagens[0] === BASE64,
        'imagem em base64 sobrevive à edição', `${anuncioSalvo.imagens.length} imagem(ns)`);
    checar(anuncioSalvo.descricao.includes('doces'), 'a edição em si foi gravada');
    checar(Boolean(anuncioSalvo.editadoEm), 'vitrine registra a marca de edição');
} finally {
    servidor.close();
    await mongoose.disconnect();
    await mongoEmMemoria.stop();
}

console.log(falhas === 0 ? '\nImagens preservadas em todos os casos.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
