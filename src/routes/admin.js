/*
 * Painel administrativo — visão geral dos protocolos, fila de moderação prévia
 * do assessor governamental, exportação para delegacia e dashboard executivo
 * de métricas do piloto de 90 dias.
 *
 * Todas as rotas passam por isAdmin: nenhuma delas é acessível a quem não tem
 * o privilégio, nem por link direto.
 */
import express from 'express';
import mongoose from 'mongoose';

import '../models/denuncias.js';
import '../models/categories.js';

import isAdmin from '../helpers/isAdmin.js';
import { notificarMudancaDeEstagio, notificarDecisaoDeRecurso } from '../helpers/email.js';
import {
    EIXOS_COM_PROTOCOLO,
    eixoValido,
    estagioDe,
    normalizarStatus,
    prazoDoProtocolo,
    dataLimite,
    numeroDoProtocolo,
    novidadesDoProtocolo,
    anonimizarAutor,
    montarRecurso,
    ehDenunciaSigilosa,
    statusModeracaoDe,
    ESTADOS_MODERACAO,
    LISTA_ESTADOS_MODERACAO,
    ORGAOS_ENCAMINHAMENTO,
    extrairBairro,
    LISTA_ESTAGIOS
} from '../helpers/protocolo.js';
import {
    statusProtocoloSchema,
    moderacaoSchema,
    buscaSchema,
    escaparRegex,
    normalizarMidias,
    primeiraMensagem,
    respostaRecursoSchema
} from '../helpers/validators.js';

const router = express.Router();

const modeloDo = (tipo) => mongoose.model(EIXOS_COM_PROTOCOLO[tipo].model);

async function destinatarioDoProtocolo(Modelo, id) {
    const doc = await Modelo.findById(id).populate('usuario', 'email name').lean();
    return doc?.usuario?.email || null;
}

// Resume um documento para as listagens do painel administrativo e fila de moderação.
function resumir(doc, tipo) {
    const eixo = EIXOS_COM_PROTOCOLO[tipo];
    const status = normalizarStatus(doc.status);
    const prazo = prazoDoProtocolo(doc, tipo);
    const moderacao = statusModeracaoDe(doc);

    return {
        _id: doc._id,
        tipo,
        eixo,
        titulo: doc.titulo,
        descricao: doc.descricao,
        categoria: doc.categoria || null,
        bairro: extrairBairro(doc),
        localizacao: doc.localizacao,
        latitude: doc.latitude || null,
        longitude: doc.longitude || null,
        tipoOcorrencia: doc.tipoOcorrencia || null,
        dataCriacao: doc.dataCriacao,
        // Denúncia sigilosa ou relato marcado como anônimo não revela quem publicou.
        autor: (tipo === 'denuncia' || doc.isConfidential) ? anonimizarAutor(doc.usuario || null, doc) : doc.usuario || null,
        isConfidential: Boolean(doc.isConfidential),
        status,
        estagio: estagioDe(status),
        moderacao,
        prazo,
        limite: dataLimite(doc.dataCriacao, prazo.dias),
        respostas: (doc.historico || []).length,
        novidades: novidadesDoProtocolo(doc),
        privada: Boolean(doc.privada),
        podeMudarSigilo: true,
        recurso: montarRecurso(doc, Boolean(doc.privada)),
        imagens: doc.imagens || [],
        video: doc.video || null,
        imagemPrincipal: doc.imagens && doc.imagens.length > 0 ? doc.imagens[0] : null,
        numero: numeroDoProtocolo(doc, tipo),
        linkProtocolo: `/protocolos/${tipo}/${doc._id}`,
        linkPost: `${eixo.rotaDetalhes}/${doc._id}`,
        linkRelatorioDelegacia: tipo === 'denuncia' ? `/admin/protocolo/denuncia/${doc._id}/exportar-delegacia` : null
    };
}

function filtroDeBusca(termo) {
    if (!termo) return {};

    const expressao = new RegExp(escaparRegex(termo), 'i');
    return {
        $or: [
            { titulo: expressao },
            { descricao: expressao },
            { localizacao: expressao },
            { tipoOcorrencia: expressao },
            { categoria: expressao },
            { bairro: expressao }
        ]
    };
}

async function consultarProtocolos({ termo, tipoFiltro }) {
    const filtro = filtroDeBusca(termo);
    const tipos = tipoFiltro === 'todos' ? Object.keys(EIXOS_COM_PROTOCOLO) : [tipoFiltro];

    const resultados = await Promise.all(
        tipos.map((tipo) =>
            modeloDo(tipo)
                .find(filtro)
                .populate('usuario', 'name profileImage profession')
                .sort({ dataCriacao: -1 })
                .limit(200)
                .lean()
                .then((docs) => docs.map((doc) => resumir(doc, tipo)))
        )
    );

    return resultados.flat().sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));
}

router.get('/', isAdmin, (req, res) => {
    res.render('admin/index');
});

