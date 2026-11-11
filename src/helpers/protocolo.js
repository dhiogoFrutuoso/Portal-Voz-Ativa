/*
 * Regras de protocolo — estágios de atendimento, moderação prévia (Piloto 90 dias)
 * e prazos de resposta.
 *
 * Vale apenas para Gestão de Melhorias e Denúncias Sigilosas: são as demandas
 * que o município recebe, modera e responde. A Vitrine do Trabalhador é anúncio
 * de autônomo, não passa por protocolo.
 */

// --- Estágios Operacionais ---
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

// --- Escopo do Piloto de 90 Dias (Zeladoria Urbana de Rápida Resposta) ---
export const CATEGORIAS_MELHORIA_PILOTO = [
    'Iluminação Pública',
    'Reparo de Vias e Estradas',
    'Coleta de Lixo e Entulho',
    'Saneamento e Drenagem',
    'Limpeza e Zeladoria Urbana'
];

export const BAIRROS_CARIUS = [
    'Centro',
    'São Vicente',
    'Nossa Senhora de Fátima',
    'Esplanada',
    'COHAB',
    'Bela Vista',
    'Distrito de Caio Prado',
    'Distrito de São Sebastião',
    'Distrito de Angicos',
    'Zona Rural / Sítios'
];

// --- Tipos oficiais de ocorrência e prazos de resposta (cláusula de atendimento) ---
// Valores selecionáveis no piloto de 90 dias (priorizando infrações objetivas e zeladoria).
export const TIPOS_OCORRENCIA_PILOTO = [
    'Descarte Irregular de Lixo',
    'Foco de Queimada',
    'Maus-tratos contra Animais',
    'Poluição Sonora',
    'Vandalismo',
    'Obstrução de Via ou Calçada',
    'Outro'
];

// Lista completa aceita pelo backend (inclui categorias de compatibilidade com registros existentes).
export const TIPOS_OCORRENCIA = [
    'Foco de Queimada',
    'Descarte Irregular de Lixo',
    'Maus-tratos contra Animais',
    'Poluição Sonora',
    'Vandalismo',
    'Obstrução de Via ou Calçada',
    'Tráfico ou Uso de Drogas',
    'Outro'
];

