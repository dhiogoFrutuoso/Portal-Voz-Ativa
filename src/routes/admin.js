/*
 * Painel administrativo — visão geral dos protocolos, filtros, busca e
 * alteração de estágio.
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
    LISTA_ESTAGIOS
} from '../helpers/protocolo.js';

/*
 * Dados que o e-mail precisa: para quem mandar e como identificar o protocolo.
 * O autor vem populado só aqui, no momento do envio — o resto do fluxo não
 * carrega e-mail de ninguém à toa.
 */
async function destinatarioDoProtocolo(Modelo, id) {
    const doc = await Modelo.findById(id).populate('usuario', 'email name').lean();
    return doc?.usuario?.email || null;
}
import {
    statusProtocoloSchema,
    buscaSchema,
    escaparRegex,
    normalizarMidias,
    primeiraMensagem,
    respostaRecursoSchema
} from '../helpers/validators.js';

const router = express.Router();

const modeloDo = (tipo) => mongoose.model(EIXOS_COM_PROTOCOLO[tipo].model);

// Resume um documento para as listagens do painel.
function resumir(doc, tipo) {
    const eixo = EIXOS_COM_PROTOCOLO[tipo];
    const status = normalizarStatus(doc.status);
    const prazo = prazoDoProtocolo(doc, tipo);

    return {
        _id: doc._id,
        tipo,
        eixo,
        titulo: doc.titulo,
        descricao: doc.descricao,
        localizacao: doc.localizacao,
        tipoOcorrencia: doc.tipoOcorrencia || null,
        dataCriacao: doc.dataCriacao,
        // Denúncia sigilosa não revela quem publicou, nem para a gestão.
        autor: tipo === 'denuncia' ? anonimizarAutor(doc.usuario || null, doc) : doc.usuario || null,
        status,
        estagio: estagioDe(status),
        prazo,
        limite: dataLimite(doc.dataCriacao, prazo.dias),
        respostas: (doc.historico || []).length,
        novidades: novidadesDoProtocolo(doc),
        privada: Boolean(doc.privada),
        podeMudarSigilo: tipo === 'denuncia',
        recurso: montarRecurso(doc, tipo === 'denuncia' && Boolean(doc.privada)),
        imagemPrincipal: doc.imagens && doc.imagens.length > 0 ? doc.imagens[0] : null,
        numero: numeroDoProtocolo(doc, tipo),
        linkProtocolo: `/protocolos/${tipo}/${doc._id}`,
        linkPost: `${eixo.rotaDetalhes}/${doc._id}`
    };
}

// Monta o filtro do Mongo a partir da busca textual.
function filtroDeBusca(termo) {
    if (!termo) return {};

    const expressao = new RegExp(escaparRegex(termo), 'i');
    return {
        $or: [
            { titulo: expressao },
            { descricao: expressao },
            { localizacao: expressao },
            { tipoOcorrencia: expressao }
        ]
    };
}

/*
 * Consulta os protocolos do painel. Usada pela página e pela busca em tempo
 * real, para as duas nunca divergirem.
 */
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
            protocolos: await consultarProtocolos({ termo, tipoFiltro })
        });
    } catch (err) {
        console.error('Erro na busca do painel:', err);
        res.status(500).send('');
    }
});

// --- PAINEL: visão geral + filtros + busca ---
router.get('/painel', isAdmin, async (req, res) => {
    try {
        const busca = buscaSchema.safeParse(req.query);
        const termo = busca.success ? busca.data.q : '';

        const tipoFiltro = eixoValido(req.query.tipo) ? req.query.tipo : 'todos';
        const statusFiltro = LISTA_ESTAGIOS.includes(req.query.status) ? req.query.status : 'todos';

        const todos = await consultarProtocolos({ termo, tipoFiltro });

        // A contagem por estágio reflete o filtro de tipo e a busca, para o
        // admin conseguir medir "quantas denúncias novas sobre queimada existem".
        const resumo = LISTA_ESTAGIOS.map((chave) => {
            const estagio = estagioDe(chave);
            return {
                ...estagio,
                total: todos.filter((p) => p.status === chave).length,
                ativo: statusFiltro === chave,
                link: `/admin/painel?tipo=${tipoFiltro}&status=${encodeURIComponent(chave)}${termo ? '&q=' + encodeURIComponent(termo) : ''}`
            };
        });

        const protocolos = statusFiltro === 'todos' ? todos : todos.filter((p) => p.status === statusFiltro);

        res.render('admin/painel', {
            protocolos,
            resumo,
            totalGeral: todos.length,
            termo,
            tipoFiltro,
            statusFiltro,
            estagios: LISTA_ESTAGIOS.map((chave) => estagioDe(chave)),
            eixos: Object.values(EIXOS_COM_PROTOCOLO)
        });
    } catch (err) {
        console.error('Erro no painel administrativo:', err);
        req.flash('error_msg', 'Erro ao carregar o painel.');
        res.redirect('/admin');
    }
});

// --- ALTERAÇÃO DE ESTÁGIO ---
// Usada tanto pelo painel quanto pelos hubs e pela linha do tempo.
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

        // Prazo ajustado pela gestão substitui o padrão do tipo de demanda.
        if (prazoDias !== null) {
            atualizacao.prazoDias = prazoDias;
            atualizacao.prazoAjustado = true;
        }

        const { $push, ...camposDiretos } = atualizacao;
        await Modelo.findByIdAndUpdate(id, { $set: camposDiretos, $push });

        // O cidadão é avisado por e-mail; se o envio falhar, a mudança de
        // estágio continua valendo — o aviso é um extra, não parte da ação.
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

// --- SIGILO DA DENÚNCIA ---
// A gestão decide, caso a caso, se uma denúncia fica restrita ou vai ao hub
// público. O padrão continua sendo sigilosa, menos para foco de incêndio.
router.post('/protocolo/denuncia/:id/sigilo', isAdmin, async (req, res) => {
    const { id } = req.params;
    const voltarPara = req.get('referer') || '/admin/painel';

    if (!mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Denúncia não encontrada.');
        return res.redirect('/admin/painel');
    }

    const deveSerPrivada = req.body.privada === '1';

    try {
        const Modelo = modeloDo('denuncia');
        const doc = await Modelo.findById(id).lean();

        if (!doc) {
            req.flash('error_msg', 'Denúncia não encontrada.');
            return res.redirect('/admin/painel');
        }

        await Modelo.findByIdAndUpdate(id, {
            $set: { privada: deveSerPrivada },
            $push: {
                historico: {
                    autor: req.user._id,
                    papel: 'admin',
                    texto: deveSerPrivada
                        ? 'A gestão marcou esta denúncia como sigilosa: ela deixa de aparecer no hub público.'
                        : 'A gestão liberou esta denúncia para o hub público.',
                    createdAt: new Date()
                }
            }
        });

        req.flash('success_msg', deveSerPrivada ? 'Denúncia marcada como sigilosa.' : 'Denúncia liberada para o hub público.');
        res.redirect(voltarPara);
    } catch (err) {
        console.error('Erro ao alterar o sigilo da denúncia:', err);
        req.flash('error_msg', 'Erro ao alterar o sigilo da denúncia.');
        res.redirect(voltarPara);
    }
});

// --- RESPOSTA AO RECURSO ---
// A gestão avalia o argumento do cidadão e decide se a demanda é pertinente.
// Recurso deferido devolve o protocolo para atendimento; indeferido mantém o
// arquivamento. Nos dois casos fica registrado no histórico.
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

        // Recurso aceito reabre o atendimento; recusado mantém o arquivamento.
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
