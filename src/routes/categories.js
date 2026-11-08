import { evidenciaPublicacao } from '../helpers/governanca.js';
import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import 'dotenv/config';
import { limitarRequisicoes } from '../config/rate-limit.js';

// Rate Limiter
const Limiter = limitarRequisicoes('publicacoes', {
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 30,
  message: "Muitas tentativas de registro, tente novamente mais tarde.",
});

// Importando modelos e helpers
import '../models/categories.js'; 
import '../models/denuncias.js';
import '../models/vitrine.js';

import isUser from '../helpers/isUser.js';
import {
    chamadoSchema,
    denunciaSchema,
    vitrineSchema,
    comentarioSchema,
    normalizarMidias,
    normalizarVideo,
    primeiraMensagem,
    buscaSchema,
    escaparRegex
} from '../helpers/validators.js';
import {
    estagioDe,
    normalizarStatus,
    prazoDoProtocolo,
    dataLimite,
    LISTA_ESTAGIOS,
    TIPOS_OCORRENCIA,
    TIPOS_OCORRENCIA_PILOTO,
    CATEGORIAS_MELHORIA_PILOTO,
    BAIRROS_CARIUS,
    filtroDeSigilo,
    filtroModeracaoPublica,
    podeVerDenuncia,
    podeVerChamado,
    statusModeracaoDe,
    montarComprovanteEmail,
    extrairBairro,
    nasceSigilosa,
    anonimizarAutor,
    ehDenunciaSigilosa
} from '../helpers/protocolo.js';

/*
 * Junta filtros do Mongo sem perder nenhum.
 */
function combinarFiltros(...filtros) {
    const usados = filtros.filter((f) => f && Object.keys(f).length > 0);

    if (usados.length === 0) return {};
    if (usados.length === 1) return usados[0];

    return { $and: usados };
}

/*
 * Busca dos hubs: o termo vira expressão regular no Mongo, então é validado
 * (tamanho e tags) e escapado antes de chegar à query.
 */
function filtroDoHub(query, campos) {
    const validacao = buscaSchema.safeParse(query);
    const termo = validacao.success ? validacao.data.q : '';

    if (!termo) return { termo: '', filtro: {} };

    const expressao = new RegExp(escaparRegex(termo), 'i');
    return { termo, filtro: { $or: campos.map((campo) => ({ [campo]: expressao })) } };
}

// Dados de estágio e moderação que os cards do hub exibem.
const comEstagio = (doc) => {
    const status = normalizarStatus(doc.status);
    return {
        ...doc,
        status,
        estagio: estagioDe(status),
        moderacaoInfo: statusModeracaoDe(doc)
    };
};

const estagiosParaSelect = () => LISTA_ESTAGIOS.map((chave) => estagioDe(chave));

// Valores dos botões de filtro dos hubs. São os mesmos das telas de criação.
const CATEGORIAS_VITRINE = [
    'Serviços Gerais',
    'Alimentação',
    'Construção Civil',
    'Educação/Aulas',
    'Artesanato',
    'Outros'
];

// Projeção enxuta para listagens de hub: preserva a contagem de comentários
// (comentarios.length) e curtidas sem trafegar histórico, recurso ou textos longos.
const PROJECAO_HUB = '-historico -recurso -comentarios.texto -comentarios.usuario -comentarios.createdAt -comentarios.editadoEm';

/*
 * Alterna curtida de forma atômica no MongoDB ($pull / $addToSet), evitando
 * perda de apoios concorrentes causada por read-modify-write em memória.
 */
async function alternarCurtida(Modelo, postId, usuarioId) {
    const atual = await Modelo.findById(postId).select('curtidas').lean();
    if (!atual) return null;

    const jaTinha = (atual.curtidas || []).some((id) => String(id) === String(usuarioId));
    const operacao = jaTinha
        ? { $pull: { curtidas: usuarioId } }
        : { $addToSet: { curtidas: usuarioId } };

    const atualizado = await Modelo.findByIdAndUpdate(postId, operacao, { new: true })
        .select('curtidas')
        .lean();

    if (!atualizado) return null;
    return {
        curtidas: (atualizado.curtidas || []).length,
        jaCurtiu: !jaTinha
    };
}

/*
 * Busca dos hubs: devolve só o pedaço de HTML com os cards, para a página
 * trocar a lista sem recarregar.
 */
function montarBuscaDeHub({ Modelo, campos, colecao, partial, preparar, tipoProtocolo = null, aplicarSigilo = false, aplicarModeracao = false }) {
    return async (req, res) => {
        try {
            const { filtro } = filtroDoHub(req.query, campos);
            const recorteSigilo = aplicarSigilo ? filtroDeSigilo() : {};
            const recorteModeracao = aplicarModeracao ? filtroModeracaoPublica() : {};

            const docs = await Modelo.find(combinarFiltros(recorteSigilo, recorteModeracao, filtro))
                .select(PROJECAO_HUB)
                .populate('usuario', 'name profileImage profession')
                .sort({ dataCriacao: -1 })
                .limit(60)
                .lean();

            res.render(`partials/${partial}`, {
                layout: false,
                [colecao]: docs.map((doc) => preparar(doc, req)),
                tipoProtocolo,
                estagios: estagiosParaSelect()
            });
        } catch (err) {
            console.error('Erro na busca do hub:', err);
            res.status(500).send('');
        }
    };
}

