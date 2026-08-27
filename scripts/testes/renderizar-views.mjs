/* Renderiza as views novas com dados representativos, sem tocar no banco. */
import { engine } from 'express-handlebars';
import moment from 'moment';
import path from 'path';

const RAIZ = 'C:/Users/seuma/Desktop/PROJETOS/PORTAL VOZ ATIVA/src/views';

const helpers = {
    eq: (v1, v2) => v1 === v2,
    ifNotEquals: function (a, b, options) { return a !== b ? options.fn(this) : options.inverse(this); },
    slice: (str, s, e) => (typeof str === 'string' ? str.slice(s, e) : ''),
    gt: (a, b) => a > b,
    formatDate: (d) => moment(d).format('DD/MM/YYYY [às] HH:mm'),
    formatDay: (d) => moment(d).format('DD/MM/YYYY'),
    fromNow: (d) => moment(d).locale('pt-br').fromNow(),
    concat: (...args) => args.slice(0, -1).join(''),
    recortar: (t, l) => {
        const max = typeof l === 'number' ? l : 140;
        if (typeof t !== 'string' || t.length <= max) return t || '';
        return t.slice(0, t.lastIndexOf(' ', max)) + '…';
    }
};

const hbs = engine({
    defaultLayout: 'main',
    layoutsDir: path.join(RAIZ, 'layouts'),
    partialsDir: path.join(RAIZ, 'partials'),
    helpers,
    runtimeOptions: { allowProtoPropertiesByDefault: true, allowProtoMethodsByDefault: true }
});

const renderizar = (view, contexto) =>
    new Promise((resolve, reject) => {
        hbs(path.join(RAIZ, view), { ...contexto, settings: { views: RAIZ } }, (err, html) =>
            err ? reject(err) : resolve(html)
        );
    });

const estagios = [
    { chave: 'Novo', rotulo: 'Novo', descricao: 'Aguardando resposta', cor: 'primary', icone: 'bi-inbox-fill' },
    { chave: 'Em Atendimento', rotulo: 'Em Atendimento', descricao: 'Em resolução', cor: 'warning', icone: 'bi-tools' },
    { chave: 'Reaberto', rotulo: 'Reaberto', descricao: 'Voltou', cor: 'danger', icone: 'bi-arrow-counterclockwise' },
    { chave: 'Resolvido', rotulo: 'Resolvido', descricao: 'Concluído', cor: 'success', icone: 'bi-check-circle-fill' },
    { chave: 'Improcedente', rotulo: 'Improcedente', descricao: 'Arquivado', cor: 'secondary', icone: 'bi-archive-fill' }
];

const eixoMelhoria = {
    chave: 'melhoria', rotulo: 'Gestão de Melhorias', rotuloCurto: 'Melhoria',
    cor: 'primary', icone: 'bi-tools',
    rotaHub: '/categories/gestao_de_melhorias/hub',
    rotaDetalhes: '/categories/gestao_de_melhorias/detalhes',
    rotaEditar: '/categories/gestao_de_melhorias/editar'
};

const usuario = { _id: 'u1', name: 'Maria Souza', profileImage: '/img/guest.webp', profession: 'Cidadã' };

const protocolo = {
    _id: 'p1', tipo: 'melhoria', eixo: eixoMelhoria, titulo: 'Asfalto desgastado',
    descricao: 'Necessidade de reparo no asfalto do bairro São Vicente.',
    localizacao: 'Rua Jonas Oliveira Lopes, Cariús', dataCriacao: new Date('2026-02-19'),
    status: 'Em Atendimento', estagio: { chave: 'Em Atendimento', ...estagios[1] },
    prazo: { dias: 10, ajustadoPelaGestao: true, texto: 'Responde em até 10 dias úteis.' },
    limite: new Date('2026-03-05'), numero: 'MEL-2026-C5C5B8',
    linkPost: '/categories/gestao_de_melhorias/detalhes/p1',
    usuario, imagens: ['https://res.cloudinary.com/dnh7vok3r/image/upload/f_auto,q_auto/v1/a.png'],
    tipoOcorrencia: null,
    historico: [
        { _id: 'm1', autor: usuario, papel: 'cidadao', ehAdmin: false, texto: 'Piorou com a chuva.', imagem: null, createdAt: new Date('2026-02-20'), podeEditar: true, podeExcluir: true },
        { _id: 'm2', autor: { name: 'Gestão', profileImage: '/img/guest.webp' }, papel: 'admin', ehAdmin: true, texto: 'Equipe enviada.', imagem: 'https://res.cloudinary.com/dnh7vok3r/image/upload/f_auto,q_auto/v1/b.png', statusAnterior: 'Novo', statusNovo: 'Em Atendimento', createdAt: new Date('2026-02-21'), podeEditar: false, podeExcluir: false, registroDeEstagio: true }
    ]
};

