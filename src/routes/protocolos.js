/*
 * Protocolos de atendimento — linha do tempo compartilhada entre o cidadão que
 * abriu a demanda e a gestão municipal.
 *
 * Vale para Gestão de Melhorias e Denúncias Sigilosas. A thread é privada:
 * só o autor do post e administradores acessam.
 */
import express from 'express';
import mongoose from 'mongoose';

import '../models/categories.js';
import '../models/denuncias.js';

import isUser from '../helpers/isUser.js';
import { notificarRespostaDaGestao } from '../helpers/email.js';
import {
    EIXOS_COM_PROTOCOLO,
    eixoValido,
    estagioDe,
    normalizarStatus,
    prazoDoProtocolo,
    dataLimite,
    numeroDoProtocolo,
    novidadesDoProtocolo,
    podeMexerNaMensagem,
    ehRegistroDeEstagio,
    anonimizarAutor,
    ehDenunciaSigilosa,
    statusModeracaoDe,
    montarComprovanteEmail,
    ORGAOS_ENCAMINHAMENTO,
    montarRecurso,
    LISTA_ESTAGIOS
} from '../helpers/protocolo.js';
import {
    respostaProtocoloSchema,
    normalizarMidias,
    primeiraMensagem,
    buscaSchema,
    escaparRegex,
    recursoSchema,
    normalizarAnexo,
    nomeDeArquivoSeguro
} from '../helpers/validators.js';

const router = express.Router();

const modeloDo = (tipo) => mongoose.model(EIXOS_COM_PROTOCOLO[tipo].model);
const ehAdmin = (user) => Boolean(user && user.areAdmin);

async function carregarProtocolo(req, res, next) {
    const { tipo, id } = req.params;

    if (!eixoValido(tipo) || !mongoose.Types.ObjectId.isValid(id)) {
        req.flash('error_msg', 'Protocolo não encontrado.');
        return res.redirect('/protocolos');
    }

    try {
        const doc = await modeloDo(tipo)
            .findById(id)
            .populate('usuario', 'name profileImage profession areAdmin')
            .populate('historico.autor', 'name profileImage profession areAdmin')
            .lean();

        if (!doc) {
            req.flash('error_msg', 'Protocolo não encontrado.');
            return res.redirect('/protocolos');
        }

        const autorId = doc.usuario?._id ? String(doc.usuario._id) : null;
        const eDono = Boolean(req.user && autorId && autorId === String(req.user._id));

        if (!eDono && !ehAdmin(req.user)) {
            req.flash('error_msg', 'Este acompanhamento é restrito ao autor e à gestão municipal.');
            return res.redirect('/protocolos');
        }

        req.protocolo = { doc, tipo, eDono, eAdmin: ehAdmin(req.user) };
        next();
    } catch (err) {
        console.error('Erro ao carregar protocolo:', err);
        req.flash('error_msg', 'Erro interno ao carregar o protocolo.');
        res.redirect('/protocolos');
    }
}

// Monta os dados que a linha do tempo precisa, já com estágio, moderação, comprovante e prazo resolvidos.
function montarProtocolo(doc, tipo, usuario = null) {
    const eixo = EIXOS_COM_PROTOCOLO[tipo];
    const status = normalizarStatus(doc.status);
    const prazo = prazoDoProtocolo(doc, tipo);
    const moderacao = statusModeracaoDe(doc);
    const comprovante = montarComprovanteEmail(doc, tipo);

    const sigilosa = Boolean(doc.isConfidential) || (tipo === 'denuncia' && ehDenunciaSigilosa(doc));

    return {
        ...doc,
        tipo,
        eixo,
        status,
        estagio: estagioDe(status),
        moderacao,
        comprovante,
        prazo,
        limite: dataLimite(doc.dataCriacao, prazo.dias),
        numero: numeroDoProtocolo(doc, tipo),
        linkPost: `${eixo.rotaDetalhes}/${doc._id}`,
        novidades: novidadesDoProtocolo(doc),
        privada: Boolean(doc.privada),
        sigilosa,
        recurso: montarRecurso(doc, sigilosa),
        usuario: sigilosa ? anonimizarAutor(doc.usuario, doc) : doc.usuario,
        historico: (doc.historico || []).map((item) => {
            const minha = podeMexerNaMensagem(item, usuario);
            const registroDeEstagio = ehRegistroDeEstagio(item);
            const autorReal = item.autor || { name: 'Usuário indisponível', profileImage: '/img/guest.webp' };

            return {
                ...item,
                autor: sigilosa && item.papel === 'cidadao' ? anonimizarAutor(autorReal, doc) : autorReal,
                ehAdmin: item.papel === 'admin',
                podeEditar: minha,
                podeExcluir: minha && !registroDeEstagio,
                registroDeEstagio
            };
        })
    };
}