// Prepara um chamado/denúncia/anúncio para os cards do hub.
const prepararChamado = (doc, req) => comEstagio({
    ...doc,
    usuario: anonimizarAutor(formatAuthor(doc.usuario), doc),
    jaCurtiu: req.user ? (doc.curtidas || []).some((id) => id.toString() === req.user._id.toString()) : false,
    imagemPrincipal: doc.imagens && doc.imagens.length > 0 ? doc.imagens[0] : null
});

const prepararVitrine = (doc, req) => ({
    ...doc,
    usuario: anonimizarAutor(formatAuthor(doc.usuario), doc),
    curtidas: doc.curtidas || [],
    imagemPrincipal: doc.imagens && doc.imagens.length > 0 ? doc.imagens[0] : null,
    jaCurtiu: req.user ? (doc.curtidas || []).some((id) => id.toString() === req.user._id.toString()) : false
});

const ehPedidoDeFetch = (req) => req.get('x-requested-with') === 'fetch';

// Eixos que têm curtida e comentário, com o model e a rota de cada um.
const EIXOS_INTERACAO = {
    gestao_de_melhorias: { modelo: () => Chamado, hub: '/categories/gestao_de_melhorias/hub' },
    denuncias_sigilosas: { modelo: () => Denuncia, hub: '/categories/denuncias_sigilosas/hub' },
    vitrine_do_trabalhador: { modelo: () => Vitrine, hub: '/categories/vitrine_do_trabalhador/hub' }
};

const eixoDeInteracao = (chave) => EIXOS_INTERACAO[chave] || null;

// Carrega os comentários já formatados (autor anônimo quando for denúncia sigilosa ou relato confidencial).
async function comentariosDoPost(Modelo, id, eixo, usuario = null) {
    const doc = await Modelo.findById(id)
        .populate('comentarios.usuario', 'name profileImage profession')
        .select('comentarios tipoOcorrencia privada titulo usuario isConfidential moderacao')
        .lean();

    if (!doc) return null;
    if (eixo === 'denuncias_sigilosas' && !podeVerDenuncia(doc, usuario)) return null;
    if (eixo === 'gestao_de_melhorias' && !podeVerChamado(doc, usuario)) return null;

    const sigilosa = doc.isConfidential || (eixo === 'denuncias_sigilosas' && ehDenunciaSigilosa(doc));

    return {
        titulo: doc.titulo,
        comentarios: (doc.comentarios || []).map((c) => {
            const autor = c.usuario?._id || c.usuario;
            const meu = Boolean(usuario) && Boolean(autor) && String(autor) === String(usuario._id);
            const ehAdmin = Boolean(usuario && usuario.areAdmin);

            return {
                ...c,
                usuario: sigilosa
                    ? { ...anonimizarAutor(formatAuthor(c.usuario), doc), name: 'Participante anônimo' }
                    : formatAuthor(c.usuario),
                podeEditar: meu,
                podeExcluir: meu || ehAdmin
            };
        })
    };
}

// Dono do post: só ele vê o botão de editar/excluir no detalhe.
const ehDonoDoPost = (req, doc) => {
    const autor = doc?.usuario?._id || doc?.usuario;
    return Boolean(req.user && autor && String(autor) === String(req.user._id));
};

const idValido = (id) => mongoose.Types.ObjectId.isValid(id);

const Chamado = mongoose.model('chamados');
const Denuncia = mongoose.model('denuncias');
const Vitrine = mongoose.model('vitrine');
const router = express.Router();

// Protege o acesso direto a denúncias sigilosas e relatos retidos na moderação prévia
router.use(async (req, res, next) => {
    if (req.path.startsWith('/denuncias_sigilosas/')) {
        const id = req.path.match(/\/([a-f0-9]{24})(?:\/|$)/i)?.[1];
        if (!id) return next();
        try {
            const doc = await Denuncia.findById(id).select('usuario privada tipoOcorrencia moderacao').lean();
            if (!doc || !podeVerDenuncia(doc, req.user)) return res.status(404).send('Publicação não encontrada.');
            return next();
        } catch {
            return res.status(503).send('Não foi possível consultar a publicação.');
        }
    }
    if (req.path.startsWith('/gestao_de_melhorias/')) {
        const id = req.path.match(/\/([a-f0-9]{24})(?:\/|$)/i)?.[1];
        if (!id) return next();
        try {
            const doc = await Chamado.findById(id).select('usuario moderacao').lean();
            if (!doc || !podeVerChamado(doc, req.user)) return res.status(404).send('Publicação não encontrada ou em análise pela moderação.');
            return next();
        } catch {
            return res.status(503).send('Não foi possível consultar a publicação.');
        }
    }
    next();
});

// --- FUNÇÃO AUXILIAR PARA FORMATAR USUÁRIO (ANONIMIZAÇÃO ESTILO INSTAGRAM CASO EXCLUÍDO) ---
const formatAuthor = (u) => {
    if (!u) {
        return {
            _id: null,
            name: "Usuário Indisponível",
            profileImage: "/img/guest.webp",
            profession: "Conta Indisponível",
            isDeleted: true
        };
    }
    if (u.anonimo) {
        return u;
    }
    return {
        ...u,
        name: u.name || "Usuário do Voz Ativa",
        profileImage: u.profileImage || "/img/guest.webp",
        profession: u.profession || "Cidadão",
        isDeleted: false
    };
};