// --- BUSCA EM TEMPO REAL (devolve só as linhas da listagem) ---
router.get('/painel/buscar', isAdmin, async (req, res) => {
    try {
        const busca = buscaSchema.safeParse(req.query);
        const termo = busca.success ? busca.data.q : '';
        const tipoFiltro = eixoValido(req.query.tipo) ? req.query.tipo : 'todos';

        res.render('partials/_linhas_painel', {
            layout: false,
            protocolos: await consultarProtocolos({ termo, tipoFiltro }),
            estagios: LISTA_ESTAGIOS.map((chave) => estagioDe(chave)),
            orgaosEncaminhamento: ORGAOS_ENCAMINHAMENTO
        });
    } catch (err) {
        console.error('Erro na busca do painel:', err);
        res.status(500).send('');
    }
});

// --- PAINEL: visão geral + fila de moderação + filtros + busca ---
router.get('/painel', isAdmin, async (req, res) => {
    try {
        const busca = buscaSchema.safeParse(req.query);
        const termo = busca.success ? busca.data.q : '';

        const tipoFiltro = eixoValido(req.query.tipo) ? req.query.tipo : 'todos';
        const statusFiltro = LISTA_ESTAGIOS.includes(req.query.status) ? req.query.status : 'todos';
        const moderacaoFiltro = LISTA_ESTADOS_MODERACAO.includes(req.query.moderacao) ? req.query.moderacao : 'todos';

        const todos = await consultarProtocolos({ termo, tipoFiltro });

        const resumo = LISTA_ESTAGIOS.map((chave) => {
            const estagio = estagioDe(chave);
            return {
                ...estagio,
                total: todos.filter((p) => p.status === chave).length,
                ativo: statusFiltro === chave,
                link: `/admin/painel?tipo=${tipoFiltro}&status=${encodeURIComponent(chave)}${termo ? '&q=' + encodeURIComponent(termo) : ''}`
            };
        });

        const resumoModeracao = LISTA_ESTADOS_MODERACAO.map((chave) => ({
            ...ESTADOS_MODERACAO[chave],
            total: todos.filter((p) => p.moderacao.chave === chave).length,
            ativo: moderacaoFiltro === chave
        }));

        const totalPendentesModeracao = todos.filter((p) => p.moderacao.chave === 'pendente').length;

        let protocolos = statusFiltro === 'todos' ? todos : todos.filter((p) => p.status === statusFiltro);
        if (moderacaoFiltro !== 'todos') {
            protocolos = protocolos.filter((p) => p.moderacao.chave === moderacaoFiltro);
        }

        res.render('admin/painel', {
            protocolos,
            resumo,
            resumoModeracao,
            totalPendentesModeracao,
            totalGeral: todos.length,
            termo,
            tipoFiltro,
            statusFiltro,
            moderacaoFiltro,
            estagios: LISTA_ESTAGIOS.map((chave) => estagioDe(chave)),
            estadosModeracao: Object.values(ESTADOS_MODERACAO),
            orgaosEncaminhamento: ORGAOS_ENCAMINHAMENTO,
            eixos: Object.values(EIXOS_COM_PROTOCOLO)
        });
    } catch (err) {
        console.error('Erro no painel administrativo:', err);
        req.flash('error_msg', 'Erro ao carregar o painel.');
        res.redirect('/admin');
    }
});

