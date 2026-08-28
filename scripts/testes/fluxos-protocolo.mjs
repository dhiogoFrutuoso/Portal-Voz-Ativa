/*
 * Teste de integração dos fluxos novos: protocolo, painel do admin e editor.
 *
 * Sobe os roteadores REAIS num app de teste, com autenticação simulada, contra
 * um MongoDB em memória. Nada toca o banco de produção nem o de desenvolvimento.
 *
 * Uso: node scripts/testes/fluxos-protocolo.mjs
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

// --- Banco em memória, isolado de qualquer ambiente real ---
const { MongoMemoryServer } = await import('mongodb-memory-server');
const mongoEmMemoria = await MongoMemoryServer.create();

await mongoose.connect(mongoEmMemoria.getUri('voz-ativa-teste'), { serverSelectionTimeoutMS: 30000 });
console.log(`MongoDB em memória: ${mongoose.connection.name}\n`);

await import('../../src/models/user.js');
await import('../../src/models/categories.js');
await import('../../src/models/denuncias.js');
await import('../../src/models/vitrine.js');

const { default: protocolos } = await import('../../src/routes/protocolos.js');
const { default: admin } = await import('../../src/routes/admin.js');
const { default: edicao } = await import('../../src/routes/edicao.js');
const { default: categorias } = await import('../../src/routes/categories.js');
const { otimizarMidiaNaRenderizacao } = await import('../../src/helpers/midia.js');
const { novidadesDoProtocolo } = await import('../../src/helpers/protocolo.js');

const User = mongoose.model('users');
const Chamado = mongoose.model('chamados');
const Denuncia = mongoose.model('denuncias');

// --- Usuários de teste ---
const autor = await User.create({ name: 'Autor Teste', email: `autor${Date.now()}@teste.local`, password: 'x', areAdmin: false });
const outro = await User.create({ name: 'Outro Teste', email: `outro${Date.now()}@teste.local`, password: 'x', areAdmin: false });
const gestor = await User.create({ name: 'Gestor Teste', email: `gestor${Date.now()}@teste.local`, password: 'x', areAdmin: true });

// --- App de teste com os roteadores reais ---
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'teste', resave: false, saveUninitialized: true }));
app.use(flash());

// Autenticação simulada: o cabeçalho x-teste-usuario escolhe quem está logado.
const usuarios = { autor, outro, gestor };
app.use((req, res, next) => {
    const chave = req.get('x-teste-usuario');
    req.user = chave ? usuarios[chave] : undefined;
    req.isAuthenticated = () => Boolean(req.user);
    req.session.csrfToken = 'token-teste';
    res.locals.csrfToken = 'token-teste';
    res.locals.user = req.user || null;
    res.locals.cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r';
    res.locals.cloudinaryUploadPreset = 'Portal-Voz-Ativa';
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
app.use(otimizarMidiaNaRenderizacao);

app.use('/protocolos', protocolos);
app.use('/admin', admin);
app.use('/categories', edicao);
app.use('/categories', categorias);

const servidor = app.listen(0);
const PORTA = servidor.address().port;
const BASE = `http://127.0.0.1:${PORTA}`;

// --- Utilitários ---
let falhas = 0;
const checar = (ok, texto, detalhe = '') => {
    console.log(`${ok ? 'ok    ' : 'FALHA '} ${texto}${detalhe ? '  (' + detalhe + ')' : ''}`);
    if (!ok) falhas++;
};

const pedir = (rota, { como, metodo = 'GET', corpo } = {}) =>
    fetch(BASE + rota, {
        method: metodo,
        redirect: 'manual',
        headers: {
            ...(como ? { 'x-teste-usuario': como } : {}),
            ...(corpo ? { 'content-type': 'application/x-www-form-urlencoded' } : {})
        },
        body: corpo ? new URLSearchParams({ _csrf: 'token-teste', ...corpo }).toString() : undefined
    });

// Recorta o pedaço de HTML de um protocolo dentro de uma listagem, para as
// asserções não pegarem texto de outro card da mesma página.
function trechoDoProtocolo(html, titulo) {
    const inicio = html.indexOf(titulo);
    if (inicio === -1) return '';
    const anterior = html.lastIndexOf('item-filtravel', inicio);
    const seguinte = html.indexOf('item-filtravel', inicio);
    return html.slice(anterior === -1 ? inicio : anterior, seguinte === -1 ? html.length : seguinte);
}

const IMG = 'https://res.cloudinary.com/' + (process.env.CLOUDINARY_CLOUD_NAME || 'dnh7vok3r') + '/image/upload/v1/teste.png';

try {
    // --- Cenário ---
    const chamado = await Chamado.create({
        titulo: 'Buraco na rua principal',
        descricao: 'Buraco grande atrapalhando o trânsito.',
        localizacao: 'Centro, Cariús',
        imagens: [IMG],
        usuario: autor._id,
        status: 'Aberto' // status legado, para validar a normalização
    });
    const id = String(chamado._id);
    console.log('Chamado de teste criado.\n');

    console.log('--- Linha do tempo: visibilidade ---');
    checar((await pedir(`/protocolos/melhoria/${id}`, { como: 'autor' })).status === 200, 'autor abre seu protocolo');
    checar((await pedir(`/protocolos/melhoria/${id}`, { como: 'gestor' })).status === 200, 'gestão abre o protocolo');
    const alheio = await pedir(`/protocolos/melhoria/${id}`, { como: 'outro' });
    checar(alheio.status === 302, 'terceiro é barrado da linha do tempo', `status ${alheio.status}`);

    const htmlAutor = await (await pedir(`/protocolos/melhoria/${id}`, { como: 'autor' })).text();
    checar(htmlAutor.includes('Novo'), 'status legado "Aberto" é exibido como "Novo"');
    checar(htmlAutor.includes('10 dias úteis'), 'cláusula de prazo padrão aparece');
    checar(!htmlAutor.includes('Painel da gestão'), 'cidadão não vê o painel da gestão');

    console.log('\n--- Resposta do cidadão na linha do tempo ---');
    const resposta = await pedir(`/protocolos/melhoria/${id}/responder`, {
        como: 'autor', metodo: 'POST', corpo: { texto: 'O buraco aumentou com a chuva.', imagem_url: IMG }
    });
    checar(resposta.status === 302, 'resposta aceita');
    let doc = await Chamado.findById(id).lean();
    checar(doc.historico.length === 1, 'histórico gravado', `${doc.historico.length} item(ns)`);
    checar(doc.historico[0].papel === 'cidadao', 'papel registrado como cidadão');
    checar(doc.historico[0].imagem === IMG, 'imagem da resposta gravada');

    console.log('\n--- Imagem de fora do Cloudinary é recusada ---');
    await pedir(`/protocolos/melhoria/${id}/responder`, {
        como: 'autor', metodo: 'POST', corpo: { texto: 'Tentando anexar de fora.', imagem_url: 'https://site-malicioso.example/x.png' }
    });
    doc = await Chamado.findById(id).lean();
    checar(doc.historico[1] && doc.historico[1].imagem === null, 'URL externa descartada, mensagem preservada');

    console.log('\n--- Mudança de estágio pela gestão ---');
    const semPermissao = await pedir(`/admin/protocolo/melhoria/${id}/status`, {
        como: 'outro', metodo: 'POST', corpo: { status: 'Resolvido' }
    });
    doc = await Chamado.findById(id).lean();
    checar(semPermissao.status === 302 && doc.status === 'Aberto', 'usuário comum não altera estágio');

    await pedir(`/admin/protocolo/melhoria/${id}/status`, {
        como: 'gestor', metodo: 'POST', corpo: { status: 'Em Atendimento', texto: 'Equipe a caminho.', prazoDias: '30' }
    });
    doc = await Chamado.findById(id).lean();
    checar(doc.status === 'Em Atendimento', 'estágio alterado pela gestão', doc.status);
    checar(doc.prazoDias === 30 && doc.prazoAjustado === true, 'prazo ajustado gravado');
    const ultimo = doc.historico[doc.historico.length - 1];
    checar(ultimo.papel === 'admin' && ultimo.statusNovo === 'Em Atendimento', 'mudança registrada no histórico');

    console.log('\n--- Estágio inválido é recusado ---');
    await pedir(`/admin/protocolo/melhoria/${id}/status`, {
        como: 'gestor', metodo: 'POST', corpo: { status: 'Apagado' }
    });
    doc = await Chamado.findById(id).lean();
    checar(doc.status === 'Em Atendimento', 'estágio fora da lista não é gravado', doc.status);

    console.log('\n--- Painel do admin ---');
    checar((await pedir('/admin/painel', { como: 'gestor' })).status === 200, 'gestão acessa o painel');
    checar((await pedir('/admin/painel', { como: 'outro' })).status === 302, 'usuário comum é barrado do painel');
    const painel = await (await pedir('/admin/painel?q=buraco&tipo=melhoria', { como: 'gestor' })).text();
    checar(painel.includes('Buraco na rua principal'), 'busca do painel encontra o protocolo');
    const painelVazio = await (await pedir('/admin/painel?q=inexistentexyz', { como: 'gestor' })).text();
    checar(!painelVazio.includes('Buraco na rua principal'), 'busca sem correspondência não lista o protocolo');

    console.log('\n--- Aviso de novidade ---');
    doc = await Chamado.findById(id).lean();
    let novidades = novidadesDoProtocolo(doc);
    checar(novidades.paraOAutor === true, 'autor é avisado da resposta da gestão');

    await pedir(`/protocolos/melhoria/${id}`, { como: 'autor' });
    doc = await Chamado.findById(id).lean();
    novidades = novidadesDoProtocolo(doc);
    checar(novidades.paraOAutor === false, 'aviso some depois que o autor abre o protocolo');

    await pedir(`/protocolos/melhoria/${id}/responder`, {
        como: 'autor', metodo: 'POST', corpo: { texto: 'Obrigado pelo retorno da equipe.' }
    });
    doc = await Chamado.findById(id).lean();
    novidades = novidadesDoProtocolo(doc);
    checar(novidades.paraAGestao === true, 'gestão é avisada da resposta do cidadão');

    await pedir(`/protocolos/melhoria/${id}`, { como: 'gestor' });
    doc = await Chamado.findById(id).lean();
    checar(novidadesDoProtocolo(doc).paraAGestao === false, 'aviso some depois que a gestão abre');

    console.log('\n--- Edição de mensagem: só o autor dela ---');
    doc = await Chamado.findById(id).lean();
    const msgDoCidadao = doc.historico.find((m) => m.papel === 'cidadao' && !m.statusNovo);
    const msgDaGestao = doc.historico.find((m) => m.papel === 'admin');

    await pedir(`/protocolos/melhoria/${id}/mensagem/${msgDoCidadao._id}/editar`, {
        como: 'autor', metodo: 'POST', corpo: { texto: 'Texto corrigido pelo próprio autor.' }
    });
    doc = await Chamado.findById(id).lean();
    let atualizada = doc.historico.find((m) => String(m._id) === String(msgDoCidadao._id));
    checar(atualizada.texto === 'Texto corrigido pelo próprio autor.', 'autor edita a própria mensagem');
    checar(Boolean(atualizada.editadaEm), 'marca de edição registrada na mensagem');

    await pedir(`/protocolos/melhoria/${id}/mensagem/${msgDoCidadao._id}/editar`, {
        como: 'gestor', metodo: 'POST', corpo: { texto: 'Gestão tentando reescrever o cidadão.' }
    });
    doc = await Chamado.findById(id).lean();
    atualizada = doc.historico.find((m) => String(m._id) === String(msgDoCidadao._id));
    checar(atualizada.texto === 'Texto corrigido pelo próprio autor.', 'gestão NÃO edita mensagem do cidadão');

    await pedir(`/protocolos/melhoria/${id}/mensagem/${msgDaGestao._id}/editar`, {
        como: 'autor', metodo: 'POST', corpo: { texto: 'Cidadão tentando reescrever a gestão.' }
    });
    doc = await Chamado.findById(id).lean();
    const daGestao = doc.historico.find((m) => String(m._id) === String(msgDaGestao._id));
    checar(!daGestao.texto.includes('tentando'), 'cidadão NÃO edita mensagem da gestão');

    console.log('\n--- Exclusão de mensagem ---');
    const totalAntes = doc.historico.length;

    await pedir(`/protocolos/melhoria/${id}/mensagem/${msgDaGestao._id}/excluir`, { como: 'autor', metodo: 'POST' });
    doc = await Chamado.findById(id).lean();
    checar(doc.historico.length === totalAntes, 'cidadão NÃO exclui mensagem da gestão');

    await pedir(`/protocolos/melhoria/${id}/mensagem/${msgDaGestao._id}/excluir`, { como: 'gestor', metodo: 'POST' });
    doc = await Chamado.findById(id).lean();
    checar(doc.historico.length === totalAntes, 'registro de mudança de estágio não é excluído nem pelo autor dele');

    await pedir(`/protocolos/melhoria/${id}/mensagem/${msgDoCidadao._id}/excluir`, { como: 'gestor', metodo: 'POST' });
    doc = await Chamado.findById(id).lean();
    checar(doc.historico.length === totalAntes, 'gestão NÃO exclui mensagem do cidadão');

    await pedir(`/protocolos/melhoria/${id}/mensagem/${msgDoCidadao._id}/excluir`, { como: 'autor', metodo: 'POST' });
    doc = await Chamado.findById(id).lean();
    checar(doc.historico.length === totalAntes - 1, 'autor exclui a própria mensagem');

    console.log('\n--- Sigilo das denúncias ---');
    const queimada = await Denuncia.create({
        tipoOcorrencia: 'Foco de Queimada', titulo: 'Foco de Queimada',
        descricao: 'Fogo na vegetação perto da estrada.', localizacao: 'Serra',
        usuario: autor._id, privada: false
    });
    const vandalismo = await Denuncia.create({
        tipoOcorrencia: 'Vandalismo', titulo: 'Vandalismo',
        descricao: 'Depredação de patrimônio com envolvidos identificáveis.', localizacao: 'Praça',
        usuario: autor._id, privada: true
    });

    const hubAnonimo = await (await pedir('/categories/denuncias_sigilosas/hub')).text();
    checar(hubAnonimo.includes('Foco de Queimada'), 'incêndio aparece no hub público');
    checar(!hubAnonimo.includes('Depredação de patrimônio'), 'denúncia sigilosa não aparece para visitante');

    const hubTerceiro = await (await pedir('/categories/denuncias_sigilosas/hub', { como: 'outro' })).text();
    checar(!hubTerceiro.includes('Depredação de patrimônio'), 'sigilosa não aparece para outro usuário logado');

    // No hub, sigilosa é exclusiva da gestão — nem quem denunciou vê a própria
    // ali. O autor acompanha pelo protocolo, não pela listagem pública.
    const hubAutor = await (await pedir('/categories/denuncias_sigilosas/hub', { como: 'autor' })).text();
    checar(!hubAutor.includes('Depredação de patrimônio'), 'autor NÃO vê a própria sigilosa no hub público');

    // NENHUMA sigilosa aparece no hub — nem para a gestão. Ela trata essas
    // denúncias pelo painel do admin, que é a única listagem que as mostra.
    const hubGestor = await (await pedir('/categories/denuncias_sigilosas/hub', { como: 'gestor' })).text();
    checar(!hubGestor.includes('Depredação de patrimônio'), 'nem a gestão vê sigilosa no hub');

    const painelGestor = await (await pedir('/admin/painel', { como: 'gestor' })).text();
    checar(painelGestor.includes('Depredação de patrimônio'), 'a sigilosa aparece no painel do admin');
    // Recorta só o bloco da denúncia sigilosa: o painel também lista a
    // melhoria do mesmo autor, que continua (corretamente) identificada.
    const blocoSigilosa = trechoDoProtocolo(painelGestor, 'Depredação de patrimônio');
    checar(!blocoSigilosa.includes('Autor Teste'), 'painel não revela quem denunciou');
    checar(blocoSigilosa.includes('Denunciante anônimo'), 'painel mostra o denunciante como anônimo');

    const blocoMelhoria = trechoDoProtocolo(painelGestor, 'Buraco na rua principal');
    checar(blocoMelhoria.includes('Autor Teste'), 'melhoria continua identificando o autor');

    const detalheAlheio = await pedir(`/categories/denuncias_sigilosas/detalhes/${vandalismo._id}`, { como: 'outro' });
    checar(detalheAlheio.status === 302, 'acesso direto à sigilosa por terceiro é barrado');

    const detalheAutor = await pedir(`/categories/denuncias_sigilosas/detalhes/${vandalismo._id}`, { como: 'autor' });
    checar(detalheAutor.status === 200, 'autor continua acessando o detalhe da própria denúncia sigilosa direto pela URL');

    const protocoloAutor = await pedir(`/protocolos/denuncia/${vandalismo._id}`, { como: 'autor' });
    checar(protocoloAutor.status === 200, 'autor acompanha a própria denúncia sigilosa por Meus Protocolos');

    const buscaAnonima = await (await pedir('/categories/denuncias_sigilosas/hub/buscar?q=depreda')).text();
    checar(!buscaAnonima.includes('Depredação de patrimônio'), 'busca pública não revela denúncia sigilosa');

    const buscaAdmin = await (await pedir('/categories/denuncias_sigilosas/hub/buscar?q=depreda', { como: 'gestor' })).text();
    checar(!buscaAdmin.includes('Depredação de patrimônio'), 'busca do hub não revela sigilosa nem para a gestão');

    const buscaPublicaHub = await (await pedir('/categories/denuncias_sigilosas/hub/buscar?q=fogo', { como: 'gestor' })).text();
    checar(buscaPublicaHub.includes('<option value="Resolvido"'), 'seletor de estágio vem completo no resultado da busca');

    console.log('\n--- Anonimato do denunciante ---');
    const detalheSigilosa = await (await pedir(`/categories/denuncias_sigilosas/detalhes/${vandalismo._id}`, { como: 'gestor' })).text();
    checar(!detalheSigilosa.includes('Autor Teste'), 'detalhe da sigilosa não mostra o nome de quem denunciou');

    const timelineSigilosa = await (await pedir(`/protocolos/denuncia/${vandalismo._id}`, { como: 'gestor' })).text();
    checar(!timelineSigilosa.includes('Autor Teste'), 'linha do tempo da sigilosa não revela o denunciante');
    checar(timelineSigilosa.includes('Denunciante anônimo'), 'linha do tempo identifica como anônimo');

    // Sigilo não é esconder tudo: a denúncia pública de incêndio segue
    // com autor visível, como qualquer publicação aberta.
    const timelinePublica = await (await pedir(`/protocolos/denuncia/${queimada._id}`, { como: 'gestor' })).text();
    checar(timelinePublica.includes('Autor Teste'), 'denúncia pública de incêndio continua identificada');

    await pedir(`/admin/protocolo/denuncia/${vandalismo._id}/sigilo`, {
        como: 'outro', metodo: 'POST', corpo: { privada: '0' }
    });
    let vandalismoAtual = await Denuncia.findById(vandalismo._id).lean();
    checar(vandalismoAtual.privada === true, 'usuário comum não muda o sigilo');

    await pedir(`/admin/protocolo/denuncia/${vandalismo._id}/sigilo`, {
        como: 'gestor', metodo: 'POST', corpo: { privada: '0' }
    });
    vandalismoAtual = await Denuncia.findById(vandalismo._id).lean();
    checar(vandalismoAtual.privada === false, 'gestão libera a denúncia para o hub público');
    checar(
        vandalismoAtual.historico.some((m) => m.texto.includes('hub público')),
        'mudança de sigilo fica registrada no histórico'
    );

    const hubDepois = await (await pedir('/categories/denuncias_sigilosas/hub')).text();
    checar(hubDepois.includes('Depredação de patrimônio'), 'liberada, passa a aparecer publicamente');

    await pedir(`/admin/protocolo/denuncia/${queimada._id}/sigilo`, {
        como: 'gestor', metodo: 'POST', corpo: { privada: '1' }
    });
    const queimadaAtual = await Denuncia.findById(queimada._id).lean();
    checar(queimadaAtual.privada === true, 'gestão também consegue tornar sigilosa uma pública');

    console.log('\n--- Busca em tempo real ---');
    const trechoAdmin = await (await pedir('/admin/painel/buscar?q=buraco', { como: 'gestor' })).text();
    checar(trechoAdmin.includes('Buraco na rua principal'), 'trecho do painel traz o protocolo buscado');
    checar(!trechoAdmin.includes('<html'), 'trecho vem sem o layout da página');

    const trechoVazio = await (await pedir('/admin/painel/buscar?q=naoexistexyz', { como: 'gestor' })).text();
    checar(!trechoVazio.includes('Buraco na rua principal'), 'busca sem correspondência devolve trecho vazio');

    const trechoUsuario = await (await pedir('/protocolos/buscar?q=buraco', { como: 'autor' })).text();
    checar(trechoUsuario.includes('Buraco na rua principal'), 'cidadão busca nos próprios protocolos');

    const trechoAlheio = await (await pedir('/protocolos/buscar?q=buraco', { como: 'outro' })).text();
    checar(!trechoAlheio.includes('Buraco na rua principal'), 'busca não vaza protocolo de outra pessoa');

    const buscaSemLogin = await pedir('/protocolos/buscar?q=buraco');
    checar(buscaSemLogin.status === 302, 'busca de protocolos exige login');

    console.log('\n--- Comentários: quem edita e quem exclui ---');
    const postComentarios = await Chamado.create({
        titulo: 'Praça sem iluminação', descricao: 'A praça central está no escuro.',
        localizacao: 'Centro', usuario: autor._id
    });
    const idPost = String(postComentarios._id);

    const comentar = (como, texto) => pedir(`/categories/gestao_de_melhorias/comentario/${idPost}`, {
        como, metodo: 'POST', corpo: { texto }
    });

    await comentar('autor', 'Comentário escrito pelo autor.');
    await comentar('outro', 'Comentário escrito por outra pessoa.');

    let doc2 = await Chamado.findById(idPost).lean();
    checar(doc2.comentarios.length === 2, 'dois comentários registrados', `${doc2.comentarios.length}`);

    const doAutor = doc2.comentarios.find((c) => String(c.usuario) === String(autor._id));
    const doOutro = doc2.comentarios.find((c) => String(c.usuario) === String(outro._id));

    const editar = (como, comentarioId, texto) =>
        pedir(`/categories/gestao_de_melhorias/comentario/${idPost}/${comentarioId}/editar`, {
            como, metodo: 'POST', corpo: { texto }
        });

    const excluir = (como, comentarioId) =>
        pedir(`/categories/gestao_de_melhorias/comentario/${idPost}/${comentarioId}/excluir`, {
            como, metodo: 'POST'
        });

    await editar('autor', doAutor._id, 'Texto corrigido pelo próprio autor.');
    doc2 = await Chamado.findById(idPost).lean();
    let atual = doc2.comentarios.find((c) => String(c._id) === String(doAutor._id));
    checar(atual.texto === 'Texto corrigido pelo próprio autor.', 'autor edita o próprio comentário');
    checar(Boolean(atual.editadoEm), 'marca de edição gravada no comentário');

    await editar('outro', doAutor._id, 'Tentando reescrever comentário alheio.');
    doc2 = await Chamado.findById(idPost).lean();
    atual = doc2.comentarios.find((c) => String(c._id) === String(doAutor._id));
    checar(!atual.texto.includes('Tentando'), 'terceiro NÃO edita comentário de outro');

    await editar('gestor', doAutor._id, 'Gestão tentando reescrever o cidadão.');
    doc2 = await Chamado.findById(idPost).lean();
    atual = doc2.comentarios.find((c) => String(c._id) === String(doAutor._id));
    checar(!atual.texto.includes('Gestão tentando'), 'nem a gestão reescreve comentário de alguém');

    await excluir('outro', doAutor._id);
    doc2 = await Chamado.findById(idPost).lean();
    checar(doc2.comentarios.length === 2, 'terceiro NÃO exclui comentário alheio');

    await excluir('gestor', doOutro._id);
    doc2 = await Chamado.findById(idPost).lean();
    checar(doc2.comentarios.length === 1, 'gestão remove comentário impróprio de qualquer um');

    await excluir('autor', doAutor._id);
    doc2 = await Chamado.findById(idPost).lean();
    checar(doc2.comentarios.length === 0, 'autor exclui o próprio comentário');

    console.log('\n--- Editor restrito ao autor ---');
    checar((await pedir(`/categories/gestao_de_melhorias/editar/${id}`, { como: 'autor' })).status === 200, 'autor abre o editor');
    checar((await pedir(`/categories/gestao_de_melhorias/editar/${id}`, { como: 'outro' })).status === 302, 'terceiro é barrado do editor');
    checar((await pedir(`/categories/gestao_de_melhorias/editar/${id}`, { como: 'gestor' })).status === 302, 'nem o admin edita o texto do cidadão');

    await pedir(`/categories/gestao_de_melhorias/editar/${id}`, {
        como: 'outro', metodo: 'POST',
        corpo: { titulo: 'Invadido', descricao: 'texto invasor aqui', localizacao: 'X' }
    });
    doc = await Chamado.findById(id).lean();
    checar(doc.titulo === 'Buraco na rua principal', 'terceiro não altera a publicação');

    await pedir(`/categories/gestao_de_melhorias/editar/${id}`, {
        como: 'autor', metodo: 'POST',
        corpo: {
            titulo: 'Buraco na rua principal (atualizado)',
            descricao: 'Descrição revisada pelo autor.',
            localizacao: 'Centro, Cariús',
            latitude: '-6.5372', longitude: '-39.4936',
            // O formulário devolve o índice da imagem, não a URL
            'imagens_mantidas[]': '0'
        }
    });
    doc = await Chamado.findById(id).lean();
    checar(doc.titulo.includes('atualizado'), 'autor edita o título');
    checar(doc.imagens.length === 1 && doc.imagens[0] === IMG, 'imagem mantida permanece');
    checar(Boolean(doc.editadoEm), 'marca de edição gravada');
    checar(doc.historico.length === 3, 'histórico do protocolo preservado na edição');

    console.log('\n--- Remoção de imagem pelo editor ---');
    await pedir(`/categories/gestao_de_melhorias/editar/${id}`, {
        como: 'autor', metodo: 'POST',
        corpo: { titulo: 'Buraco na rua principal', descricao: 'Descrição revisada pelo autor.', localizacao: 'Centro' }
    });
    doc = await Chamado.findById(id).lean();
    checar(doc.imagens.length === 0, 'imagem removida quando não é reenviada');

    console.log('\n--- Exclusão ---');
    checar((await pedir(`/categories/gestao_de_melhorias/excluir/${id}`, { como: 'outro', metodo: 'POST' })).status === 302, 'terceiro tenta excluir');
    checar(Boolean(await Chamado.findById(id)), 'publicação continua existindo');

    await pedir(`/categories/gestao_de_melhorias/excluir/${id}`, { como: 'autor', metodo: 'POST' });
    checar(!(await Chamado.findById(id)), 'autor exclui a própria publicação');
} finally {
    servidor.close();
    await mongoose.disconnect();
    await mongoEmMemoria.stop();
    console.log('\nBanco em memória encerrado.');
}

console.log(falhas === 0 ? '\nTodos os fluxos passaram.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