const formatComments = (comentarios = []) => {
    return comentarios.map(c => ({
        ...c,
        usuario: formatAuthor(c.usuario)
    }));
};

const upload = multer();

// --- ROTAS GERAIS ---

router.get('/', (req, res) => { 
    res.render('categories/categories');
});

// --- GESTÃO DE MELHORIAS ---

router.get('/gestao_de_melhorias/saiba-mais', (req, res) => {
    res.render('categories/gestao_de_melhorias/saiba-mais');
});

router.get('/gestao_de_melhorias/abrir-chamado', isUser, (req, res) => {
    res.render('categories/gestao_de_melhorias/abrir-chamado', {
        categoriasPiloto: CATEGORIAS_MELHORIA_PILOTO,
        bairrosCarius: BAIRROS_CARIUS
    });
});

router.post('/gestao_de_melhorias/abrir-chamado', isUser, Limiter, upload.none(), evidenciaPublicacao, async (req, res) => {
    try {
        const validacao = chamadoSchema.safeParse(req.body);

        if (!validacao.success) {
            req.flash('error_msg', primeiraMensagem(validacao.error));
            return res.redirect('/categories/gestao_de_melhorias/abrir-chamado');
        }

        const nomesImagens = normalizarMidias(
            req.body['imagens[]'] || req.body['imagens_urls[]'] || req.body.imagens
        );

        const bairroResolvido = validacao.data.bairro || extrairBairro(validacao.data);

        const novoChamado = new Chamado({
            ...req.evidencia,
            ...validacao.data,
            bairro: bairroResolvido,
            imagens: nomesImagens,
            usuario: req.user._id,
            moderacao: {
                status: 'pendente',
                trilha: [{
                    acao: 'retido',
                    detalhe: 'Relato recebido e retido na fila de moderação prévia do piloto.',
                    createdAt: new Date()
                }]
            }
        });

        await novoChamado.save();

        const comprovante = montarComprovanteEmail(novoChamado, 'melhoria');
        req.flash('comprovante_protocolo', JSON.stringify(comprovante));
        req.flash('success_msg', `Melhoria registrada sob o protocolo ${comprovante.numero}! Seu relato aguarda revisão da moderação municipal antes de ir ao feed público.`);
        res.redirect('/categories/gestao_de_melhorias/hub');
    } catch (err) {
        console.error("Erro ao salvar chamado:", err);
        req.flash('error_msg', 'Erro ao salvar o chamado. Tente novamente.');
        res.redirect('/categories/gestao_de_melhorias/abrir-chamado');
    }
});

router.get(
    '/gestao_de_melhorias/hub/buscar',
    montarBuscaDeHub({
        Modelo: Chamado,
        campos: ['titulo', 'descricao', 'localizacao', 'categoria', 'bairro'],
        colecao: 'chamados',
        partial: '_cards_melhorias',
        preparar: prepararChamado,
        tipoProtocolo: 'melhoria',
        aplicarModeracao: true
    })
);

router.get('/gestao_de_melhorias/hub', async (req, res) => {
    try {
        const { termo, filtro } = filtroDoHub(req.query, ['titulo', 'descricao', 'localizacao', 'categoria', 'bairro']);

        // Feed público exibe apenas conteúdos formalmente aprovados pela moderação
        const chamadosDocs = await Chamado.find(combinarFiltros(filtroModeracaoPublica(), filtro))
            .select(PROJECAO_HUB)
            .populate('usuario', 'name profileImage profession')
            .sort({ dataCriacao: -1 })
            .limit(60)
            .lean();

        const chamados = chamadosDocs.map(doc => prepararChamado(doc, req));

        res.render('categories/gestao_de_melhorias/hub', {
            chamados,
            termo,
            total: chamados.length,
            estagios: estagiosParaSelect(),
            filtrosEstagio: estagiosParaSelect(),
            categoriasPiloto: CATEGORIAS_MELHORIA_PILOTO,
            tipoProtocolo: 'melhoria'
        });
    } catch (err) {
        console.error("Erro no Hub:", err);
        res.redirect('/');
    }
});