const base = { csrfToken: 'token-de-teste', cloudinaryCloudName: 'dnh7vok3r', cloudinaryUploadPreset: 'Portal-Voz-Ativa', user: usuario };

const casos = [
    ['protocolos/timeline.handlebars', { ...base, protocolo, eDono: true, eAdmin: false, estagios },
     ['Asfalto desgastado', 'Prazo de atendimento', 'Equipe enviada', 'token-de-teste',
      '/mensagem/m1/editar', '/mensagem/m1/excluir'],
     ['Painel da gestão', '/admin/protocolo/', 'Atualizar protocolo',
      '/mensagem/m2/editar', '/mensagem/m2/excluir']],
    ['protocolos/timeline.handlebars', { ...base, protocolo, eDono: false, eAdmin: true, estagios }, ['Painel da gestão', 'Atualizar protocolo']],
    ['protocolos/lista.handlebars',
     { ...base, protocolos: [{ ...protocolo, novidades: { paraOAutor: true, paraAGestao: false } }],
       resumo: estagios.map((e) => ({ ...e, total: 2 })), termo: '', total: 1,
       filtrosEstagio: estagios, filtrosTipo: [eixoMelhoria] },
     ['Meus Protocolos', 'Acompanhar', 'nova resposta da gestão', 'btn-filtro', 'data-busca-painel']],
    ['protocolos/lista.handlebars',
     { ...base, protocolos: [], resumo: estagios.map((e) => ({ ...e, total: 0 })), termo: '', total: 0,
       filtrosEstagio: estagios, filtrosTipo: [eixoMelhoria] },
     ['ainda não abriu nenhum protocolo']],
    ['admin/painel.handlebars', {
        ...base,
        protocolos: [{ ...protocolo, respostas: 2, autor: usuario, imagemPrincipal: null, linkProtocolo: '/protocolos/melhoria/p1', numero: 'MEL-2026-C5C5B8', novidades: { paraAGestao: true, paraOAutor: false } }],
        resumo: estagios.map((e) => ({ ...e, total: 3, ativo: e.chave === 'Novo', link: '/admin/painel?status=' + e.chave })),
        totalGeral: 15, termo: 'asfalto', tipoFiltro: 'todos', statusFiltro: 'todos', estagios,
        eixos: [eixoMelhoria]
    }, ['Painel de Protocolos', 'Alterar estágio', 'o cidadão respondeu', 'data-filtro="status"', 'data-busca-rota="/admin/painel/buscar"']],
    ['categories/editar.handlebars', {
        ...base,
        eixo: { chave: 'gestao_de_melhorias', model: 'chamados', rotulo: 'Melhoria', rotuloLongo: 'Gestão de Melhorias', cor: 'primary', icone: 'bi-tools', temVideo: false, temProtocolo: true, hub: '/categories/gestao_de_melhorias/hub', detalhes: '/categories/gestao_de_melhorias/detalhes' },
        post: { _id: 'p1', titulo: 'Asfalto desgastado', descricao: 'Texto', localizacao: 'Rua X', latitude: -6.5, longitude: -39.4, imagens: ['https://res.cloudinary.com/dnh7vok3r/image/upload/v1/a.png'] },
        imagensAtuais: ['https://res.cloudinary.com/dnh7vok3r/image/upload/v1/a.png'],
        video: null, tiposOcorrencia: ['Foco de Queimada', 'Outro'], categoriasVitrine: ['Alimentação', 'Outros']
    }, ['Editar Melhoria', 'Excluir publicação', 'imagens_mantidas']],
    ['categories/editar.handlebars', {
        ...base,
        eixo: { chave: 'denuncias_sigilosas', model: 'denuncias', rotulo: 'Denúncia', rotuloLongo: 'Denúncias Sigilosas', cor: 'danger', icone: 'bi-shield-lock-fill', temVideo: true, temProtocolo: true, hub: '/h', detalhes: '/d' },
        post: { _id: 'p2', titulo: 'Queimada', tipoOcorrencia: 'Foco de Queimada', descricao: 'Texto', localizacao: 'Sítio', imagens: [] },
        imagensAtuais: [], video: 'https://res.cloudinary.com/dnh7vok3r/video/upload/v1/v.mp4',
        tiposOcorrencia: ['Foco de Queimada', 'Outro'], categoriasVitrine: ['Alimentação', 'Outros']
    }, ['Editar Denúncia', 'manter', 'Foco de Queimada']],
    ['categories/editar.handlebars', {
        ...base,
        eixo: { chave: 'vitrine_do_trabalhador', model: 'vitrine', rotulo: 'Anúncio', rotuloLongo: 'Vitrine do Trabalhador', cor: 'success', icone: 'bi-shop', temVideo: false, temProtocolo: false, hub: '/h', detalhes: '/d' },
        post: { _id: 'p3', titulo: 'Bolos', categoria: 'Outros', categoria_especificada: 'Confeitaria', descricao: 'T', localizacao: 'Centro', contato: '88', imagens: [] },
        imagensAtuais: [], video: null, tiposOcorrencia: [], categoriasVitrine: ['Alimentação', 'Outros']
    }, ['Editar Anúncio', 'Confeitaria', 'Contato']]
];


