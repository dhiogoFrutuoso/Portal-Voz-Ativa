/*
 * Protocolos de atendimento — linha do tempo compartilhada entre o cidadão que
 * abriu a demanda e a gestão municipal.
 *
 * Vale para Gestão de Melhorias e Denúncias Sigilosas. A thread é privada:
 * só o autor do post e administradores acessam. O post em si segue público
 * no hub; o que fica restrito é a conversa do atendimento.
 */
import express from 'express';
import mongoose from 'mongoose';

import '../models/categories.js';
import '../models/denuncias.js';

import isUser from '../helpers/isUser.js';
import {
    EIXOS_COM_PROTOCOLO,
    eixoValido,
    estagioDe,
    normalizarStatus,
    prazoDoProtocolo,
    dataLimite,
    numeroDoProtocolo,
    LISTA_ESTAGIOS
} from '../helpers/protocolo.js';
import {
    respostaProtocoloSchema,
    statusProtocoloSchema,
    normalizarMidias,
    primeiraMensagem
} from '../helpers/validators.js';

const router = express.Router();

const modeloDo = (tipo) => mongoose.model(EIXOS_COM_PROTOCOLO[tipo].model);
const ehAdmin = (user) => Boolean(user && user.areAdmin);

/*
 * Carrega o protocolo e decide se quem pediu pode vê-lo. Concentrar isso num
 * único middleware evita que uma rota nova esqueça a checagem de permissão.
 */
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

// Monta os dados que a linha do tempo precisa, já com estágio e prazo resolvidos.
function montarProtocolo(doc, tipo) {
    const eixo = EIXOS_COM_PROTOCOLO[tipo];
    const status = normalizarStatus(doc.status);
    const prazo = prazoDoProtocolo(doc, tipo);

    return {
        ...doc,
        tipo,
        eixo,
        status,
        estagio: estagioDe(status),
        prazo,
        limite: dataLimite(doc.dataCriacao, prazo.dias),
        numero: numeroDoProtocolo(doc, tipo),
        linkPost: `${eixo.rotaDetalhes}/${doc._id}`,
        historico: (doc.historico || []).map((item) => ({
            ...item,
            autor: item.autor || { name: 'Usuário indisponível', profileImage: '/img/guest.webp' },
            ehAdmin: item.papel === 'admin'
        }))
    };
}

// --- LISTA DE PROTOCOLOS DO USUÁRIO ---
router.get('/', isUser, async (req, res) => {
    try {
        const usuarioId = req.user._id;

        const [chamados, denuncias] = await Promise.all([
            modeloDo('melhoria').find({ usuario: usuarioId }).sort({ dataCriacao: -1 }).lean(),
            modeloDo('denuncia').find({ usuario: usuarioId }).sort({ dataCriacao: -1 }).lean()
        ]);

        const protocolos = [
            ...chamados.map((d) => montarProtocolo(d, 'melhoria')),
            ...denuncias.map((d) => montarProtocolo(d, 'denuncia'))
        ].sort((a, b) => new Date(b.dataCriacao) - new Date(a.dataCriacao));

        const resumo = LISTA_ESTAGIOS.map((chave) => ({
            ...estagioDe(chave),
            total: protocolos.filter((p) => p.status === chave).length
        }));

        res.render('protocolos/lista', { protocolos, resumo });
    } catch (err) {
        console.error('Erro ao listar protocolos:', err);
        req.flash('error_msg', 'Erro ao carregar seus protocolos.');
        res.redirect('/');
    }
});

// --- LINHA DO TEMPO DE UM PROTOCOLO ---
router.get('/:tipo/:id', isUser, carregarProtocolo, (req, res) => {
    const { doc, tipo, eDono, eAdmin } = req.protocolo;

    res.render('protocolos/timeline', {
        protocolo: montarProtocolo(doc, tipo),
        eDono,
        eAdmin,
        estagios: LISTA_ESTAGIOS.map((chave) => estagioDe(chave))
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

    // Uma imagem por resposta, e só do nosso Cloudinary.
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

        req.flash('success_msg', 'Mensagem registrada no protocolo.');
        res.redirect(destino);
    } catch (err) {
        console.error('Erro ao responder protocolo:', err);
        req.flash('error_msg', 'Erro ao registrar a mensagem.');
        res.redirect(destino);
    }
});

export default router;