router.get('/gestao_de_melhorias/detalhes/:id', async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            req.flash("error_msg", "Este chamado não foi encontrado.");
            return res.redirect("/categories/gestao_de_melhorias/hub");
        }

        const chamadoDoc = await Chamado.findById(req.params.id)
            .populate('usuario')
            .populate('comentarios.usuario')
            .lean();

        if (!chamadoDoc || !podeVerChamado(chamadoDoc, req.user)) {
            req.flash("error_msg", "Este chamado está em análise pela moderação ou restrito ao autor.");
            return res.redirect("/categories/gestao_de_melhorias/hub");
        }

        const curtidas = chamadoDoc.curtidas || [];
        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        const eDono = ehDonoDoPost(req, chamadoDoc);
        const status = normalizarStatus(chamadoDoc.status);
        const moderacao = statusModeracaoDe(chamadoDoc);

        res.render("categories/gestao_de_melhorias/detalhes", {
            chamadoDoc: {
                ...chamadoDoc,
                usuario: anonimizarAutor(formatAuthor(chamadoDoc.usuario), chamadoDoc),
                curtidas: curtidas,
                comentarios: formatComments(chamadoDoc.comentarios),
                imagens: chamadoDoc.imagens || [],
                status,
                estagio: estagioDe(status),
                moderacao,
                prazo: prazoDoProtocolo(chamadoDoc, 'melhoria'),
                limite: dataLimite(chamadoDoc.dataCriacao, prazoDoProtocolo(chamadoDoc, 'melhoria').dias)
            },
            comprovante: montarComprovanteEmail(chamadoDoc, 'melhoria'),
            moderacao,
            jaCurtiu,
            eDono,
            podeAcompanhar: eDono || Boolean(req.user && req.user.areAdmin),
            linkProtocolo: `/protocolos/melhoria/${chamadoDoc._id}`,
            linkEditar: `/categories/gestao_de_melhorias/editar/${chamadoDoc._id}`
        });

    } catch (err) {
        console.error("ERRO NO CONSOLE:", err);
        req.flash("error_msg", "Erro interno ao carregar detalhes");
        res.redirect("/categories/gestao_de_melhorias/hub");
    }
});

router.post('/gestao_de_melhorias/like/:id', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error_msg', 'Você precisa estar logado para apoiar uma melhoria.');
            return res.redirect('/users/login'); 
        }

        if (!idValido(req.params.id)) {
            return res.redirect('/categories/gestao_de_melhorias/hub');
        }

        const resultado = await alternarCurtida(Chamado, req.params.id, req.user._id);
        if (!resultado) return res.redirect('/categories/gestao_de_melhorias/hub');

        res.redirect(req.get('referer') || '/categories/gestao_de_melhorias/hub');

    } catch (err) {
        console.error(err);
        res.redirect('/categories/gestao_de_melhorias/hub');
    }
});

router.post('/gestao_de_melhorias/comentar/:id', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error_msg', 'Você precisa estar logado para comentar.');
            return res.redirect(`/users/login`);
        }

        const validacao = comentarioSchema.safeParse(req.body);
        if (!idValido(req.params.id)) {
            return res.redirect('/categories/gestao_de_melhorias/hub');
        }
        if (!validacao.success) {
            req.flash('error_msg', primeiraMensagem(validacao.error));
            return res.redirect(`/categories/gestao_de_melhorias/detalhes/${req.params.id}`);
        }

        const novoComentario = {
            texto: validacao.data.texto,
            usuario: req.user._id,
            createdAt: new Date()
        };

        await Chamado.findByIdAndUpdate(req.params.id, {
            $push: { comentarios: novoComentario }
        });

        res.redirect(`/categories/gestao_de_melhorias/detalhes/${req.params.id}`);
    } catch (err) {
        console.error("Erro ao comentar:", err);
        res.redirect('/categories/gestao_de_melhorias/hub');
    }
});

// --- DENÚNCIAS SIGILOSAS ---

router.get('/denuncias_sigilosas/saiba-mais', (req, res) => {
    res.render('categories/denuncias_sigilosas/saiba-mais');
});

router.get('/denuncias_sigilosas/abrir-denuncia', isUser, (req, res) => {
    res.render('categories/denuncias_sigilosas/abrir-denuncia', {
        tiposOcorrenciaPiloto: TIPOS_OCORRENCIA_PILOTO,
        bairrosCarius: BAIRROS_CARIUS
    });
});

router.get(
    '/denuncias_sigilosas/hub/buscar',
    montarBuscaDeHub({
        Modelo: Denuncia,
        campos: ['titulo', 'descricao', 'localizacao', 'tipoOcorrencia', 'bairro'],
        colecao: 'denuncias',
        partial: '_cards_denuncias',
        preparar: prepararChamado,
        tipoProtocolo: 'denuncia',
        aplicarSigilo: true
    })
);

router.get('/denuncias_sigilosas/hub', async (req, res) => {
    try {
        const { termo, filtro } = filtroDoHub(req.query, [
            'titulo',
            'descricao',
            'localizacao',
            'tipoOcorrencia',
            'bairro'
        ]);

        // Exibe apenas denúncias públicas E formalmente aprovadas pela moderação
        const denunciasDocs = await Denuncia.find(combinarFiltros(filtroDeSigilo(), filtro))
            .select(PROJECAO_HUB)
            .populate('usuario', 'name profileImage profession')
            .sort({ dataCriacao: -1 })
            .limit(60)
            .lean();

        const denunciasComLike = denunciasDocs.map(denuncia => prepararChamado(denuncia, req));

        res.render('categories/denuncias_sigilosas/hub', {
            denuncias: denunciasComLike,
            termo,
            total: denunciasComLike.length,
            estagios: estagiosParaSelect(),
            filtrosEstagio: estagiosParaSelect(),
            filtrosOcorrencia: TIPOS_OCORRENCIA_PILOTO,
            tipoProtocolo: 'denuncia'
        });
    } catch (err) {
        console.error(err);
        req.flash("error_msg", "Erro ao carregar o painel");
        res.redirect("/");
    }
});