// --- AÇÃO DE MODERAÇÃO PRÉVIA (ASSESSOR GOVERNAMENTAL) ---
// Permite editar o texto antes de aprovar, aprovar para o feed público,
// bloquear por violação de diretrizes ou encaminhar internamente a órgão competente,
// registrando a trilha de auditoria (quem moderou e quando).
router.post('/protocolo/:tipo/:id/moderar', isAdmin, async (req, res) => {
    const { tipo, id } = req.params;
    const voltarPara = req.get('referer') || '/admin/painel';

    if (!eixoValido(tipo) || !mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Protocolo não encontrado.');
        return res.redirect('/admin/painel');
    }

    const validacao = moderacaoSchema.safeParse(req.body);
    if (!validacao.success) {
        req.flash('error_msg', primeiraMensagem(validacao.error));
        return res.redirect(voltarPara);
    }

    const { acao, titulo, descricao, orgaoEncaminhado, orgaoEncaminhadoOutro, motivoBloqueio, notaModeracao, liberarNoHub } = validacao.data;
    const orgaoFinal = (
        orgaoEncaminhado === 'Outros' || !orgaoEncaminhado
            ? (orgaoEncaminhadoOutro || '')
            : orgaoEncaminhado
    ).trim();

    try {
        const Modelo = modeloDo(tipo);
        const doc = await Modelo.findById(id).lean();

        if (!doc) {
            req.flash('error_msg', 'Protocolo não encontrado.');
            return res.redirect('/admin/painel');
        }

        const agora = new Date();
        const moderadorNome = req.user.name || 'Assessor Municipal';
        const camposSet = {
            'moderacao.moderadoPor': req.user._id,
            'moderacao.moderadoPorNome': moderadorNome,
            'moderacao.moderadoEm': agora
        };

        let textoEditado = false;
        if (titulo && titulo.trim().length >= 4 && titulo.trim() !== doc.titulo) {
            camposSet.titulo = titulo.trim();
            textoEditado = true;
        }
        if (descricao && descricao.trim().length >= 10 && descricao.trim() !== doc.descricao) {
            camposSet.descricao = descricao.trim();
            textoEditado = true;
        }
        if (textoEditado) {
            camposSet['moderacao.textoEditadoPelaModeracao'] = true;
        }

        const statusAnterior = normalizarStatus(doc.status);
        let statusNovoProtocolo = null;
        let mensagemHistorico = '';
        let detalheTrilha = '';
        let flashSucesso = '';

        if (acao === 'editar_texto') {
            detalheTrilha = textoEditado
                ? 'Texto higienizado pela assessoria de moderação (remoção de menções pessoais ou adequação editorial).'
                : 'Revisão textual registrada pela moderação.';
            mensagemHistorico = `[Moderação] ${detalheTrilha}`;
            flashSucesso = 'Texto da ocorrência revisado pela moderação.';
        } else if (acao === 'aprovar' || acao === 'editar_aprovar') {
            camposSet['moderacao.status'] = 'aprovado';
            if (notaModeracao) camposSet['moderacao.notaModeracao'] = notaModeracao;
            if (tipo === 'melhoria' || liberarNoHub) {
                camposSet.privada = false;
            }
            detalheTrilha = textoEditado
                ? 'Texto revisado e ocorrência aprovada para exibição no feed público.'
                : 'Ocorrência aprovada pela assessoria para exibição no feed público.';
            mensagemHistorico = `[Moderação] ${detalheTrilha}${notaModeracao ? ' Nota: ' + notaModeracao : ''}`;
            flashSucesso = 'Ocorrência aprovada e liberada para o feed público!';
        } else if (acao === 'sigilar') {
            camposSet.privada = true;
            if (notaModeracao) camposSet['moderacao.notaModeracao'] = notaModeracao;
            detalheTrilha = `Publicação tornada sigilosa (retirada do feed público).${notaModeracao ? ' Motivo: ' + notaModeracao : ''}`;
            mensagemHistorico = `[Sigilo] A gestão tornou esta publicação sigilosa: ela deixa de ser exibida no feed público e fica restrita ao autor e à gestão.${notaModeracao ? ' Nota: ' + notaModeracao : ''}`;
            flashSucesso = 'Publicação marcada como sigilosa e retirada do feed público.';
        } else if (acao === 'bloquear') {
            const motivo = motivoBloqueio || notaModeracao || 'Violação das diretrizes de civilidade e uso da plataforma.';
            camposSet['moderacao.status'] = 'bloqueado';
            camposSet['moderacao.motivoBloqueio'] = motivo;
            camposSet.status = 'Improcedente';
            statusNovoProtocolo = 'Improcedente';
            camposSet.privada = true;
            detalheTrilha = `Bloqueado na moderação prévia: ${motivo}`;
            mensagemHistorico = `[Moderação] Publicação retida/bloqueada por violação das diretrizes. Motivo: ${motivo}`;
            flashSucesso = 'Ocorrência bloqueada por violação das diretrizes.';
        } else if (acao === 'encaminhar') {
            const orgao = orgaoFinal || 'Secretaria Municipal Competente';
            camposSet['moderacao.orgaoEncaminhado'] = orgao;
            if (notaModeracao) camposSet['moderacao.notaModeracao'] = notaModeracao;

            if (liberarNoHub) {
                camposSet['moderacao.status'] = 'aprovado';
                camposSet.privada = false;
            } else {
                camposSet['moderacao.status'] = 'encaminhado';
            }

            if (statusAnterior === 'Novo') {
                camposSet.status = 'Em Atendimento';
                statusNovoProtocolo = 'Em Atendimento';
            }

            detalheTrilha = `Caso encaminhado internamente para: ${orgao}.${notaModeracao ? ' Despacho: ' + notaModeracao : ''}`;
            mensagemHistorico = `[Encaminhamento Interno] Demanda encaminhada pela assessoria para ${orgao}.${notaModeracao ? ' Orientação: ' + notaModeracao : ''}`;
            flashSucesso = `Ocorrência encaminhada para ${orgao}!`;
        }

        await Modelo.findByIdAndUpdate(id, {
            $set: camposSet,
            $push: {
                'moderacao.trilha': {
                    acao,
                    moderador: req.user._id,
                    moderadorNome,
                    detalhe: detalheTrilha,
                    orgao: orgaoFinal || null,
                    createdAt: agora
                },
                historico: {
                    autor: req.user._id,
                    papel: 'admin',
                    texto: mensagemHistorico,
                    statusAnterior: statusNovoProtocolo ? statusAnterior : null,
                    statusNovo: statusNovoProtocolo,
                    createdAt: agora
                }
            }
        });

        req.flash('success_msg', flashSucesso);
        res.redirect(voltarPara);
    } catch (err) {
        console.error('Erro na moderação do protocolo:', err);
        req.flash('error_msg', 'Erro ao registrar decisão de moderação.');
        res.redirect(voltarPara);
    }
});