async function marcarComoLido(tipo, doc, { eDono, eAdmin }) {
    const campos = {};
    if (eDono) campos.vistoPeloAutorEm = new Date();
    if (eAdmin && !eDono) campos.vistoPelaGestaoEm = new Date();

    if (Object.keys(campos).length === 0) return;

    try {
        await modeloDo(tipo).updateOne({ _id: doc._id }, { $set: campos });
    } catch (err) {
        console.error('Erro ao marcar protocolo como lido:', err);
    }
}

async function protocolosDoUsuario(req, termo) {
    const filtro = { usuario: req.user._id };

    if (termo) {
        const expressao = new RegExp(escaparRegex(termo), 'i');
        filtro.$or = [
            { titulo: expressao },
            { descricao: expressao },
            { localizacao: expressao },
            { tipoOcorrencia: expressao }
        ];
    }

    const [chamados, denuncias] = await Promise.all([
        modeloDo('melhoria').find(filtro).sort({ dataCriacao: -1 }).limit(60).lean(),
        modeloDo('denuncia').find(filtro).sort({ dataCriacao: -1 }).limit(60).lean()
    ]);

    return [
        ...chamados.map((d) => montarProtocolo(d, 'melhoria', req.user)),
        ...denuncias.map((d) => montarProtocolo(d, 'denuncia', req.user))
    ].sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));
}

// --- BUSCA EM TEMPO REAL (devolve só as linhas da lista) ---
router.get('/buscar', isUser, async (req, res) => {
    try {
        const validacao = buscaSchema.safeParse(req.query);
        const termo = validacao.success ? validacao.data.q : '';

        res.render('partials/_linhas_protocolos', {
            layout: false,
            protocolos: await protocolosDoUsuario(req, termo)
        });
    } catch (err) {
        console.error('Erro na busca de protocolos:', err);
        res.status(500).send('');
    }
});

// --- LISTA DE PROTOCOLOS DO USUÁRIO ---
router.get('/', isUser, async (req, res) => {
    try {
        const validacao = buscaSchema.safeParse(req.query);
        const termo = validacao.success ? validacao.data.q : '';

        const protocolos = await protocolosDoUsuario(req, termo);

        const resumo = LISTA_ESTAGIOS.map((chave) => ({
            ...estagioDe(chave),
            total: protocolos.filter((p) => p.status === chave).length
        }));

        res.render('protocolos/lista', {
            protocolos,
            resumo,
            termo,
            total: protocolos.length,
            filtrosEstagio: LISTA_ESTAGIOS.map((chave) => estagioDe(chave)),
            filtrosTipo: Object.values(EIXOS_COM_PROTOCOLO)
        });
    } catch (err) {
        console.error('Erro ao listar protocolos:', err);
        req.flash('error_msg', 'Erro ao carregar seus protocolos.');
        res.redirect('/');
    }
});

