import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { v2 as cloudinary } from 'cloudinary';
import 'dotenv/config';
import rateLimit from 'express-rate-limit';

// Rate Limiter

const Limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 30,
  message: "Muitas tentativas de registro, tente novamente mais tarde.",
});

// Configuração do Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
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
    filtroDeSigilo,
    podeVerDenuncia,
    nasceSigilosa,
    anonimizarAutor
} from '../helpers/protocolo.js';

/*
 * Junta filtros do Mongo sem perder nenhum.
 *
 * Espalhar dois objetos que usam `$or` (o recorte de sigilo e a busca textual)
 * fazia o segundo sobrescrever o primeiro em silêncio — e a busca acabava
 * revelando denúncia sigilosa. Com `$and` as duas condições precisam valer.
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

// Dados de estágio que os cards do hub exibem (e que o admin pode alterar ali mesmo).
const comEstagio = (doc) => {
    const status = normalizarStatus(doc.status);
    return { ...doc, status, estagio: estagioDe(status) };
};

const estagiosParaSelect = () => LISTA_ESTAGIOS.map((chave) => estagioDe(chave));

// Valores dos botões de filtro dos hubs. São os mesmos das telas de criação.
const TIPOS_OCORRENCIA = [
    'Foco de Queimada',
    'Descarte Irregular de Lixo',
    'Maus-tratos contra Animais',
    'Poluição Sonora',
    'Vandalismo',
    'Tráfico ou Uso de Drogas',
    'Outro'
];

const CATEGORIAS_VITRINE = [
    'Serviços Gerais',
    'Alimentação',
    'Construção Civil',
    'Educação/Aulas',
    'Artesanato',
    'Outros'
];

/*
 * Busca dos hubs: devolve só o pedaço de HTML com os cards, para a página
 * trocar a lista sem recarregar. O mesmo partial usado na página completa é
 * renderizado aqui, então o desenho do card não é duplicado.
 */