// --- ALTERAÇÃO DE ESTÁGIO ---
router.post('/protocolo/:tipo/:id/status', isAdmin, async (req, res) => {
    const { tipo, id } = req.params;
    const voltarPara = req.get('referer') || '/admin/painel';

    if (!eixoValido(tipo) || !mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Protocolo não encontrado.');
        return res.redirect('/admin/painel');
    }

    const validacao = statusProtocoloSchema.safeParse(req.body);

    if (!validacao.success) {
        req.flash('error_msg', primeiraMensagem(validacao.error));
        return res.redirect(voltarPara);
    }

    const { status, texto, prazoDias } = validacao.data;

    try {
        const Modelo = modeloDo(tipo);
        const doc = await Modelo.findById(id).lean();

        if (!doc) {
            req.flash('error_msg', 'Protocolo não encontrado.');
            return res.redirect('/admin/painel');
        }

        const statusAnterior = normalizarStatus(doc.status);
        const [imagem] = normalizarMidias(req.body['imagem_url'] || req.body.imagem_url, 1);

        const atualizacao = {
            status,
            $push: {
                historico: {
                    autor: req.user._id,
                    papel: 'admin',
                    texto: texto && texto.trim() !== ''
                        ? texto
                        : `Estágio alterado de "${statusAnterior}" para "${status}".`,
                    imagem: imagem || null,
                    statusAnterior,
                    statusNovo: status,
                    createdAt: new Date()
                }
            }
        };

        if (prazoDias !== null) {
            atualizacao.prazoDias = prazoDias;
            atualizacao.prazoAjustado = true;
        }

        const { $push, ...camposDiretos } = atualizacao;
        await Modelo.findByIdAndUpdate(id, { $set: camposDiretos, $push });

        const destinatario = await destinatarioDoProtocolo(Modelo, id);

        notificarMudancaDeEstagio({
            destinatario,
            protocolo: {
                tipo,
                id: String(id),
                numero: numeroDoProtocolo(doc, tipo),
                titulo: doc.titulo
            },
            de: statusAnterior,
            para: status,
            mensagem: texto && texto.trim() !== '' ? texto : null,
            sigilosa: tipo === 'denuncia' && ehDenunciaSigilosa(doc)
        }).catch((err) => console.error('Falha ao avisar mudança de estágio:', err.message));

        req.flash('success_msg', `Protocolo atualizado para "${status}".`);
        res.redirect(voltarPara);
    } catch (err) {
        console.error('Erro ao alterar estágio do protocolo:', err);
        req.flash('error_msg', 'Erro ao atualizar o protocolo.');
        res.redirect(voltarPara);
    }
});

// --- SIGILO DA PUBLICAÇÃO (DENÚNCIA OU MELHORIA) ---
// Permite sigilar um post mesmo depois de já estar disponível no feed público,
// ou liberá-lo para o hub público, registrando na trilha de auditoria.
router.post('/protocolo/:tipo/:id/sigilo', isAdmin, async (req, res) => {
    const { tipo, id } = req.params;
    const voltarPara = req.get('referer') || '/admin/painel';

    if (!eixoValido(tipo) || !mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Publicação não encontrada.');
        return res.redirect('/admin/painel');
    }

    const deveSerPrivada = req.body.privada === '1';

    try {
        const Modelo = modeloDo(tipo);
        const doc = await Modelo.findById(id).lean();

        if (!doc) {
            req.flash('error_msg', 'Publicação não encontrada.');
            return res.redirect('/admin/painel');
        }

        const agora = new Date();
        const moderadorNome = req.user.name || 'Assessor Municipal';
        const camposSet = {
            privada: deveSerPrivada,
            'moderacao.moderadoPor': req.user._id,
            'moderacao.moderadoPorNome': moderadorNome,
            'moderacao.moderadoEm': agora
        };

        if (!deveSerPrivada) {
            camposSet['moderacao.status'] = 'aprovado';
        }

        await Modelo.findByIdAndUpdate(id, {
            $set: camposSet,
            $push: {
                'moderacao.trilha': {
                    acao: deveSerPrivada ? 'sigilar' : 'aprovado',
                    moderador: req.user._id,
                    moderadorNome,
                    detalhe: deveSerPrivada
                        ? 'Publicação marcada como sigilosa (retirada do hub público).'
                        : 'Publicação aprovada e liberada para o hub público.',
                    createdAt: agora
                },
                historico: {
                    autor: req.user._id,
                    papel: 'admin',
                    texto: deveSerPrivada
                        ? 'A gestão marcou esta publicação como sigilosa: ela deixa de aparecer no hub público.'
                        : 'A gestão liberou esta publicação para o hub público.',
                    createdAt: agora
                }
            }
        });

        req.flash('success_msg', deveSerPrivada ? 'Publicação marcada como sigilosa e retirada do feed público.' : 'Publicação liberada para o hub público.');
        res.redirect(voltarPara);
    } catch (err) {
        console.error('Erro ao alterar o sigilo da publicação:', err);
        req.flash('error_msg', 'Erro ao alterar o sigilo da publicação.');
        res.redirect(voltarPara);
    }
});