// --- Hubs e detalhes, com os partials de busca, estágio e ações ---
const cardMelhoria = {
    _id: 'c1', titulo: 'Asfalto desgastado', descricao: 'Reparo necessário.',
    localizacao: 'Rua Jonas Oliveira Lopes', dataCriacao: new Date('2026-02-19'),
    status: 'Em Atendimento', estagio: { chave: 'Em Atendimento', ...estagios[1] },
    imagemPrincipal: 'https://res.cloudinary.com/dnh7vok3r/image/upload/f_auto,q_auto/v1/a.png',
    imagens: ['https://res.cloudinary.com/dnh7vok3r/image/upload/f_auto,q_auto/v1/a.png'],
    curtidas: [], comentarios: [], jaCurtiu: false, usuario
};

const admin = { ...usuario, name: 'Admin', areAdmin: true };

casos.push(
    ['categories/gestao_de_melhorias/hub.handlebars',
     { ...base, chamados: [cardMelhoria], termo: 'asfalto', total: 1, estagios, filtrosEstagio: estagios, tipoProtocolo: 'melhoria' },
     ['Buscar por título', 'Em Atendimento', 'item-filtravel', 'data-busca-rota="/categories/gestao_de_melhorias/hub/buscar"'],
     ['/admin/protocolo/', 'Alterar estágio do protocolo']],

    ['categories/gestao_de_melhorias/hub.handlebars',
     { ...base, user: admin, chamados: [cardMelhoria], termo: '', total: 1, estagios, filtrosEstagio: estagios, tipoProtocolo: 'melhoria' },
     ['/admin/protocolo/melhoria/c1/status', 'Salvar', 'Improcedente']],

    ['categories/denuncias_sigilosas/hub.handlebars',
     { ...base, user: admin, denuncias: [{ ...cardMelhoria, tipoOcorrencia: 'Foco de Queimada' }], termo: '', total: 1, estagios,
       filtrosEstagio: estagios, filtrosOcorrencia: ['Foco de Queimada', 'Vandalismo'], tipoProtocolo: 'denuncia' },
     ['/admin/protocolo/denuncia/c1/status', 'Buscar por título', 'data-filtro="ocorrencia"']],

    ['categories/vitrine_do_trabalhador/hub.handlebars',
     { ...base, anuncios: [{ ...cardMelhoria, categoria: 'Alimentação' }], termo: 'bolo', total: 1,
       filtrosCategoria: ['Alimentação', 'Artesanato'] },
     ['Buscar por serviço', 'data-filtro="categoria"', 'item-filtravel']],

    ['categories/gestao_de_melhorias/detalhes.handlebars',
     { ...base, chamadoDoc: cardMelhoria, jaCurtiu: false, eDono: true, podeAcompanhar: true,
       linkProtocolo: '/protocolos/melhoria/c1', linkEditar: '/categories/gestao_de_melhorias/editar/c1' },
     ['Esta publicação é sua', 'Acompanhar protocolo', 'Editar']],

    ['categories/gestao_de_melhorias/detalhes.handlebars',
     { ...base, user: admin, chamadoDoc: cardMelhoria, jaCurtiu: false, eDono: false, podeAcompanhar: true,
       linkProtocolo: '/protocolos/melhoria/c1', linkEditar: '/x' },
     ['Acesso da gestão', 'Abrir atendimento'],
     ['Esta publicação é sua', 'Editar</a>']],

    ['categories/gestao_de_melhorias/detalhes.handlebars',
     { ...base, user: null, chamadoDoc: cardMelhoria, jaCurtiu: false, eDono: false, podeAcompanhar: false,
       linkProtocolo: '/x', linkEditar: '/x' },
     ['Asfalto desgastado'],
     ['Esta publicação é sua', 'Acesso da gestão', 'Acompanhar protocolo', '/editar/']],

    ['categories/vitrine_do_trabalhador/detalhes.handlebars',
     { ...base, vitrine: { ...cardMelhoria, categoriaExibida: 'Alimentação', contato: '88999' }, jaCurtiu: false,
       eDono: true, podeAcompanhar: false, linkEditar: '/categories/vitrine_do_trabalhador/editar/c1' },
     ['Esta publicação é sua', 'remover o anúncio']],

    ['categories/gestao_de_melhorias/abrir-chamado.handlebars',
     { ...base }, ['Como funciona o atendimento', '10 dias úteis']],

    ['categories/denuncias_sigilosas/abrir-denuncia.handlebars',
     { ...base }, ['Como funciona o atendimento', '2 dias úteis']]
);

