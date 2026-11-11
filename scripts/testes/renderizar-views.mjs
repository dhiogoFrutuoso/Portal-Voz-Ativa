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

const moderacaoPadrao = {
    chave: 'pendente', rotulo: 'Pendente de Moderação', cor: 'warning',
    icone: 'bi-hourglass-split', resumo: 'Aguardando revisão prévia da assessoria.',
    trilha: [{ moderadorNome: 'Assessoria', acao: 'Triagem inicial', detalhe: 'Em análise', createdAt: new Date('2026-02-20') }]
};

const comprovantePadrao = {
    protocolo: 'MEL-2026-C5C5B8',
    categoriaOcorrencia: 'Reparo de Vias e Estradas',
    bairro: 'São Vicente',
    mailtoUrl: 'mailto:?subject=Comprovante%20MEL-2026-C5C5B8&body=Protocolo',
    downloadUrl: '/protocolos/melhoria/p1/comprovante?formato=txt',
    impressaoUrl: '/protocolos/melhoria/p1/comprovante'
};

const protocolo = {
    _id: 'p1', tipo: 'melhoria', eixo: eixoMelhoria, titulo: 'Asfalto desgastado',
    descricao: 'Necessidade de reparo no asfalto do bairro São Vicente.',
    localizacao: 'Rua Jonas Oliveira Lopes, Cariús', bairro: 'São Vicente',
    categoria: 'Reparo de Vias e Estradas', dataCriacao: new Date('2026-02-19'),
    status: 'Em Atendimento', estagio: { chave: 'Em Atendimento', ...estagios[1] },
    moderacao: moderacaoPadrao, comprovante: comprovantePadrao,
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
    ['index.handlebars', {
        ...base,
        paginaInicial: true,
        indicadoresResumo: { publicadas: 12, emAtendimento: 5, resolvidas: 7, vitrinesAtivas: 9 },
        demandasRecentes: [{
            _id: 'p1', numero: 'MEL-2026-C5C5B8', eixoRotulo: 'Melhorias no Bairro',
            categoria: 'Reparo de Vias e Estradas', titulo: 'Asfalto desgastado na Rua Principal',
            bairro: 'Centro', dataCriacao: new Date('2026-02-19'), status: 'Em Atendimento',
            linkDetalhes: '/categories/gestao_de_melhorias/detalhes/p1'
        }]
    },
    ['Plataforma Cívica Independente de Cariús', 'A sua voz transforma o nosso município.', 'Explorar Serviços', 'Acompanhar Meu Pedido', '100% Gratuito', 'Sigilo Assegurado', 'Direto ao Ponto', 'Comércio Valorizado', 'Conserto de Ruas e Iluminação', 'Fazer Denúncia com Sigilo', 'Encontrar Profissionais e Serviços', 'Cidadania Ativa e o Cuidado com o Patrimônio Coletivo', 'A verdadeira transformação de um município começa quando o cidadão deixa de ser apenas espectador e assume seu papel como guardião da sua cidade.', 'Segurança Comunitária e Proteção Mútua', 'A segurança e a tranquilidade pública são direitos de todos e responsabilidade de cada um de nós.', 'Lei Federal nº 13.460/2017', 'O Dever do Poder Público: Escuta, Eficiência e Transparência', 'Artigo 37 da Constituição Federal', 'Valorização do Trabalhador e da Economia Local', 'A riqueza do nosso município está nas mãos de quem trabalha e produz aqui todos os dias.', 'Do Relato à Solução: 4 Passos Simples', 'Você aponta a necessidade', 'A equipe analisa com responsabilidade', 'Direcionamento para a equipe executora', 'A cidade evolui com transparência', 'Preciso pagar alguma coisa para usar?', 'Alguém vai saber que fui eu que denunciei?', '/img/pessoas-juntas.webp', '/img/pessoas-unidas.webp', '/img/pessoas-trabalhando.webp', '190 • Polícia Militar', '181 • Disque-Denúncia'],
    ['SLA', 'Zeladoria Urbana', 'Triagem Moderada', 'Rito Processual', 'Metadados EXIF', 'Comprovante .TXT/PDF']],
    ['protocolos/timeline.handlebars', { ...base, protocolo, eDono: true, eAdmin: false, estagios },
     ['Asfalto desgastado', 'Prazo de atendimento', 'Equipe enviada', 'token-de-teste', 'Guardar Comprovante por E-mail', 'Baixar Comprovante (.TXT)',
      '/mensagem/m1/editar', '/mensagem/m1/excluir'],
     ['Painel da gestão', '/admin/protocolo/', 'Atualizar protocolo',
      '/mensagem/m2/editar', '/mensagem/m2/excluir']],
    ['protocolos/timeline.handlebars', { ...base, protocolo, eDono: false, eAdmin: true, estagios, orgaosEncaminhamento: ['Secretaria Municipal de Obras e Infraestrutura'] },
     ['Painel da gestão', 'Atualizar protocolo', 'Moderação Prévia (Assessoria)', 'Trilha de Auditoria da Moderação', 'Outros (especificar)', 'Tornar Sigiloso (Retirar do Feed Público)']],
    ['protocolos/comprovante.handlebars', { ...base, comprovante: { ...comprovantePadrao, numero: 'MEL-2026-C5C5B8', dataFormatada: '19/02/2026 às 14:00', rotuloEixo: 'Gestão de Melhorias', localizacao: 'Rua Jonas Oliveira Lopes', titulo: 'Asfalto desgastado', prazoDias: 10, linkProtocolo: '/protocolos/melhoria/p1' } },
     ['Comprovante de Registro de Protocolo', 'MEL-2026-C5C5B8', 'Baixar Arquivo (.TXT)', 'Imprimir / Salvar PDF', 'Enviar por E-mail']],
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
        resumoModeracao: [{ chave: 'pendente', rotulo: 'Pendente de Moderação', icone: 'bi-hourglass-split', total: 1 }],
        totalPendentesModeracao: 1,
        orgaosEncaminhamento: ['Secretaria Municipal de Obras e Infraestrutura'],
        totalGeral: 15, termo: 'asfalto', tipoFiltro: 'todos', statusFiltro: 'todos', estagios,
        eixos: [eixoMelhoria]
    }, ['Painel de Protocolos', 'Alterar estágio', 'o cidadão respondeu', 'data-filtro="status"', 'data-filtro="moderacao"', 'data-busca-rota="/admin/painel/buscar"']],
    ['admin/metricas.handlebars', {
        ...base,
        metricas: {
            janelaDias: 90, totalPiloto: 24, totalMelhoriasPiloto: 16, totalDenunciasPiloto: 8, totalHistorico: 30,
            resolvidos: 12, emAtendimento: 8, novos: 4, taxaResolucao: 50,
            pendentesModeracao: 3, aprovadosModeracao: 15, encaminhadosModeracao: 4, bloqueadosModeracao: 2,
            anonimos: 7, comPrimeiraResposta: 18, tempoMedioHoras: 14.5, tempoMedioDias: 0.6,
            porBairro: [{ nome: 'Centro', total: 10, resolvidos: 6, taxaResolucao: 60, percentual: 42 }],
            porCategoria: [{ nome: 'Iluminação Pública', total: 8, percentual: 33 }],
            trilhaRecente: [{ protocolo: 'MEL-2026-C5C5B8', linkProtocolo: '/protocolos/melhoria/p1', titulo: 'Asfalto desgastado', acao: 'Aprovado para o feed público', moderadorNome: 'Assessoria', detalhe: 'Revisado', createdAt: new Date() }]
        }
    }, ['Indicadores Operacionais de Cariús', '50%', '14.5h', 'Centro', 'Iluminação Pública', 'Trilha de Auditoria Recente da Moderação']],
    ['admin/relatorio-delegacia.handlebars', {
        ...base,
        relatorio: {
            protocolo: 'DEN-2026-123456', idInterno: 'd1', tipoOcorrencia: 'Maus-tratos contra Animais',
            statusOperacional: 'Em Atendimento', statusModeracao: 'Encaminhado a Órgão Competente',
            orgaoEncaminhado: 'Delegacia de Polícia Civil / Polícia Militar',
            dataRegistro: new Date(), titulo: 'Maus-tratos em residência',
            descricao: 'Descrição detalhada do caso.', localizacao: 'Rua Central, 100',
            bairro: 'Centro', coordenadas: '-6.5372, -39.4936',
            imagens: ['https://res.cloudinary.com/dnh7vok3r/image/upload/v1/a.png'], video: null,
            postagemAnonimaNoFeed: true,
            autorInterno: { id: 'u1', nome: 'Maria Souza', email: 'm@teste.local', telefone: '8899999999' },
            emitidoPor: 'Assessoria', emitidoEm: new Date()
        }
    }, ['Relatório Estruturado de Ocorrência', 'DEN-2026-123456', 'Baixar .TXT Oficial', 'Maus-tratos contra Animais']],
    ['categories/editar.handlebars', {
        ...base,
        eixo: { chave: 'gestao_de_melhorias', model: 'chamados', rotulo: 'Melhoria', rotuloLongo: 'Gestão de Melhorias', cor: 'primary', icone: 'bi-tools', temVideo: false, temProtocolo: true, hub: '/categories/gestao_de_melhorias/hub', detalhes: '/categories/gestao_de_melhorias/detalhes' },
        post: { _id: 'p1', titulo: 'Asfalto desgastado', categoria: 'Reparo de Vias e Estradas', descricao: 'Texto', localizacao: 'Rua X', latitude: -6.5, longitude: -39.4, imagens: ['https://res.cloudinary.com/dnh7vok3r/image/upload/v1/a.png'] },
        imagensAtuais: ['https://res.cloudinary.com/dnh7vok3r/image/upload/v1/a.png'],
        video: null, categoriasMelhoria: ['Iluminação Pública', 'Reparo de Vias e Estradas'], tiposOcorrencia: ['Foco de Queimada', 'Outro'], categoriasVitrine: ['Alimentação', 'Outros']
    }, ['Editar Melhoria', 'Excluir publicação', 'imagens_mantidas', 'Reparo de Vias e Estradas']],
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
     ['/admin/protocolo/denuncia/c1/status', 'Buscar por título', 'data-filtro="ocorrencia"', '190 Polícia Militar', '181 Disque-Denúncia']],

    ['categories/vitrine_do_trabalhador/hub.handlebars',
     { ...base, anuncios: [{ ...cardMelhoria, categoria: 'Alimentação' }], termo: 'bolo', total: 1,
       filtrosCategoria: ['Alimentação', 'Artesanato'] },
     ['Buscar por serviço', 'data-filtro="categoria"', 'item-filtravel']],

    ['categories/gestao_de_melhorias/detalhes.handlebars',
     { ...base, chamadoDoc: cardMelhoria, moderacao: moderacaoPadrao, comprovante: comprovantePadrao, jaCurtiu: false, eDono: true, podeAcompanhar: true,
       linkProtocolo: '/protocolos/melhoria/c1', linkEditar: '/categories/gestao_de_melhorias/editar/c1' },
     ['Esta publicação é sua', 'Acompanhar protocolo', 'Editar', 'Guardar Comprovante por E-mail', 'Baixar Comprovante (.TXT)']],

    ['categories/gestao_de_melhorias/detalhes.handlebars',
     { ...base, user: admin, chamadoDoc: cardMelhoria, moderacao: moderacaoPadrao, comprovante: comprovantePadrao, jaCurtiu: false, eDono: false, podeAcompanhar: true,
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
     { ...base }, ['Como funciona o atendimento', '10 dias úteis', 'Iluminação Pública', 'Postar de forma anônima']],

    ['categories/denuncias_sigilosas/abrir-denuncia.handlebars',
     { ...base }, ['Como funciona o atendimento', '2 dias úteis', '190 • Polícia Militar', '181 • Disque-Denúncia']]
);

