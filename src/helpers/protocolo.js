/*
 * Regras de protocolo — estágios de atendimento e prazos de resposta.
 *
 * Vale apenas para Gestão de Melhorias e Denúncias Sigilosas: são as demandas
 * que o município recebe e responde. A Vitrine do Trabalhador é anúncio de
 * autônomo, não passa por protocolo.
 */

// --- Estágios ---
export const ESTAGIOS = {
    Novo: {
        rotulo: 'Novo',
        descricao: 'Aguardando a primeira resposta da gestão',
        cor: 'primary',
        icone: 'bi-inbox-fill'
    },
    'Em Atendimento': {
        rotulo: 'Em Atendimento',
        descricao: 'Respondido e em estágio de resolução',
        cor: 'warning',
        icone: 'bi-tools'
    },
    Reaberto: {
        rotulo: 'Reaberto',
        descricao: 'Foi dado como resolvido, mas voltou para resolução',
        cor: 'danger',
        icone: 'bi-arrow-counterclockwise'
    },
    Resolvido: {
        rotulo: 'Resolvido',
        descricao: 'Atendimento concluído',
        cor: 'success',
        icone: 'bi-check-circle-fill'
    },
    Improcedente: {
        rotulo: 'Improcedente',
        descricao: 'Avaliado pela gestão e arquivado sem execução',
        cor: 'secondary',
        icone: 'bi-archive-fill'
    }
};

export const LISTA_ESTAGIOS = Object.keys(ESTAGIOS);

// Registros criados antes do sistema de protocolo usavam outros rótulos.
const EQUIVALENCIAS = {
    Aberto: 'Novo',
    'Em Análise': 'Novo',
    'Em análise': 'Novo',
    Pendente: 'Novo',
    Concluído: 'Resolvido',
    Concluido: 'Resolvido',
    Fechado: 'Resolvido'
};

export function normalizarStatus(status) {
    if (LISTA_ESTAGIOS.includes(status)) return status;
    return EQUIVALENCIAS[status] || 'Novo';
}

export function estagioDe(status) {
    const normalizado = normalizarStatus(status);
    return { chave: normalizado, ...ESTAGIOS[normalizado] };
}

// --- Prazos de resposta (cláusula de atendimento) ---
// Dias úteis padrão por tipo de demanda. O admin pode sobrescrever o prazo de um
// protocolo específico ao respondê-lo.
const PRAZOS_DENUNCIA = {
    Queimada: 2,
    'Queimada Ilegal': 2,
    Desmatamento: 3,
    'Poluição': 5,
    'Poluição Sonora': 5,
    'Maus-tratos a animais': 3,
    'Descarte irregular de lixo': 5
};

const PRAZO_PADRAO_DENUNCIA = 5;
const PRAZO_PADRAO_MELHORIA = 10;

export function prazoPadrao(tipo, tipoOcorrencia) {
    if (tipo === 'denuncia') {
        return PRAZOS_DENUNCIA[tipoOcorrencia] || PRAZO_PADRAO_DENUNCIA;
    }
    return PRAZO_PADRAO_MELHORIA;
}

export function prazoDoProtocolo(doc, tipo) {
    const dias = Number.isFinite(doc?.prazoDias) && doc.prazoDias > 0
        ? doc.prazoDias
        : prazoPadrao(tipo, doc?.tipoOcorrencia);

    return {
        dias,
        ajustadoPelaGestao: Boolean(doc?.prazoAjustado),
        texto: `A gestão municipal responde este protocolo em até ${dias} ${dias === 1 ? 'dia útil' : 'dias úteis'}.`
    };
}

// Data limite estimada a partir da abertura, pulando sábados e domingos.
export function dataLimite(dataCriacao, dias) {
    const data = new Date(dataCriacao || Date.now());
    let restantes = dias;

    while (restantes > 0) {
        data.setDate(data.getDate() + 1);
        const diaDaSemana = data.getDay();
        if (diaDaSemana !== 0 && diaDaSemana !== 6) restantes--;
    }

    return data;
}

// --- Configuração dos dois eixos que têm protocolo ---
export const EIXOS_COM_PROTOCOLO = {
    melhoria: {
        chave: 'melhoria',
        model: 'chamados',
        rotulo: 'Gestão de Melhorias',
        rotuloCurto: 'Melhoria',
        cor: 'primary',
        icone: 'bi-tools',
        rotaHub: '/categories/gestao_de_melhorias/hub',
        rotaDetalhes: '/categories/gestao_de_melhorias/detalhes',
        rotaEditar: '/categories/gestao_de_melhorias/editar'
    },
    denuncia: {
        chave: 'denuncia',
        model: 'denuncias',
        rotulo: 'Denúncias Sigilosas',
        rotuloCurto: 'Denúncia',
        cor: 'danger',
        icone: 'bi-shield-lock-fill',
        rotaHub: '/categories/denuncias_sigilosas/hub',
        rotaDetalhes: '/categories/denuncias_sigilosas/detalhes',
        rotaEditar: '/categories/denuncias_sigilosas/editar'
    }
};