// --- EXPORTAÇÃO ESTRUTURADA DE DENÚNCIA PARA DELEGACIA LOCAL ---
router.get('/protocolo/denuncia/:id/exportar-delegacia', isAdmin, async (req, res) => {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Denúncia não encontrada.');
        return res.redirect('/admin/painel');
    }

    try {
        const Denuncia = modeloDo('denuncia');
        const doc = await Denuncia.findById(id).populate('usuario', 'name email phone').lean();

        if (!doc) {
            req.flash('error_msg', 'Denúncia não encontrada.');
            return res.redirect('/admin/painel');
        }

        const numero = numeroDoProtocolo(doc, 'denuncia');
        const moderacao = statusModeracaoDe(doc);
        const dataEmissao = new Date();
        const bairro = extrairBairro(doc);
        const coordenadasTexto = doc.latitude && doc.longitude ? `${doc.latitude}, ${doc.longitude}` : 'Não informadas';

        const relatorio = {
            cabecalho: 'RELATÓRIO TÉCNICO DE OCORRÊNCIA — ENCAMINHAMENTO À DELEGACIA DE POLÍCIA CIVIL',
            municipio: 'Cariús — Estado do Ceará',
            origem: 'Portal Voz Ativa — Módulo de Triagem e Governança Cívica',
            emitidoEm: dataEmissao.toISOString(),
            emitidoPor: req.user.name || 'Assessoria Municipal',
            idInterno: String(doc._id),
            tipoOcorrencia: doc.tipoOcorrencia,
            statusOperacional: normalizarStatus(doc.status),
            statusModeracao: moderacao.rotulo,
            orgaoEncaminhado: moderacao.orgaoEncaminhado || 'Delegacia de Polícia Civil / Segurança Pública',
            dataRegistro: doc.dataCriacao,
            titulo: doc.titulo,
            descricao: doc.descricao,
            localizacao: doc.localizacao,
            bairro,
            coordenadas: coordenadasTexto,
            imagens: doc.imagens || [],
            video: doc.video || null,
            postagemAnonimaNoFeed: Boolean(doc.isConfidential || doc.privada),
            autorInterno: {
                id: doc.usuario?._id ? String(doc.usuario._id) : String(doc.usuario || 'N/A'),
                nome: doc.usuario?.name || 'Cidadão Cadastrado',
                email: doc.usuario?.email || 'Preservado no cadastro',
                telefone: doc.usuario?.phone || 'Não informado'
            },
            protocolo: {
                numero,
                idRegistro: String(doc._id),
                dataHoraOcorrencia: doc.dataCriacao,
                tipoOcorrencia: doc.tipoOcorrencia,
                titulo: doc.titulo,
                statusOperacional: normalizarStatus(doc.status),
                statusModeracao: moderacao.rotulo,
                orgaoEncaminhado: moderacao.orgaoEncaminhado || 'Delegacia de Polícia Civil / Segurança Pública',
                sigiloPublico: doc.privada ? 'SIGILOSO (Restrito à Gestão)' : 'PÚBLICO (Alerta Comunitário)'
            },
            localizacaoDetalhada: {
                endereco: doc.localizacao,
                bairro,
                latitude: doc.latitude || null,
                longitude: doc.longitude || null,
                mapaUrl: doc.latitude && doc.longitude
                    ? `https://www.openstreetmap.org/?mlat=${doc.latitude}&mlon=${doc.longitude}#map=17/${doc.latitude}/${doc.longitude}`
                    : null
            },
            relatoDosFatos: doc.descricao,
            evidencias: {
                quantidadeFotos: (doc.imagens || []).length,
                fotosUrls: doc.imagens || [],
                videoUrl: doc.video || null
            },
            auditoriaModeracao: moderacao.trilha,
            historicoAtendimento: (doc.historico || []).map((h) => ({
                data: h.createdAt,
                papel: h.papel,
                texto: h.texto,
                statusNovo: h.statusNovo || null
            })),
            custodiaLegal: {
                declaracaoVeracidadeAceita: Boolean(doc.declaredAccuracy),
                versaoTermos: doc.termsVersion || '2026-09-23',
                identidadeDenunciante: 'PROTEGIDA POR SIGILO ADMINISTRATIVO (Metadados de conexão e autoria preservados sob custódia no banco de dados para eventual requisição judicial, conforme Marco Civil da Internet - Lei 12.965/2014).'
            }
        };

        if (req.query.formato === 'json') {
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="relatorio-delegacia-${numero}.json"`);
            return res.send(JSON.stringify(relatorio, null, 2));
        }

        if (req.query.formato === 'txt') {
            const linhasTxt = [
                '================================================================================',
                relatorio.cabecalho,
                `${relatorio.municipio} | ${relatorio.origem}`,
                '================================================================================',
                `NÚMERO DO PROTOCOLO: ${numero}`,
                `ID DO REGISTRO:      ${relatorio.protocolo.idRegistro}`,
                `DATA DO REGISTRO:    ${new Date(doc.dataCriacao).toLocaleString('pt-BR')}`,
                `DATA DA EMISSÃO:     ${dataEmissao.toLocaleString('pt-BR')}`,
                `EMITIDO POR:         ${relatorio.emitidoPor}`,
                '--------------------------------------------------------------------------------',
                '1. CLASSIFICAÇÃO DA OCORRÊNCIA',
                `   Tipo de Infração/Crime: ${relatorio.protocolo.tipoOcorrencia}`,
                `   Título do Registro:     ${relatorio.protocolo.titulo}`,
                `   Estágio Atual:          ${relatorio.protocolo.statusOperacional}`,
                `   Situação na Moderação:  ${relatorio.protocolo.statusModeracao}`,
                `   Regime de Sigilo:       ${relatorio.protocolo.sigiloPublico}`,
                '--------------------------------------------------------------------------------',
                '2. LOCALIZAÇÃO DO FATO',
                `   Endereço Informado:     ${relatorio.localizacaoDetalhada.endereco}`,
                `   Bairro/Localidade:      ${relatorio.localizacaoDetalhada.bairro}`,
                `   Coordenadas GPS:        ${relatorio.localizacaoDetalhada.latitude && relatorio.localizacaoDetalhada.longitude ? `${relatorio.localizacaoDetalhada.latitude}, ${relatorio.localizacaoDetalhada.longitude}` : 'Não informadas'}`,
                `   Link Geográfico:        ${relatorio.localizacaoDetalhada.mapaUrl || 'N/A'}`,
                '--------------------------------------------------------------------------------',
                '3. RELATO INTEGRAL DOS FATOS',
                relatorio.relatoDosFatos,
                '--------------------------------------------------------------------------------',
                '4. EVIDÊNCIAS ANEXADAS',
                `   Fotos (${relatorio.evidencias.quantidadeFotos}):`,
                ...(relatorio.evidencias.fotosUrls.length
                    ? relatorio.evidencias.fotosUrls.map((u, idx) => `     [${idx + 1}] ${u}`)
                    : ['     Nenhuma foto anexada.']),
                `   Vídeo: ${relatorio.evidencias.videoUrl || 'Nenhum vídeo anexado.'}`,
                '--------------------------------------------------------------------------------',
                '5. TRILHA DE AUDITORIA DA MODERAÇÃO',
                ...(relatorio.auditoriaModeracao.length
                    ? relatorio.auditoriaModeracao.map((t) => `   - [${new Date(t.createdAt).toLocaleString('pt-BR')}] ${t.acao.toUpperCase()} por ${t.moderadorNome || 'Assessor'}: ${t.detalhe || ''}`)
                    : ['   - Sem registros adicionais de moderação.']),
                '--------------------------------------------------------------------------------',
                '6. NOTA DE CUSTÓDIA LEGAL E CADEIA DE EVIDÊNCIAS',
                `   Declaração Art. 299 CP Aceita: ${relatorio.custodiaLegal.declaracaoVeracidadeAceita ? 'SIM' : 'NÃO'}`,
                `   ${relatorio.custodiaLegal.identidadeDenunciante}`,
                '================================================================================'
            ].join('\n');

            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="relatorio-delegacia-${numero}.txt"`);
            return res.send(linhasTxt);
        }

        res.render('admin/relatorio-delegacia', {
            relatorio,
            doc,
            numero,
            moderacao,
            bairro,
            dataEmissao
        });
    } catch (err) {
        console.error('Erro ao exportar relatório para delegacia:', err);
        req.flash('error_msg', 'Não foi possível gerar o relatório para a delegacia.');
        res.redirect('/admin/painel');
    }
});