// --- Fragmentos devolvidos pela busca em tempo real ---
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
     ['item-filtravel'],
     ['Sigilosa', 'Tornar pública', 'Tornar sigilosa', '/admin/protocolo/denuncia/c1/sigilo']],

    ['partials/_cards_denuncias.handlebars',
     { ...base, layout: false, user: usuario,
       denuncias: [{ ...cardMelhoria, tipoOcorrencia: 'Foco de Queimada', privada: false }],
       estagios, tipoProtocolo: 'denuncia' },
     ['item-filtravel'],
     ['Pública', 'Sigilosa', 'Tornar sigilosa', '/sigilo']],

    // O toggle SÓ existe no painel do admin.
    ['partials/_linhas_painel.handlebars',
     { ...base,
       protocolos: [{
           ...protocolo, tipo: 'denuncia', eixo: { ...eixoMelhoria, chave: 'denuncia', cor: 'danger', icone: 'bi-shield-lock-fill', rotuloCurto: 'Denúncia' },
           respostas: 1, autor: usuario, imagemPrincipal: null, linkProtocolo: '/protocolos/denuncia/p1',
           numero: 'DEN-2026-C5C5B8', novidades: { paraAGestao: false, paraOAutor: false },
           privada: true, podeMudarSigilo: true
       }],
       estagios,
       orgaosEncaminhamento: ['Delegacia de Polícia Civil / Polícia Militar']
     },
     ['Sigilosa', 'Tornar pública', '/admin/protocolo/denuncia/p1/sigilo', '/admin/protocolo/denuncia/p1/moderar', 'Exportar p/ Delegacia']]
);