export const eixoValido = (tipo) => Object.hasOwn(EIXOS_COM_PROTOCOLO, tipo);

// Número de protocolo legível, derivado do id e da data (não expõe nada novo:
// o id já aparece na URL pública do post).
export function numeroDoProtocolo(doc, tipo) {
    const ano = new Date(doc.dataCriacao || Date.now()).getFullYear();
    const sufixo = String(doc._id).slice(-6).toUpperCase();
    const prefixo = tipo === 'denuncia' ? 'DEN' : 'MEL';
    return `${prefixo}-${ano}-${sufixo}`;
}

/*
 * Avisos de novidade.
 *
 * Cada lado tem sua marca de leitura: o cidadão é avisado quando a gestão
 * responde e a gestão é avisada quando o cidadão responde. Comparar a data da
 * última mensagem do outro lado com a marca de leitura evita guardar contador.
 */
function ultimaMensagemDe(historico, papel) {
    const mensagens = (historico || []).filter((item) => item.papel === papel);
    if (mensagens.length === 0) return null;

    return mensagens.reduce((maisRecente, item) =>
        new Date(item.createdAt) > new Date(maisRecente.createdAt) ? item : maisRecente
    );
}

function haNovidade(ultima, vistoEm) {
    if (!ultima) return false;
    if (!vistoEm) return true;
    return new Date(ultima.createdAt) > new Date(vistoEm);
}

export function novidadesDoProtocolo(doc) {
    const daGestao = ultimaMensagemDe(doc.historico, 'admin');
    const doCidadao = ultimaMensagemDe(doc.historico, 'cidadao');

    return {
        paraOAutor: haNovidade(daGestao, doc.vistoPeloAutorEm),
        paraAGestao: haNovidade(doCidadao, doc.vistoPelaGestaoEm),
        ultimaDaGestao: daGestao ? daGestao.createdAt : null,
        ultimaDoCidadao: doCidadao ? doCidadao.createdAt : null
    };
}

// Só o autor da mensagem mexe nela: cidadão nunca edita ou apaga mensagem da
// gestão, e a gestão nunca mexe na mensagem do cidadão.
export function podeMexerNaMensagem(mensagem, usuario) {
    if (!mensagem || !usuario) return false;

    const autor = mensagem.autor?._id || mensagem.autor;
    return Boolean(autor) && String(autor) === String(usuario._id);
}

// Mensagem que registra troca de estágio é histórico do atendimento: o texto
// pode ser corrigido, mas o registro em si não é apagado.
export const ehRegistroDeEstagio = (mensagem) => Boolean(mensagem && mensagem.statusNovo);

/*
 * Sigilo das denúncias.
 *
 * Uma denúncia expõe a moral de quem denuncia e de quem é acusado, então o
 * padrão é ficar restrita ao autor e à gestão municipal. Foco de incêndio é a
 * exceção: é risco coletivo e serve de alerta, então nasce público.
 */
export const OCORRENCIAS_PUBLICAS = ['Foco de Queimada'];

export const nasceSigilosa = (tipoOcorrencia) => !OCORRENCIAS_PUBLICAS.includes(tipoOcorrencia);

/*
 * O que é público.
 *
 * Denúncias gravadas antes deste campo não têm `privada` definido. Tratá-las
 * como públicas exporia justamente o que precisa de sigilo, então o critério
 * para elas é o tipo de ocorrência — só incêndio passa. Assim a regra vale de
 * imediato, sem depender de rodar a migração.
 */
const EH_PUBLICA = {
    $or: [
        { privada: false },
        { privada: { $exists: false }, tipoOcorrencia: { $in: OCORRENCIAS_PUBLICAS } }
    ]
};

// Filtro do Mongo com o que cada visitante tem direito de ver no hub.
export function filtroDeSigilo(usuario) {
    if (usuario && usuario.areAdmin) return {};

    if (usuario) {
        // Quem denunciou continua enxergando a própria denúncia.
        return { $or: [EH_PUBLICA, { usuario: usuario._id }] };
    }

    return EH_PUBLICA;
}

// Mesma regra, aplicada a um documento já carregado.
export function podeVerDenuncia(doc, usuario) {
    const ehPublica =
        doc?.privada === false ||
        (doc?.privada === undefined && OCORRENCIAS_PUBLICAS.includes(doc?.tipoOcorrencia));

    if (ehPublica) return true;
    if (!usuario) return false;
    if (usuario.areAdmin) return true;

    const autor = doc.usuario?._id || doc.usuario;
    return Boolean(autor) && String(autor) === String(usuario._id);
}