// --- DASHBOARD EXECUTIVO DE MÉTRICAS (PILOTO 90 DIAS) ---
router.get('/metricas', isAdmin, async (req, res) => {
    try {
        const Chamado = modeloDo('melhoria');
        const Denuncia = modeloDo('denuncia');

        const [chamadosDocs, denunciasDocs] = await Promise.all([
            Chamado.find({}).sort({ dataCriacao: -1 }).lean(),
            Denuncia.find({}).sort({ dataCriacao: -1 }).lean()
        ]);

        const agora = Date.now();
        const noventaDiasMs = 90 * 24 * 60 * 60 * 1000;

        const todos = [
            ...chamadosDocs.map((d) => ({ ...d, _tipoEixo: 'melhoria' })),
            ...denunciasDocs.map((d) => ({ ...d, _tipoEixo: 'denuncia' }))
        ];

        const dentroDe90Dias = todos.filter(
            (d) => agora - new Date(d.dataCriacao || agora).getTime() <= noventaDiasMs
        );

        const totalRecebidos = todos.length;
        const totalPiloto90Dias = dentroDe90Dias.length;
        const totalMelhorias = chamadosDocs.length;
        const totalDenuncias = denunciasDocs.length;

        const resolvidos = todos.filter((d) => normalizarStatus(d.status) === 'Resolvido').length;
        const emAtendimento = todos.filter((d) => normalizarStatus(d.status) === 'Em Atendimento').length;
        const novos = todos.filter((d) => normalizarStatus(d.status) === 'Novo').length;
        const improcedentes = todos.filter((d) => normalizarStatus(d.status) === 'Improcedente').length;

        const indiceResolvidos = totalRecebidos > 0 ? Math.round((resolvidos / totalRecebidos) * 100) : 0;
        const indiceAtendimentoAtivo = totalRecebidos > 0
            ? Math.round(((resolvidos + emAtendimento) / totalRecebidos) * 100)
            : 0;

        // Cálculo do tempo médio de primeira resposta da gestão
        let somaHorasResposta = 0;
        let contRespondidos = 0;
        for (const doc of todos) {
            const respostasAdmin = (doc.historico || []).filter((h) => h.papel === 'admin' && h.createdAt);
            if (respostasAdmin.length > 0 && doc.dataCriacao) {
                const primeira = respostasAdmin.reduce((menor, atual) =>
                    new Date(atual.createdAt) < new Date(menor.createdAt) ? atual : menor
                );
                const diffHoras = Math.max(
                    0.1,
                    (new Date(primeira.createdAt).getTime() - new Date(doc.dataCriacao).getTime()) / (1000 * 60 * 60)
                );
                somaHorasResposta += diffHoras;
                contRespondidos++;
            }
        }

        const tempoMedioHoras = contRespondidos > 0 ? Number((somaHorasResposta / contRespondidos).toFixed(1)) : 0;
        const tempoMedioDias = contRespondidos > 0 ? Number((tempoMedioHoras / 24).toFixed(1)) : 0;

        // Métricas de Moderação Prévia e Anonimato
        const modPendentes = todos.filter((d) => statusModeracaoDe(d).chave === 'pendente').length;
        const modAprovados = todos.filter((d) => statusModeracaoDe(d).chave === 'aprovado').length;
        const modEncaminhados = todos.filter((d) => statusModeracaoDe(d).chave === 'encaminhado').length;
        const modBloqueados = todos.filter((d) => statusModeracaoDe(d).chave === 'bloqueado').length;
        const totalAnonimos = todos.filter((d) => d.isConfidential || (d._tipoEixo === 'denuncia' && ehDenunciaSigilosa(d))).length;

        // Distribuição por Bairros / Localidades
        const mapaBairros = new Map();
        for (const doc of todos) {
            const bairro = extrairBairro(doc);
            const atual = mapaBairros.get(bairro) || { bairro, total: 0, resolvidos: 0, melhorias: 0, denuncias: 0 };
            atual.total++;
            if (normalizarStatus(doc.status) === 'Resolvido') atual.resolvidos++;
            if (doc._tipoEixo === 'melhoria') atual.melhorias++;
            else atual.denuncias++;
            mapaBairros.set(bairro, atual);
        }

        const porBairro = Array.from(mapaBairros.values())
            .sort((a, b) => b.total - a.total)
            .slice(0, 10)
            .map((item) => ({
                ...item,
                percentual: totalRecebidos > 0 ? Math.round((item.total / totalRecebidos) * 100) : 0,
                taxaResolucao: item.total > 0 ? Math.round((item.resolvidos / item.total) * 100) : 0
            }));

        // Distribuição por Categoria de Zeladoria / Tipo de Ocorrência
        const mapaCategorias = new Map();
        for (const doc of todos) {
            const chaveCat = doc._tipoEixo === 'denuncia'
                ? (doc.tipoOcorrencia || 'Denúncia')
                : (doc.categoria || 'Gestão de Melhorias');
            const atual = mapaCategorias.get(chaveCat) || {
                nome: chaveCat,
                eixo: doc._tipoEixo === 'denuncia' ? 'Denúncia' : 'Zeladoria',
                cor: doc._tipoEixo === 'denuncia' ? 'danger' : 'primary',
                total: 0
            };
            atual.total++;
            mapaCategorias.set(chaveCat, atual);
        }

        const porCategoria = Array.from(mapaCategorias.values())
            .sort((a, b) => b.total - a.total)
            .map((item) => ({
                ...item,
                percentual: totalRecebidos > 0 ? Math.round((item.total / totalRecebidos) * 100) : 0
            }));

        // Últimas ações da trilha de moderação
        const trilhaRecente = [];
        for (const doc of todos) {
            const trilha = doc.moderacao?.trilha || [];
            for (const item of trilha) {
                trilhaRecente.push({
                    numero: numeroDoProtocolo(doc, doc._tipoEixo),
                    titulo: doc.titulo,
                    tipo: doc._tipoEixo,
                    id: doc._id,
                    acao: item.acao,
                    moderadorNome: item.moderadorNome || 'Assessoria',
                    detalhe: item.detalhe,
                    orgao: item.orgao,
                    data: item.createdAt
                });
            }
        }
        trilhaRecente.sort((a, b) => new Date(b.data) - new Date(a.data));

        res.render('admin/metricas', {
            metricas: {
                totalRecebidos,
                totalPiloto90Dias,
                totalMelhorias,
                totalDenuncias,
                resolvidos,
                emAtendimento,
                novos,
                improcedentes,
                indiceResolvidos,
                indiceAtendimentoAtivo,
                tempoMedioHoras,
                tempoMedioDias,
                contRespondidos,
                modPendentes,
                modAprovados,
                modEncaminhados,
                modBloqueados,
                totalAnonimos,
                porBairro,
                porCategoria,
                trilhaRecente: trilhaRecente.slice(0, 12)
            }
        });
    } catch (err) {
        console.error('Erro ao carregar dashboard executivo de métricas:', err);
        req.flash('error_msg', 'Erro ao carregar o dashboard de métricas.');
        res.redirect('/admin/painel');
    }
});