router.post('/denuncias_sigilosas/abrir-denuncia', Limiter, isUser, upload.none(), evidenciaPublicacao, async (req, res) => {
    try {
        const validacao = denunciaSchema.safeParse(req.body);

        if (!validacao.success) {
            req.flash('error_msg', primeiraMensagem(validacao.error));
            return res.redirect('/categories/denuncias_sigilosas/abrir-denuncia');
        }

        const { tipoOcorrencia, bairro, titulo, descricao, localizacao, latitude, longitude } = validacao.data;

        const imagensCloudinary = normalizarMidias(
            req.body['imagens_urls[]'] || req.body.imagens_urls || req.body['imagens[]'] || req.body.imagens, 3
        );

        const bairroResolvido = bairro || extrairBairro(validacao.data);

        const novaDenuncia = new Denuncia({
            ...req.evidencia,
            tipoOcorrencia,
            bairro: bairroResolvido,
            titulo: tipoOcorrencia === 'Outro' && titulo ? titulo : tipoOcorrencia,
            descricao,
            localizacao,
            latitude,
            longitude,
            imagens: imagensCloudinary,
            privada: nasceSigilosa(tipoOcorrencia),
            video: normalizarVideo(req.body.video_url),
            usuario: req.user._id,
            moderacao: {
                status: 'pendente',
                trilha: [{
                    acao: 'retido',
                    detalhe: 'Denúncia recebida e retida na fila de moderação prévia do piloto.',
                    createdAt: new Date()
                }]
            }
        });

        await novaDenuncia.save();

        const comprovante = montarComprovanteEmail(novaDenuncia, 'denuncia');
        req.flash('comprovante_protocolo', JSON.stringify(comprovante));
        req.flash('success_msg', `Denúncia registrada sob o protocolo ${comprovante.numero}! O relato está retido na moderação prévia e visível apenas para você e para a equipe administrativa.`);
        res.redirect('/categories/denuncias_sigilosas/hub');
    } catch (err) {
        console.error("Erro ao salvar denúncia:", err);
        req.flash('error_msg', 'Houve um erro ao processar sua denúncia.');
        res.redirect('/categories/denuncias_sigilosas/abrir-denuncia');
    }
});

router.get('/denuncias_sigilosas/detalhes/:id', async (req, res) => { 
    try {
        if (!idValido(req.params.id)) {
            req.flash("error_msg", "Esta denúncia não foi encontrada.");
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }

        const denuncia = await Denuncia.findById(req.params.id)
            .populate('usuario')
            .populate('comentarios.usuario')
            .lean();

        if (!denuncia) {
            req.flash("error_msg", "Esta denúncia não foi encontrada.");
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }

        if (!podeVerDenuncia(denuncia, req.user)) {
            req.flash("error_msg", "Esta denúncia é sigilosa ou está em moderação: só o autor e a gestão municipal têm acesso.");
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }

        const curtidas = denuncia.curtidas || [];
        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        const eDono = ehDonoDoPost(req, denuncia);
        const status = normalizarStatus(denuncia.status);
        const moderacao = statusModeracaoDe(denuncia);

        res.render("categories/denuncias_sigilosas/detalhes", {
            denuncia: {
                ...denuncia,
                usuario: anonimizarAutor(formatAuthor(denuncia.usuario), denuncia),
                curtidas: curtidas,
                comentarios: formatComments(denuncia.comentarios),
                imagens: denuncia.imagens || [],
                video: denuncia.video || null,
                status,
                estagio: estagioDe(status),
                moderacao,
                prazo: prazoDoProtocolo(denuncia, 'denuncia'),
                limite: dataLimite(denuncia.dataCriacao, prazoDoProtocolo(denuncia, 'denuncia').dias)
            },
            comprovante: montarComprovanteEmail(denuncia, 'denuncia'),
            moderacao,
            jaCurtiu,
            eDono,
            podeAcompanhar: eDono || Boolean(req.user && req.user.areAdmin),
            linkProtocolo: `/protocolos/denuncia/${denuncia._id}`,
            linkEditar: `/categories/denuncias_sigilosas/editar/${denuncia._id}`
        });

    } catch (err) {
        console.error("ERRO NO CONSOLE:", err);
        req.flash("error_msg", "Erro interno ao carregar detalhes");
        res.redirect("/categories/denuncias_sigilosas/hub");
    }
});

router.post('/denuncias_sigilosas/like/:id', async (req, res) => {
    if (!req.user) {
        req.flash("error_msg", "Você precisa estar logado para curtir");
        return res.redirect("/users/login");
    }
    try {
        if (!idValido(req.params.id)) {
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }

        const resultado = await alternarCurtida(Denuncia, req.params.id, req.user._id);
        if (!resultado) return res.redirect("/categories/denuncias_sigilosas/hub");

        res.redirect(req.get('referer') || "/categories/denuncias_sigilosas/hub");
    } catch (err) {
        res.redirect("/categories/denuncias_sigilosas/hub");
    }
});