// --- Fragmentos devolvidos pela busca em tempo real ---
// O card traz o seletor de estágio do admin; sem os dados de contexto ele sairia
// vazio e quebraria a lista (era o que acontecia ao pesquisar).
casos.push(
    ['partials/_cards_melhorias.handlebars',
     { ...base, layout: false, user: admin, chamados: [cardMelhoria], estagios, tipoProtocolo: 'melhoria' },
     ['<option value="Resolvido"', '/admin/protocolo/melhoria/c1/status', 'item-filtravel'],
     ['<html']],

    ['partials/_cards_melhorias.handlebars',
     { ...base, layout: false, user: null, chamados: [cardMelhoria], estagios, tipoProtocolo: 'melhoria' },
     ['item-filtravel'],
     ['/admin/protocolo/', '<option value="Resolvido"']],

    ['partials/_cards_denuncias.handlebars',
     { ...base, layout: false, user: admin,
       denuncias: [{ ...cardMelhoria, tipoOcorrencia: 'Vandalismo', privada: true }],
       estagios, tipoProtocolo: 'denuncia' },
     ['Sigilosa', 'Tornar pública', '/admin/protocolo/denuncia/c1/sigilo']],

    ['partials/_cards_denuncias.handlebars',
     { ...base, layout: false, user: usuario,
       denuncias: [{ ...cardMelhoria, tipoOcorrencia: 'Foco de Queimada', privada: false }],
       estagios, tipoProtocolo: 'denuncia' },
     ['Pública'],
     ['Tornar sigilosa', '/sigilo']]
);

let falhas = 0;

for (const [view, contexto, esperados, proibidos = []] of casos) {
    const rotulo = `${view} ${contexto.eAdmin ? '(admin)' : ''}${contexto.eixo ? '[' + contexto.eixo.chave + ']' : ''}`;
    try {
        const html = await renderizar(view, contexto);
        const faltando = esperados.filter((t) => !html.includes(t));
        const vazados = proibidos.filter((t) => html.includes(t));

        if (faltando.length > 0 || vazados.length > 0) {
            if (faltando.length > 0) console.log(`FALHA  ${rotulo} -> não encontrado: ${faltando.join(' | ')}`);
            if (vazados.length > 0) console.log(`VAZOU  ${rotulo} -> apareceu para quem não devia: ${vazados.join(' | ')}`);
            falhas++;
        } else {
            console.log(`ok     ${rotulo} (${(html.length / 1024).toFixed(0)} KB)`);
        }
    } catch (err) {
        console.log(`ERRO   ${rotulo} -> ${err.message.split('\n')[0]}`);
        falhas++;
    }
}

console.log(falhas === 0 ? '\nTodas as views renderizaram.' : `\n${falhas} falha(s).`);
process.exit(falhas === 0 ? 0 : 1);