function formsAninhados(html) {
    const marcas = [...html.matchAll(/<form\b|<\/form>/g)].map((m) => m[0]);
    let profundidade = 0;
    for (const marca of marcas) {
        if (marca === '</form>') profundidade--;
        else if (++profundidade > 1) return true;
    }
    return false;
}

function csrfVazio(html) {
    return /name="_csrf"\s+value=""/.test(html);
}

let falhas = 0;

for (const [view, contexto, esperados, proibidos = []] of casos) {
    const rotulo = `${view} ${contexto.eAdmin ? '(admin)' : ''}${contexto.eixo ? '[' + contexto.eixo.chave + ']' : ''}`;
    try {
        const html = await renderizar(view, contexto);
        const faltando = esperados.filter((t) => !html.includes(t));
        const vazados = proibidos.filter((t) => html.includes(t));
        const aninhados = formsAninhados(html);
        const tokenVazio = csrfVazio(html);

        if (tokenVazio) {
            console.log(`FALHA  ${rotulo} -> tem _csrf vazio (use @root.csrfToken dentro de each)`);
            falhas++;
        } else if (aninhados) {
            console.log(`FALHA  ${rotulo} -> tem <form> dentro de <form> (quebra o token CSRF)`);
            falhas++;
        } else if (faltando.length > 0 || vazados.length > 0) {
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