// --- RESPOSTA AO RECURSO ---
router.post('/protocolo/:tipo/:id/recurso', isAdmin, async (req, res) => {
    const { tipo, id } = req.params;
    const voltarPara = req.get('referer') || '/admin/painel';

    if (!eixoValido(tipo) || !mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Protocolo não encontrado.');
        return res.redirect('/admin/painel');
    }

    const validacao = respostaRecursoSchema.safeParse(req.body);

    if (!validacao.success) {
        req.flash('error_msg', primeiraMensagem(validacao.error));
        return res.redirect(voltarPara);
    }

    const { decisao, texto } = validacao.data;

    try {
        const Modelo = modeloDo(tipo);
        const doc = await Modelo.findById(id).lean();

        if (!doc || !doc.recurso || !doc.recurso.criadoEm) {
            req.flash('error_msg', 'Este protocolo não tem recurso para responder.');
            return res.redirect(voltarPara);
        }

        if (doc.recurso.decisao && doc.recurso.decisao !== 'pendente') {
            req.flash('error_msg', 'Este recurso já foi respondido.');
            return res.redirect(voltarPara);
        }

        const novoStatus = decisao === 'pertinente' ? 'Reaberto' : 'Improcedente';
        const statusAnterior = normalizarStatus(doc.status);

        await Modelo.findByIdAndUpdate(id, {
            $set: {
                'recurso.decisao': decisao,
                'recurso.respostaTexto': texto || null,
                'recurso.respondidoPor': req.user._id,
                'recurso.respondidoEm': new Date(),
                status: novoStatus
            },
            $push: {
                historico: {
                    autor: req.user._id,
                    papel: 'admin',
                    texto: texto && texto.trim() !== ''
                        ? texto
                        : decisao === 'pertinente'
                            ? 'Recurso aceito: a demanda foi considerada pertinente e volta para atendimento.'
                            : 'Recurso analisado e indeferido: o arquivamento foi mantido.',
                    statusAnterior,
                    statusNovo: novoStatus,
                    createdAt: new Date()
                }
            }
        });

        const destinatarioRecurso = await destinatarioDoProtocolo(Modelo, id);

        notificarDecisaoDeRecurso({
            destinatario: destinatarioRecurso,
            protocolo: {
                tipo,
                id: String(id),
                numero: numeroDoProtocolo(doc, tipo),
                titulo: doc.titulo
            },
            aceito: decisao === 'pertinente',
            mensagem: texto && texto.trim() !== '' ? texto : null,
            sigilosa: tipo === 'denuncia' && ehDenunciaSigilosa(doc)
        }).catch((err) => console.error('Falha ao avisar decisão de recurso:', err.message));

        req.flash(
            'success_msg',
            decisao === 'pertinente'
                ? 'Recurso aceito. O protocolo voltou para atendimento.'
                : 'Recurso indeferido. O arquivamento foi mantido.'
        );
        res.redirect(voltarPara);
    } catch (err) {
        console.error('Erro ao responder recurso:', err);
        req.flash('error_msg', 'Erro ao responder o recurso.');
        res.redirect(voltarPara);
    }
});

export default router;