// --- LINHA DO TEMPO DE UM PROTOCOLO ---
router.get('/:tipo/:id', isUser, carregarProtocolo, async (req, res) => {
    const { doc, tipo, eDono, eAdmin } = req.protocolo;

    const protocolo = montarProtocolo(doc, tipo, req.user);

    await marcarComoLido(tipo, doc, { eDono, eAdmin });

    res.render('protocolos/timeline', {
        protocolo,
        eDono,
        eAdmin,
        estagios: LISTA_ESTAGIOS.map((chave) => estagioDe(chave)),
        orgaosEncaminhamento: ORGAOS_ENCAMINHAMENTO
    });
});

// --- RESPOSTA DO CIDADÃO (com até uma imagem) ---
router.post('/:tipo/:id/responder', isUser, carregarProtocolo, async (req, res) => {
    const { doc, tipo, eDono, eAdmin } = req.protocolo;
    const destino = `/protocolos/${tipo}/${doc._id}`;

    const validacao = respostaProtocoloSchema.safeParse(req.body);

    if (!validacao.success) {
        req.flash('error_msg', primeiraMensagem(validacao.error));
        return res.redirect(destino);
    }

    const [imagem] = normalizarMidias(req.body['imagem_url'] || req.body.imagem_url, 1);

    try {
        await modeloDo(tipo).findByIdAndUpdate(doc._id, {
            $push: {
                historico: {
                    autor: req.user._id,
                    papel: eAdmin && !eDono ? 'admin' : 'cidadao',
                    texto: validacao.data.texto,
                    imagem: imagem || null,
                    createdAt: new Date()
                }
            }
        });

        if (eAdmin && !eDono) {
            const autor = await mongoose
                .model('users')
                .findById(doc.usuario?._id || doc.usuario)
                .select('email')
                .lean();

            notificarRespostaDaGestao({
                destinatario: autor?.email,
                protocolo: {
                    tipo,
                    id: String(doc._id),
                    numero: numeroDoProtocolo(doc, tipo),
                    titulo: doc.titulo,
                    estagio: normalizarStatus(doc.status)
                },
                mensagem: validacao.data.texto,
                sigilosa: tipo === 'denuncia' && ehDenunciaSigilosa(doc)
            }).catch((err) => console.error('Falha ao avisar resposta da gestão:', err.message));
        }

        req.flash('success_msg', 'Mensagem registrada no protocolo.');
        res.redirect(destino);
    } catch (err) {
        console.error('Erro ao responder protocolo:', err);
        req.flash('error_msg', 'Erro ao registrar a mensagem.');
        res.redirect(destino);
    }
});

function encontrarMensagem(doc, msgId, usuario) {
    if (!mongoose.Types.ObjectId.isValid(msgId)) {
        return { erro: 'Mensagem não encontrada.' };
    }

    const mensagem = (doc.historico || []).find((item) => String(item._id) === String(msgId));

    if (!mensagem) {
        return { erro: 'Mensagem não encontrada.' };
    }

    if (!podeMexerNaMensagem(mensagem, usuario)) {
        return { erro: 'Só quem escreveu a mensagem pode alterá-la.' };
    }

    return { mensagem };
}

// --- EDIÇÃO DE UMA MENSAGEM ---
router.post('/:tipo/:id/mensagem/:msgId/editar', isUser, carregarProtocolo, async (req, res) => {
    const { doc, tipo } = req.protocolo;
    const destino = `/protocolos/${tipo}/${doc._id}`;

    const { mensagem, erro } = encontrarMensagem(doc, req.params.msgId, req.user);

    if (erro) {
        req.flash('error_msg', erro);
        return res.redirect(destino);
    }

    const validacao = respostaProtocoloSchema.safeParse(req.body);

    if (!validacao.success) {
        req.flash('error_msg', primeiraMensagem(validacao.error));
        return res.redirect(destino);
    }

    const [imagemNova] = normalizarMidias(req.body['imagem_url'] || req.body.imagem_url, 1);
    const removerImagem = req.body.remover_imagem === '1';
    const imagem = imagemNova || (removerImagem ? null : mensagem.imagem || null);

    try {
        await modeloDo(tipo).updateOne(
            { _id: doc._id, 'historico._id': mensagem._id },
            {
                $set: {
                    'historico.$.texto': validacao.data.texto,
                    'historico.$.imagem': imagem,
                    'historico.$.editadaEm': new Date()
                }
            }
        );

        req.flash('success_msg', 'Mensagem atualizada.');
        res.redirect(destino);
    } catch (err) {
        console.error('Erro ao editar mensagem do protocolo:', err);
        req.flash('error_msg', 'Erro ao atualizar a mensagem.');
        res.redirect(destino);
    }
});