// Dias úteis padrão por tipo de demanda. O admin pode sobrescrever o prazo de um
// protocolo específico ao respondê-lo. Mantém compatibilidade com nomes legados.
const PRAZOS_DENUNCIA = {
    'Foco de Queimada': 2,
    'Maus-tratos contra Animais': 3,
    'Descarte Irregular de Lixo': 5,
    'Poluição Sonora': 5,
    'Vandalismo': 5,
    'Obstrução de Via ou Calçada': 5,
    'Tráfico ou Uso de Drogas': 3,
    'Outro': 5,
    // Compatibilidade com registros antigos
    Queimada: 2,
    'Queimada Ilegal': 2,
    Desmatamento: 3,
    'Poluição': 5,
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

// Estágios em que o atendimento terminou: não há mais prazo a cumprir.
export const ESTAGIOS_ENCERRADOS = ['Resolvido', 'Improcedente'];

export const protocoloEncerrado = (status) => ESTAGIOS_ENCERRADOS.includes(normalizarStatus(status));

export function prazoDoProtocolo(doc, tipo) {
    const dias = Number.isFinite(doc?.prazoDias) && doc.prazoDias > 0
        ? doc.prazoDias
        : prazoPadrao(tipo, doc?.tipoOcorrencia);

    // Protocolo resolvido ou arquivado não tem prazo de resposta pendente:
    // continuar mostrando "responde em até X dias" só confunde quem lê.
    const encerrado = protocoloEncerrado(doc?.status);

    return {
        dias,
        encerrado,
        ajustadoPelaGestao: Boolean(doc?.prazoAjustado),
        texto: encerrado
            ? 'Atendimento encerrado — não há mais prazo de resposta em aberto.'
            : `A gestão municipal responde este protocolo em até ${dias} ${dias === 1 ? 'dia útil' : 'dias úteis'}.`
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
    const ano = new Date(doc?.dataCriacao || Date.now()).getFullYear();
    const sufixo = String(doc?._id || '000000').slice(-6).toUpperCase();
    const prefixo = tipo === 'denuncia' ? 'DEN' : 'MEL';
    return `${prefixo}-${ano}-${sufixo}`;
}

/*
 * ============================================================================
 * MODERAÇÃO PRÉVIA E ENCAMINHAMENTO INTERNO (PILOTO 90 DIAS)
 * ============================================================================
 */
export const ESTADOS_MODERACAO = {
    pendente: {
        chave: 'pendente',
        rotulo: 'Retido • Em Moderação',
        rotuloCurto: 'Pendente',
        descricao: 'Visível apenas para o autor e para a assessoria municipal até revisão.',
        cor: 'warning',
        icone: 'bi-hourglass-split'
    },
    aprovado: {
        chave: 'aprovado',
        rotulo: 'Aprovado no Feed',
        rotuloCurto: 'Aprovado',
        descricao: 'Revisado pela moderação e liberado para visualização pública.',
        cor: 'success',
        icone: 'bi-patch-check-fill'
    },
    encaminhado: {
        chave: 'encaminhado',
        rotulo: 'Encaminhado a Órgão',
        rotuloCurto: 'Encaminhado',
        descricao: 'Encaminhado internamente para secretaria municipal ou autoridade competente.',
        cor: 'info',
        icone: 'bi-send-check-fill'
    },
    bloqueado: {
        chave: 'bloqueado',
        rotulo: 'Bloqueado por Diretrizes',
        rotuloCurto: 'Bloqueado',
        descricao: 'Retido definitivamente por violação das diretrizes da plataforma.',
        cor: 'danger',
        icone: 'bi-slash-circle-fill'
    }
};

export const LISTA_ESTADOS_MODERACAO = Object.keys(ESTADOS_MODERACAO);

export const ORGAOS_ENCAMINHAMENTO = [
    'Secretaria de Infraestrutura e Obras',
    'Secretaria de Meio Ambiente e Agricultura',
    'Autarquia de Trânsito e Guarda Municipal',
    'Vigilância Sanitária e Endemias',
    'Delegacia de Polícia Civil / Segurança Pública',
    'Corpo de Bombeiros / Defesa Civil',
    'Ouvidoria / Gabinete Municipal'
];

export function statusModeracaoDe(doc) {
    const chaveBruta = doc?.moderacao?.status;
    const chave = LISTA_ESTADOS_MODERACAO.includes(chaveBruta) ? chaveBruta : 'pendente';
    return {
        ...ESTADOS_MODERACAO[chave],
        moderadoPorNome: doc?.moderacao?.moderadoPorNome || null,
        moderadoEm: doc?.moderacao?.moderadoEm || null,
        orgaoEncaminhado: doc?.moderacao?.orgaoEncaminhado || null,
        motivoBloqueio: doc?.moderacao?.motivoBloqueio || null,
        notaModeracao: doc?.moderacao?.notaModeracao || null,
        textoEditadoPelaModeracao: Boolean(doc?.moderacao?.textoEditadoPelaModeracao),
        trilha: Array.isArray(doc?.moderacao?.trilha) ? doc.moderacao.trilha : []
    };
}

// Verifica se o documento foi formalmente aprovado para exibição no feed público.
// Documentos legados sem o campo `moderacao.status` permanecem compatíveis.
// Se o post foi tornado sigiloso (`privada: true`), não aparece no feed público.
export function estaAprovadoParaFeed(doc) {
    if (doc?.privada === true) return false;
    const statusMod = doc?.moderacao?.status;
    return !statusMod || statusMod === 'aprovado';
}

// Filtro do MongoDB que garante que apenas conteúdos formalmente aprovados (ou legados
// anteriores à criação do campo) e não sigilosos entrem nos feeds públicos.
export function filtroModeracaoPublica() {
    return {
        privada: { $ne: true },
        $or: [
            { 'moderacao.status': 'aprovado' },
            { 'moderacao.status': { $exists: false } }
        ]
    };
}

// Verifica se um usuário pode visualizar um chamado de melhoria (pendente/bloqueado
// fica restrito ao autor e à equipe administrativa).
export function podeVerChamado(doc, usuario) {
    if (!doc) return false;
    if (estaAprovadoParaFeed(doc)) return true;
    if (!usuario) return false;
    if (usuario.areAdmin) return true;

    const autor = doc.usuario?._id || doc.usuario;
    return Boolean(autor) && String(autor) === String(usuario._id);
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
 * No hub público, denúncia só aparece se for pública (Foco de Queimada ou
 * liberada pela gestão) E estiver formalmente aprovada pela moderação prévia.
 */
export const OCORRENCIAS_PUBLICAS = ['Foco de Queimada'];

export const nasceSigilosa = (tipoOcorrencia) => !OCORRENCIAS_PUBLICAS.includes(tipoOcorrencia);

const EH_PUBLICA = {
    $and: [
        {
            $or: [
                { privada: false },
                { privada: { $exists: false }, tipoOcorrencia: { $in: OCORRENCIAS_PUBLICAS } }
            ]
        },
        {
            $or: [
                { 'moderacao.status': 'aprovado' },
                { 'moderacao.status': { $exists: false } }
            ]
        }
    ]
};

export function filtroDeSigilo() {
    return EH_PUBLICA;
}

/*
 * Acesso direto a UMA denúncia (detalhe e linha do tempo do protocolo) — aqui
 * sim o autor continua tendo acesso à própria denúncia, mesmo sigilosa ou em
 * moderação, para poder acompanhar o atendimento.
 */
export function podeVerDenuncia(doc, usuario) {
    if (!doc) return false;

    const ehPublica =
        doc?.privada === false ||
        (doc?.privada === undefined && OCORRENCIAS_PUBLICAS.includes(doc?.tipoOcorrencia));

    if (ehPublica && estaAprovadoParaFeed(doc)) return true;
    if (!usuario) return false;
    if (usuario.areAdmin) return true;

    const autor = doc.usuario?._id || doc.usuario;
    return Boolean(autor) && String(autor) === String(usuario._id);
}

/*
 * Anonimato do denunciante / cidadão.
 *
 * Quando a postagem é marcada como anônima (`isConfidential: true`) ou é uma
 * denúncia sigilosa, a renderização pública e padrão mascara completamente a
 * identidade do autor, mantendo o vínculo `usuario` e o log de IP no banco.
 */
export const AUTOR_ANONIMO = {
    _id: null,
    name: 'Cidadão Protegido',
    profileImage: '/img/guest.webp',
    profession: 'Identidade protegida',
    anonimo: true,
    isDeleted: false
};

export const ehDenunciaSigilosa = (doc) =>
    doc?.privada === true ||
    (doc?.privada === undefined && !OCORRENCIAS_PUBLICAS.includes(doc?.tipoOcorrencia));

// Troca o autor por um perfil anônimo quando a publicação é anônima ou denúncia sigilosa.
export function anonimizarAutor(autor, doc) {
    return (doc?.isConfidential || ehDenunciaSigilosa(doc)) ? { ...AUTOR_ANONIMO } : autor;
}

/*
 * Comprovante de protocolo pré-formatado para compartilhamento via e-mail (mailto:).
 */
export function montarComprovanteEmail(doc, tipo) {
    const eixo = EIXOS_COM_PROTOCOLO[tipo] || EIXOS_COM_PROTOCOLO.melhoria;
    const numero = numeroDoProtocolo(doc, tipo);
    const prazo = prazoDoProtocolo(doc, tipo);
    const dataCriacao = new Date(doc?.dataCriacao || Date.now());
    const dataFormatada = dataCriacao.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
    const baseUrl = (process.env.URL_PUBLICA || 'http://localhost:8080').replace(/\/+$/, '');
    const linkProtocolo = `/protocolos/${tipo}/${doc._id}`;
    const downloadUrl = `/protocolos/${tipo}/${doc._id}/comprovante?formato=txt`;
    const impressaoUrl = `/protocolos/${tipo}/${doc._id}/comprovante`;
    const urlCompleta = `${baseUrl}${linkProtocolo}`;
    const categoriaOcorrencia = doc.tipoOcorrencia || doc.categoria || eixo.rotulo;
    const bairro = extrairBairro(doc);

    const assunto = `[Comprovante Voz Ativa] Protocolo ${numero} - ${doc.titulo || eixo.rotulo}`;
    const corpo = [
        'COMPROVANTE DE REGISTRO - PORTAL VOZ ATIVA (CARIÚS/CE)',
        '--------------------------------------------------------',
        `Número do Protocolo: ${numero}`,
        `Módulo: ${eixo.rotulo}`,
        `Categoria/Ocorrência: ${categoriaOcorrencia}`,
        `Bairro/Localidade: ${bairro}`,
        `Título: ${doc.titulo}`,
        `Localização: ${doc.localizacao}`,
        `Data do Registro: ${dataFormatada}`,
        `Status Inicial: Em Moderação Prévia / Aguardando Triagem`,
        `Prazo Estimado de Resposta: Até ${prazo.dias} dias úteis`,
        '',
        `Acompanhe o andamento pelo link:`,
        urlCompleta,
        '',
        'Guarde este e-mail como comprovante oficial do seu protocolo.'
    ].join('\n');

    return {
        id: String(doc._id),
        numero,
        protocolo: numero,
        tipo,
        rotuloEixo: eixo.rotulo,
        categoriaOcorrencia,
        bairro,
        titulo: doc.titulo,
        localizacao: doc.localizacao,
        dataFormatada,
        prazoDias: prazo.dias,
        linkProtocolo,
        downloadUrl,
        impressaoUrl,
        mailtoUrl: `mailto:?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`
    };
}

/*
 * Gera o texto oficial estruturado do comprovante de protocolo para download direto (.txt).
 */
export function gerarTextoComprovanteOficial(doc, tipo) {
    const dados = montarComprovanteEmail(doc, tipo);
    const moderacao = statusModeracaoDe(doc);
    const estagio = normalizarStatus(doc.status);
    const baseUrl = (process.env.URL_PUBLICA || 'http://localhost:8080').replace(/\/+$/, '');
    const urlAcompanhamento = `${baseUrl}${dados.linkProtocolo}`;

    return [
        '================================================================================',
        '           COMPROVANTE OFICIAL DE PROTOCOLO — PORTAL VOZ ATIVA                  ',
        '                     Município de Cariús — Ceará                                ',
        '================================================================================',
        '',
        '1. IDENTIFICAÇÃO DO PROTOCOLO',
        `   Código do Protocolo:      ${dados.numero}`,
        `   Data e Hora do Registro:  ${dados.dataFormatada}`,
        `   Módulo do Portal:         ${dados.rotuloEixo}`,
        `   Categoria da Ocorrência:  ${dados.categoriaOcorrencia}`,
        `   Título do Relato:         ${dados.titulo || dados.categoriaOcorrencia}`,
        '',
        '2. LOCALIZAÇÃO REGISTRADA',
        `   Bairro / Localidade:      ${dados.bairro}`,
        `   Endereço / Referência:    ${dados.localizacao}`,
        '',
        '3. SITUAÇÃO E PRAZO DE ATENDIMENTO',
        `   Estágio Operacional:      ${estagio}`,
        `   Situação na Moderação:    ${moderacao.rotulo}`,
        `   Prazo Estimado (SLA):     Até ${dados.prazoDias} dias úteis`,
        '',
        '4. INSTRUÇÕES PARA ACOMPANHAMENTO',
        '   - Acesse o Portal Voz Ativa com sua conta e entre em "Meus Protocolos";',
        `   - Ou acesse diretamente o endereço do seu protocolo:`,
        `     ${urlAcompanhamento}`,
        '   - Pela linha do tempo do protocolo você pode consultar respostas da gestão,',
        '     enviar informações complementares, anexar fotos ou interpor recurso.',
        '   - Nota importante: Emergências em andamento ou risco imediato devem ser',
        '     acionadas imediatamente via 190 (Polícia Militar), 181 (Disque-Denúncia)',
        '     ou 193 (Corpo de Bombeiros).',
        '',
        '================================================================================',
        `Comprovante emitido pelo Portal Voz Ativa em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}`,
        '================================================================================'
    ].join('\r\n');
}

/*
 * Extração padronizada de bairro/localidade para o Dashboard Executivo.
 */
export function extrairBairro(doc) {
    const ehGenericoOuPais = (val) =>
        /^(brazil|brasil|cear[aá]|ce|cari[uú]s|regi[aã]o\s+.*|n[aã]o\s+informado|unnamed\s+road)$/i.test(
            String(val || '').trim()
        );

    if (doc?.bairro && String(doc.bairro).trim() !== '') {
        const b = String(doc.bairro).trim();
        if (!ehGenericoOuPais(b)) {
            return b;
        }
    }
    const loc = String(doc?.localizacao || '').trim();
    if (!loc) return 'Cariús - CE (Zona Urbana/Rural)';

    const locLower = loc.toLowerCase();
    for (const bairro of BAIRROS_CARIUS) {
        if (locLower.includes(bairro.toLowerCase())) {
            return bairro;
        }
    }

    const partes = loc
        .split(/[,-]/)
        .map((p) => p.trim())
        .filter((p) => p && !ehGenericoOuPais(p) && !/^\d{5}-?\d{3}$/.test(p));

    if (partes.length >= 2) {
        return partes[1].slice(0, 45);
    }
    if (partes.length === 1) {
        return partes[0].slice(0, 45);
    }
    return 'Cariús - CE (Zona Urbana/Rural)';
}

/*
 * Recurso do cidadão contra o arquivamento.
 */
export const DECISOES_RECURSO = {
    pendente: { rotulo: 'Aguardando análise', cor: 'warning', icone: 'bi-hourglass-split' },
    pertinente: { rotulo: 'Recurso aceito', cor: 'success', icone: 'bi-check-circle-fill' },
    improcedente: { rotulo: 'Recurso indeferido', cor: 'secondary', icone: 'bi-x-circle-fill' }
};

export function montarRecurso(doc, sigilosa = false) {
    const bruto = doc?.recurso;

    if (!bruto || !bruto.criadoEm) {
        return {
            existe: false,
            podeAbrir: protocoloEncerrado(doc?.status) && normalizarStatus(doc?.status) === 'Improcedente'
        };
    }

    const decisao = bruto.decisao || 'pendente';

    return {
        existe: true,
        podeAbrir: false,
        texto: bruto.texto,
        arquivo: bruto.arquivo || null,
        nomeArquivo: bruto.nomeArquivo || 'Anexo do recurso',
        criadoEm: bruto.criadoEm,
        decisao,
        situacao: { chave: decisao, ...DECISOES_RECURSO[decisao] },
        pendente: decisao === 'pendente',
        respostaTexto: bruto.respostaTexto || null,
        respondidoEm: bruto.respondidoEm || null,
        autorAnonimo: Boolean(sigilosa || doc?.isConfidential)
    };
}
// [Melhoria Proativa Adicionada: validações e integrações de governança aplicadas ao fluxo existente]