function montarBuscaDeHub({ Modelo, campos, colecao, partial, preparar, tipoProtocolo = null, aplicarSigilo = false }) {
    return async (req, res) => {
        try {
            const { filtro } = filtroDoHub(req.query, campos);
            const recorte = aplicarSigilo ? filtroDeSigilo() : {};

            const docs = await Modelo.find(combinarFiltros(recorte, filtro))
                .populate('usuario', 'name profileImage profession')
                .sort({ dataCriacao: -1 })
                .limit(60)
                .lean();

            res.render(`partials/${partial}`, {
                layout: false,
                [colecao]: docs.map((doc) => preparar(doc, req)),
                // O card do hub traz o seletor de estágio do admin: sem estes
                // valores o seletor sairia vazio e o formulário, quebrado.
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
    jaCurtiu: req.user ? (doc.curtidas || []).some((id) => id.toString() === req.user._id.toString()) : false,
    imagemPrincipal: doc.imagens && doc.imagens.length > 0 ? doc.imagens[0] : null
});

const prepararVitrine = (doc, req) => ({
    ...doc,
    usuario: formatAuthor(doc.usuario),
    curtidas: doc.curtidas || [],
    imagemPrincipal: doc.imagens && doc.imagens.length > 0 ? doc.imagens[0] : null,
    jaCurtiu: req.user ? (doc.curtidas || []).some((id) => id.toString() === req.user._id.toString()) : false
});

// Dono do post: só ele vê o botão de editar/excluir no detalhe.
const ehDonoDoPost = (req, doc) => {
    const autor = doc?.usuario?._id || doc?.usuario;
    return Boolean(req.user && autor && String(autor) === String(req.user._id));
};

// Um :id fora do formato ObjectId derruba a query com CastError; barramos antes.
const idValido = (id) => mongoose.Types.ObjectId.isValid(id);

const Chamado = mongoose.model('chamados');
const Denuncia = mongoose.model('denuncias');
const Vitrine = mongoose.model('vitrine');
const router = express.Router();

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

// --- CONFIGURAÇÃO DO MULTER ---
// As mídias sobem direto do navegador para o Cloudinary e chegam aqui apenas como URL,
// então o multer é usado só para interpretar o multipart/form-data (upload.none()).
// Nada é gravado em disco: o sistema de arquivos do Render/Vercel é efêmero.
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
    res.render('categories/gestao_de_melhorias/abrir-chamado');
});

router.post('/gestao_de_melhorias/abrir-chamado', isUser, Limiter, upload.none(), async (req, res) => {
    try {
        const validacao = chamadoSchema.safeParse(req.body);

        if (!validacao.success) {
            req.flash('error_msg', primeiraMensagem(validacao.error));
            return res.redirect('/categories/gestao_de_melhorias/abrir-chamado');
        }

        // O JS do formulário envia 'imagens[]'; aceitamos as variações e
        // descartamos qualquer URL que não venha do nosso Cloudinary.
        const nomesImagens = normalizarMidias(
            req.body['imagens[]'] || req.body['imagens_urls[]'] || req.body.imagens
        );

        const novoChamado = {
            ...validacao.data,
            imagens: nomesImagens,
            usuario: req.user._id
        };

        await new Chamado(novoChamado).save();
        
        req.flash('success_msg', 'Melhoria registrada com sucesso!');
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
        campos: ['titulo', 'descricao', 'localizacao'],
        colecao: 'chamados',
        partial: '_cards_melhorias',
        preparar: prepararChamado,
        tipoProtocolo: 'melhoria'
    })
);

router.get('/gestao_de_melhorias/hub', async (req, res) => {
    try {
        const { termo, filtro } = filtroDoHub(req.query, ['titulo', 'descricao', 'localizacao']);

        const chamadosDocs = await Chamado.find(filtro).sort({ dataCriacao: -1 }).lean();

        const chamados = chamadosDocs.map(doc => {
            // Lógica de curtidas
            doc.jaCurtiu = req.user ? doc.curtidas.some(id => id.toString() === req.user._id.toString()) : false;

            // Define a imagem principal para o card (primeira posição do array)
            doc.imagemPrincipal = (doc.imagens && doc.imagens.length > 0) ? doc.imagens[0] : null;

            return comEstagio(doc);
        });

        res.render('categories/gestao_de_melhorias/hub', {
            chamados,
            termo,
            total: chamados.length,
            estagios: estagiosParaSelect(),
            filtrosEstagio: estagiosParaSelect(),
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

        if (!chamadoDoc) {
            req.flash("error_msg", "Este chamado não foi encontrada.");
            return res.redirect("/categories/gestao_de_melhorias/hub");
        }

        const curtidas = chamadoDoc.curtidas || [];
        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        const eDono = ehDonoDoPost(req, chamadoDoc);
        const status = normalizarStatus(chamadoDoc.status);

        res.render("categories/gestao_de_melhorias/detalhes", {
            chamadoDoc: {
                ...chamadoDoc,
                usuario: formatAuthor(chamadoDoc.usuario),
                curtidas: curtidas,
                comentarios: formatComments(chamadoDoc.comentarios),
                imagens: chamadoDoc.imagens || [],
                status,
                estagio: estagioDe(status),
                // O cartão lateral mostra o estágio real e o prazo, em vez do
                // texto fixo que ficava desatualizado.
                prazo: prazoDoProtocolo(chamadoDoc, 'melhoria'),
                limite: dataLimite(chamadoDoc.dataCriacao, prazoDoProtocolo(chamadoDoc, 'melhoria').dias)
            },
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

        const chamado = await Chamado.findById(req.params.id);
        if (!chamado) return res.redirect('/categories/gestao_de_melhorias/hub');

        const usuarioId = req.user._id;

        const jaCurtiuIndex = chamado.curtidas.indexOf(usuarioId);

        if (jaCurtiuIndex !== -1) {
            chamado.curtidas.splice(jaCurtiuIndex, 1);
        } else {
            chamado.curtidas.push(usuarioId);
        }

        await chamado.save();
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
        if (!idValido(req.params.id) || !validacao.success) {
            req.flash('error_msg', 'Comentário inválido.');
            return res.redirect('/categories/gestao_de_melhorias/hub');
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
    res.render('categories/denuncias_sigilosas/abrir-denuncia');
});

router.get(
    '/denuncias_sigilosas/hub/buscar',
    montarBuscaDeHub({
        Modelo: Denuncia,
        campos: ['titulo', 'descricao', 'localizacao', 'tipoOcorrencia'],
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
            'tipoOcorrencia'
        ]);

        // Denúncia sigilosa não aparece para quem não é o autor nem a gestão.
        const denunciasDocs = await Denuncia.find(combinarFiltros(filtroDeSigilo(), filtro))
            .sort({ dataCriacao: -1 })
            .lean();

        const denunciasComLike = denunciasDocs.map(denuncia => {
            const curtidasArray = denuncia.curtidas || [];
            return comEstagio({
                ...denuncia,
                curtidas: curtidasArray,
                // Mapeia a primeira URL do Cloudinary para imagemPrincipal
                imagemPrincipal: denuncia.imagens && denuncia.imagens.length > 0 ? denuncia.imagens[0] : null,
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            });
        });

        res.render('categories/denuncias_sigilosas/hub', {
            denuncias: denunciasComLike,
            termo,
            total: denunciasComLike.length,
            estagios: estagiosParaSelect(),
            filtrosEstagio: estagiosParaSelect(),
            filtrosOcorrencia: TIPOS_OCORRENCIA,
            tipoProtocolo: 'denuncia'
        });
    } catch (err) {
        console.error(err);
        req.flash("error_msg", "Erro ao carregar o painel");
        res.redirect("/");
    }
});

router.post('/denuncias_sigilosas/abrir-denuncia', Limiter, isUser, async (req, res) => {
    try {
        const validacao = denunciaSchema.safeParse(req.body);

        if (!validacao.success) {
            req.flash('error_msg', primeiraMensagem(validacao.error));
            return res.redirect('/categories/denuncias_sigilosas/abrir-denuncia');
        }

        const { tipoOcorrencia, titulo, descricao, localizacao, latitude, longitude } = validacao.data;

        // Só entram no banco URLs originadas do nosso Cloudinary.
        const imagensCloudinary = normalizarMidias(
            req.body['imagens_urls[]'] || req.body.imagens_urls, 3
        );

        const novaDenuncia = {
            tipoOcorrencia,
            titulo: tipoOcorrencia === 'Outro' && titulo ? titulo : tipoOcorrencia,
            descricao,
            localizacao,
            latitude,
            longitude,
            imagens: imagensCloudinary,
            // Só foco de incêndio nasce público; o resto fica sob sigilo.
            privada: nasceSigilosa(tipoOcorrencia),
            // URL do vídeo vinda do input hidden preenchido pelo script do front
            video: normalizarVideo(req.body.video_url),
            usuario: req.user._id
        };

        await new Denuncia(novaDenuncia).save();
        req.flash('success_msg', 'Denúncia enviada com sucesso!');
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

        // Sigilo vale também no acesso direto pela URL.
        if (!podeVerDenuncia(denuncia, req.user)) {
            req.flash("error_msg", "Esta denúncia é sigilosa: só o autor e a gestão municipal têm acesso.");
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }

        const curtidas = denuncia.curtidas || [];
        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        const eDono = ehDonoDoPost(req, denuncia);
        const status = normalizarStatus(denuncia.status);

        res.render("categories/denuncias_sigilosas/detalhes", {
            denuncia: {
                ...denuncia,
                // Sigilosa não revela o denunciante em tela nenhuma.
                usuario: anonimizarAutor(formatAuthor(denuncia.usuario), denuncia),
                curtidas: curtidas,
                comentarios: formatComments(denuncia.comentarios),
                imagens: denuncia.imagens || [],
                // Garante que o campo video chegue ao template (pode ser a URL do Cloudinary)
                video: denuncia.video || null,
                status,
                estagio: estagioDe(status),
                prazo: prazoDoProtocolo(denuncia, 'denuncia'),
                limite: dataLimite(denuncia.dataCriacao, prazoDoProtocolo(denuncia, 'denuncia').dias)
            },
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

        const denuncia = await Denuncia.findById(req.params.id);
        if (!denuncia) return res.redirect("/categories/denuncias_sigilosas/hub");

        const userIndex = denuncia.curtidas.indexOf(req.user._id);

        if (userIndex > -1) {
            denuncia.curtidas.splice(userIndex, 1);
        } else {
            denuncia.curtidas.push(req.user._id);
        }

        await denuncia.save();
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
        if (!idValido(req.params.id) || !validacao.success) {
            req.flash("error_msg", "Comentário inválido.");
            return res.redirect("/categories/denuncias_sigilosas/hub");
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
            .populate('usuario', 'name profileImage profession')
            .sort({ dataCriacao: -1 })
            .lean(); 

        const vitrinesCompletas = anunciosDocs.map(anuncio => {
            const curtidasArray = anuncio.curtidas || []; 
            return {
                ...anuncio,
                usuario: formatAuthor(anuncio.usuario),
                curtidas: curtidasArray,
                // Garante uma imagem de capa para o card do HUB
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
                usuario: formatAuthor(vitrineDoc.usuario),
                curtidas: curtidas,
                comentarios: formatComments(vitrineDoc.comentarios),
                imagens: vitrineDoc.imagens || [],
                // Garante que a categoria exibida seja a especificada se for "Outros"
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

        const vitrine = await Vitrine.findById(req.params.id);
        if (!vitrine) return res.redirect("/categories/vitrine_do_trabalhador/hub");

        const userIndex = vitrine.curtidas.indexOf(req.user._id);

        if (userIndex > -1) {
            vitrine.curtidas.splice(userIndex, 1);
        } else {
            vitrine.curtidas.push(req.user._id);
        }

        await vitrine.save();
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
        if (!idValido(req.params.id) || !validacao.success) {
            req.flash("error_msg", "Comentário inválido.");
            return res.redirect("/categories/vitrine_do_trabalhador/hub");
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
router.post('/vitrine_do_trabalhador/criar-vitrine', isUser, Limiter, upload.none(), async (req, res) => {
    try {
        const validacao = vitrineSchema.safeParse(req.body);

        if (!validacao.success) {
            req.flash("error_msg", primeiraMensagem(validacao.error));
            return res.redirect('/categories/vitrine_do_trabalhador/criar-vitrine');
        }

        const dados = validacao.data;

        // Só entram no banco URLs originadas do nosso Cloudinary.
        const imagensVitrine = normalizarMidias(
            req.body['imagens_urls[]'] || req.body.imagens_urls
        );

        const novoAnuncio = new Vitrine({
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

export default router;