router.post('/denuncias_sigilosas/comentar/:id', async (req, res) => {
    if (!req.user) {
        req.flash("error_msg", "Você precisa estar logado para comentar.");
        return res.redirect("/users/login");
    }
    try {
        const validacao = comentarioSchema.safeParse(req.body);
        if (!idValido(req.params.id)) {
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }
        if (!validacao.success) {
            req.flash("error_msg", primeiraMensagem(validacao.error));
            return res.redirect(req.get('referer') || "/categories/denuncias_sigilosas/hub");
        }

        const novaCita = {
            usuario: req.user._id,
            texto: validacao.data.texto
        };
        await Denuncia.findByIdAndUpdate(req.params.id, {
            $push: { comentarios: novaCita }
        });
        res.redirect(req.get('referer') || "/categories/denuncias_sigilosas/hub");
    } catch (err) {
        res.redirect("/categories/denuncias_sigilosas/hub");
    }
});

// --- VITRINE DO TRABALHADOR ---

router.get("/vitrine_do_trabalhador/saiba-mais", (req, res) => {
    res.render("categories/vitrine_do_trabalhador/saiba-mais");
});

router.get("/vitrine_do_trabalhador/criar-vitrine", isUser, (req, res) => {
    res.render("categories/vitrine_do_trabalhador/criar-vitrine")
});

// HUB da Vitrine
router.get(
    '/vitrine_do_trabalhador/hub/buscar',
    montarBuscaDeHub({
        Modelo: Vitrine,
        campos: ['titulo', 'descricao', 'localizacao', 'categoria', 'produtos', 'servicos'],
        colecao: 'anuncios',
        partial: '_cards_vitrine',
        preparar: prepararVitrine
    })
);

router.get('/vitrine_do_trabalhador/hub', async (req, res) => {
    try {
        const { termo, filtro } = filtroDoHub(req.query, [
            'titulo',
            'descricao',
            'localizacao',
            'categoria',
            'produtos',
            'servicos'
        ]);

        const anunciosDocs = await Vitrine.find(filtro)
            .select(PROJECAO_HUB)
            .populate('usuario', 'name profileImage profession')
            .sort({ dataCriacao: -1 })
            .limit(60)
            .lean(); 

        const vitrinesCompletas = anunciosDocs.map(anuncio => {
            const curtidasArray = anuncio.curtidas || []; 
            return {
                ...anuncio,
                usuario: anonimizarAutor(formatAuthor(anuncio.usuario), anuncio),
                curtidas: curtidasArray,
                imagemPrincipal: anuncio.imagens && anuncio.imagens.length > 0 ? anuncio.imagens[0] : null,
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            };
        });
            
        res.render('categories/vitrine_do_trabalhador/hub', {
            anuncios: vitrinesCompletas,
            termo,
            total: vitrinesCompletas.length,
            filtrosCategoria: CATEGORIAS_VITRINE
        });
    } catch (err) {
        console.error(err);
        req.flash("error_msg", "Erro ao carregar a Vitrine.");
        res.redirect('/categories');
    }
});