// --- EXCLUSÃO DE UMA MENSAGEM ---
router.post('/:tipo/:id/mensagem/:msgId/excluir', isUser, carregarProtocolo, async (req, res) => {
    const { doc, tipo } = req.protocolo;
    const destino = `/protocolos/${tipo}/${doc._id}`;

    const { mensagem, erro } = encontrarMensagem(doc, req.params.msgId, req.user);

    if (erro) {
        req.flash('error_msg', erro);
        return res.redirect(destino);
    }

    if (ehRegistroDeEstagio(mensagem)) {
        req.flash('error_msg', 'Registros de mudança de estágio fazem parte do histórico e não podem ser excluídos.');
        return res.redirect(destino);
    }

    try {
        await modeloDo(tipo).updateOne(
            { _id: doc._id },
            { $pull: { historico: { _id: mensagem._id } } }
        );

        req.flash('success_msg', 'Mensagem excluída.');
        res.redirect(destino);
    } catch (err) {
        console.error('Erro ao excluir mensagem do protocolo:', err);
        req.flash('error_msg', 'Erro ao excluir a mensagem.');
        res.redirect(destino);
    }
});

// --- RECURSO CONTRA ARQUIVAMENTO ---
router.post('/:tipo/:id/recurso', isUser, carregarProtocolo, async (req, res) => {
    const { doc, tipo, eDono } = req.protocolo;
    const destino = `/protocolos/${tipo}/${doc._id}`;

    if (!eDono) {
        req.flash('error_msg', 'Só quem abriu o protocolo pode recorrer.');
        return res.redirect(destino);
    }

    if (normalizarStatus(doc.status) !== 'Improcedente') {
        req.flash('error_msg', 'O recurso só existe para protocolo marcado como improcedente.');
        return res.redirect(destino);
    }

    if (doc.recurso && doc.recurso.criadoEm) {
        req.flash('error_msg', 'Este protocolo já teve um recurso registrado.');
        return res.redirect(destino);
    }

    const validacao = recursoSchema.safeParse(req.body);

    if (!validacao.success) {
        req.flash('error_msg', primeiraMensagem(validacao.error));
        return res.redirect(destino);
    }

    const arquivo = normalizarAnexo(req.body.arquivo_url);
    const nomeArquivo = arquivo ? nomeDeArquivoSeguro(req.body.arquivo_nome) : null;

    try {
        await modeloDo(tipo).updateOne(
            { _id: doc._id },
            {
                $set: {
                    recurso: {
                        texto: validacao.data.texto,
                        arquivo,
                        nomeArquivo,
                        criadoEm: new Date(),
                        decisao: 'pendente'
                    }
                },
                $push: {
                    historico: {
                        autor: req.user._id,
                        papel: 'cidadao',
                        texto: 'Recurso apresentado contra o arquivamento do protocolo.',
                        createdAt: new Date()
                    }
                }
            }
        );

        req.flash('success_msg', 'Recurso enviado. A gestão vai analisar e responder.');
        res.redirect(destino);
    } catch (err) {
        console.error('Erro ao registrar recurso:', err);
        req.flash('error_msg', 'Erro ao enviar o recurso.');
        res.redirect(destino);
    }
});

export default router;