// Detalhes da Vitrine
router.get('/vitrine_do_trabalhador/detalhes/:id', async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            req.flash("error_msg", "Esse anúncio não foi encontrado.");
            return res.redirect("/categories/vitrine_do_trabalhador/hub");
        }

        const vitrineDoc = await Vitrine.findById(req.params.id)
            .populate('usuario')
            .populate('comentarios.usuario')
            .lean();

        if (!vitrineDoc) {
            req.flash("error_msg", "Esse anúncio não foi encontrado.");
            return res.redirect("/categories/vitrine_do_trabalhador/hub");
        }

        const curtidas = vitrineDoc.curtidas || [];
        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        const eDono = ehDonoDoPost(req, vitrineDoc);

        res.render("categories/vitrine_do_trabalhador/detalhes", {
            eDono,
            linkEditar: `/categories/vitrine_do_trabalhador/editar/${vitrineDoc._id}`,
            vitrine: {
                ...vitrineDoc,
                usuario: anonimizarAutor(formatAuthor(vitrineDoc.usuario), vitrineDoc),
                curtidas: curtidas,
                comentarios: formatComments(vitrineDoc.comentarios),
                imagens: vitrineDoc.imagens || [],
                categoriaExibida: vitrineDoc.categoria === 'Outros' ? vitrineDoc.categoria_especificada : vitrineDoc.categoria
            }, 
            jaCurtiu 
        });

    } catch (err) {
        console.error("ERRO NO DETALHE VITRINE:", err);
        req.flash("error_msg", "Erro interno ao carregar detalhes");
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

// Curtir (Like)
router.post('/vitrine_do_trabalhador/curtir/:id', isUser, async (req, res) => {
    try {
        if (!idValido(req.params.id)) {
            return res.redirect("/categories/vitrine_do_trabalhador/hub");
        }

        const resultado = await alternarCurtida(Vitrine, req.params.id, req.user._id);
        if (!resultado) return res.redirect("/categories/vitrine_do_trabalhador/hub");

        res.redirect(req.get('referer') || "/categories/vitrine_do_trabalhador/hub");
    } catch (err) {
        console.error(err);
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

// Comentar
router.post('/vitrine_do_trabalhador/comentar/:id', isUser, async (req, res) => {
    try {
        const validacao = comentarioSchema.safeParse(req.body);
        if (!idValido(req.params.id)) {
            return res.redirect("/categories/vitrine_do_trabalhador/hub");
        }
        if (!validacao.success) {
            req.flash("error_msg", primeiraMensagem(validacao.error));
            return res.redirect(req.get('referer') || "/categories/vitrine_do_trabalhador/hub");
        }

        const novoComentario = {
            usuario: req.user._id,
            texto: validacao.data.texto,
            createdAt: new Date()
        };

        await Vitrine.findByIdAndUpdate(req.params.id, {
            $push: { comentarios: novoComentario }
        });

        res.redirect(req.get('referer') || "/categories/vitrine_do_trabalhador/hub");
    } catch (err) {
        console.error(err);
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

// Criar Anúncio
router.post('/vitrine_do_trabalhador/criar-vitrine', isUser, Limiter, upload.none(), evidenciaPublicacao, async (req, res) => {
    try {
        const validacao = vitrineSchema.safeParse(req.body);

        if (!validacao.success) {
            req.flash("error_msg", primeiraMensagem(validacao.error));
            return res.redirect('/categories/vitrine_do_trabalhador/criar-vitrine');
        }

        const dados = validacao.data;

        const imagensVitrine = normalizarMidias(
            req.body['imagens_urls[]'] || req.body.imagens_urls
        );

        const novoAnuncio = new Vitrine({
            ...req.evidencia,
            titulo: dados.titulo,
            categoria: dados.categoria,
            categoria_especificada: dados.categoria === 'Outros' ? dados.categoria_especificada : null,
            descricao: dados.descricao,
            produtos: dados.produtos,
            servicos: dados.servicos,
            contato: dados.contato,
            localizacao: dados.localizacao,
            latitude: dados.latitude,
            longitude: dados.longitude,
            usuario: req.user._id,
            imagens: imagensVitrine,
            dataCriacao: new Date()
        });

        await novoAnuncio.save();
        
        req.flash("success_msg", "Anúncio publicado com sucesso!");
        res.redirect('/categories/vitrine_do_trabalhador/hub');

    } catch (err) {
        console.error("ERRO NO CADASTRO VITRINE:", err);
        req.flash("error_msg", "Houve um erro interno ao salvar o anúncio.");
        res.redirect('/categories/vitrine_do_trabalhador/hub');
    }
});

/* ------------------------------------------------------------------------
 * Curtir, comentar e listar comentários — genéricos para os três eixos.
 * ---------------------------------------------------------------------- */

router.post('/:eixo/curtida/:id', async (req, res) => {
    const eixo = eixoDeInteracao(req.params.eixo);
    const fetchando = ehPedidoDeFetch(req);

    if (!eixo || !idValido(req.params.id)) {
        if (fetchando) return res.status(400).json({ erro: 'Publicação inválida.' });
        return res.redirect('/categories');
    }

    if (!req.user) {
        if (fetchando) return res.status(401).json({ erro: 'Faça login para apoiar.', login: '/users/login' });
        req.flash('error_msg', 'Você precisa estar logado para apoiar uma publicação.');
        return res.redirect('/users/login');
    }

    try {
        const resultado = await alternarCurtida(eixo.modelo(), req.params.id, req.user._id);

        if (!resultado) {
            if (fetchando) return res.status(404).json({ erro: 'Publicação não encontrada.' });
            return res.redirect(eixo.hub);
        }

        if (fetchando) {
            return res.json(resultado);
        }

        res.redirect(req.get('referer') || eixo.hub);
    } catch (err) {
        console.error('Erro ao curtir:', err);
        if (fetchando) return res.status(500).json({ erro: 'Não foi possível registrar o apoio.' });
        res.redirect(eixo.hub);
    }
});

router.get('/:eixo/comentarios/:id', async (req, res) => {
    const eixo = eixoDeInteracao(req.params.eixo);

    if (!eixo || !idValido(req.params.id)) {
        return res.status(400).send('');
    }

    try {
        const dados = await comentariosDoPost(eixo.modelo(), req.params.id, req.params.eixo, req.user);
        if (!dados) return res.status(404).send('');

        res.render('partials/_comentarios', { layout: false, comentarios: dados.comentarios });
    } catch (err) {
        console.error('Erro ao carregar comentários:', err);
        res.status(500).send('');
    }
});

router.post('/:eixo/comentario/:id', Limiter, async (req, res) => {
    const eixo = eixoDeInteracao(req.params.eixo);
    const fetchando = ehPedidoDeFetch(req);

    if (!eixo || !idValido(req.params.id)) {
        if (fetchando) return res.status(400).json({ erro: 'Publicação inválida.' });
        return res.redirect('/categories');
    }

    if (!req.user) {
        if (fetchando) return res.status(401).json({ erro: 'Faça login para comentar.', login: '/users/login' });
        req.flash('error_msg', 'Você precisa estar logado para comentar.');
        return res.redirect('/users/login');
    }

    const validacao = comentarioSchema.safeParse(req.body);

    if (!validacao.success) {
        if (fetchando) return res.status(400).json({ erro: primeiraMensagem(validacao.error) });
        req.flash('error_msg', primeiraMensagem(validacao.error));
        return res.redirect(req.get('referer') || eixo.hub);
    }

    try {
        await eixo.modelo().findByIdAndUpdate(req.params.id, {
            $push: {
                comentarios: {
                    usuario: req.user._id,
                    texto: validacao.data.texto,
                    createdAt: new Date()
                }
            }
        });

        if (fetchando) {
            const dados = await comentariosDoPost(eixo.modelo(), req.params.id, req.params.eixo, req.user);
            return res.render('partials/_comentarios', {
                layout: false,
                comentarios: dados ? dados.comentarios : []
            });
        }

        res.redirect(req.get('referer') || `${eixo.hub}`);
    } catch (err) {
        console.error('Erro ao comentar:', err);
        if (fetchando) return res.status(500).json({ erro: 'Não foi possível publicar o comentário.' });
        res.redirect(eixo.hub);
    }
});

async function acharComentario(Modelo, id, comentarioId, usuario, { exigirAutoria }) {
    if (!idValido(id) || !idValido(comentarioId)) {
        return { erro: 'Comentário não encontrado.', status: 400 };
    }

    const doc = await Modelo.findById(id).select('comentarios').lean();
    if (!doc) return { erro: 'Publicação não encontrada.', status: 404 };

    const comentario = (doc.comentarios || []).find((c) => String(c._id) === String(comentarioId));
    if (!comentario) return { erro: 'Comentário não encontrado.', status: 404 };

    const autor = comentario.usuario?._id || comentario.usuario;
    const meu = Boolean(autor) && String(autor) === String(usuario._id);
    const ehAdmin = Boolean(usuario.areAdmin);

    if (exigirAutoria ? !meu : !(meu || ehAdmin)) {
        return { erro: 'Você não pode alterar este comentário.', status: 403 };
    }

    return { comentario };
}

router.post('/:eixo/comentario/:id/:comentarioId/editar', async (req, res) => {
    const eixo = eixoDeInteracao(req.params.eixo);
    const fetchando = ehPedidoDeFetch(req);

    if (!eixo) return fetchando ? res.status(400).json({ erro: 'Publicação inválida.' }) : res.redirect('/categories');

    if (!req.user) {
        if (fetchando) return res.status(401).json({ erro: 'Faça login para editar.', login: '/users/login' });
        return res.redirect('/users/login');
    }

    const validacao = comentarioSchema.safeParse(req.body);
    if (!validacao.success) {
        const msg = primeiraMensagem(validacao.error);
        if (fetchando) return res.status(400).json({ erro: msg });
        req.flash('error_msg', msg);
        return res.redirect(req.get('referer') || eixo.hub);
    }

    try {
        const Modelo = eixo.modelo();
        const achado = await acharComentario(Modelo, req.params.id, req.params.comentarioId, req.user, {
            exigirAutoria: true
        });

        if (achado.erro) {
            if (fetchando) return res.status(achado.status).json({ erro: achado.erro });
            req.flash('error_msg', achado.erro);
            return res.redirect(req.get('referer') || eixo.hub);
        }

        await Modelo.updateOne(
            { _id: req.params.id, 'comentarios._id': req.params.comentarioId },
            { $set: { 'comentarios.$.texto': validacao.data.texto, 'comentarios.$.editadoEm': new Date() } }
        );

        if (fetchando) {
            const dados = await comentariosDoPost(Modelo, req.params.id, req.params.eixo, req.user);
            return res.render('partials/_comentarios', { layout: false, comentarios: dados ? dados.comentarios : [] });
        }

        req.flash('success_msg', 'Comentário atualizado.');
        res.redirect(req.get('referer') || eixo.hub);
    } catch (err) {
        console.error('Erro ao editar comentário:', err);
        if (fetchando) return res.status(500).json({ erro: 'Não foi possível editar o comentário.' });
        res.redirect(eixo.hub);
    }
});

router.post('/:eixo/comentario/:id/:comentarioId/excluir', async (req, res) => {
    const eixo = eixoDeInteracao(req.params.eixo);
    const fetchando = ehPedidoDeFetch(req);

    if (!eixo) return fetchando ? res.status(400).json({ erro: 'Publicação inválida.' }) : res.redirect('/categories');

    if (!req.user) {
        if (fetchando) return res.status(401).json({ erro: 'Faça login para excluir.', login: '/users/login' });
        return res.redirect('/users/login');
    }

    try {
        const Modelo = eixo.modelo();
        const achado = await acharComentario(Modelo, req.params.id, req.params.comentarioId, req.user, {
            exigirAutoria: false
        });

        if (achado.erro) {
            if (fetchando) return res.status(achado.status).json({ erro: achado.erro });
            req.flash('error_msg', achado.erro);
            return res.redirect(req.get('referer') || eixo.hub);
        }

        await Modelo.updateOne(
            { _id: req.params.id },
            { $pull: { comentarios: { _id: req.params.comentarioId } } }
        );

        if (fetchando) {
            const dados = await comentariosDoPost(Modelo, req.params.id, req.params.eixo, req.user);
            return res.render('partials/_comentarios', { layout: false, comentarios: dados ? dados.comentarios : [] });
        }

        req.flash('success_msg', 'Comentário excluído.');
        res.redirect(req.get('referer') || eixo.hub);
    } catch (err) {
        console.error('Erro ao excluir comentário:', err);
        if (fetchando) return res.status(500).json({ erro: 'Não foi possível excluir o comentário.' });
        res.redirect(eixo.hub);
    }
});

export default router;
// [Melhoria Proativa Adicionada: validações e integrações de governança aplicadas ao fluxo existente]
