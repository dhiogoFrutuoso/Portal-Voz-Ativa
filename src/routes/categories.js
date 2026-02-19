import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config();

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const Chamado = mongoose.model('chamados');
const Denuncia = mongoose.model('denuncias');
const Vitrine = mongoose.model('vitrine');
const router = express.Router();

// --- CONFIGURAÇÃO DO MULTER ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/videos/'));
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage: storage });

const uploadDenuncia = upload.fields([
    { name: 'video', maxCount: 1 }
]);

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

router.post('/gestao_de_melhorias/abrir-chamado', isUser, upload.none(), async (req, res) => {
    try {
        // CORREÇÃO: O JS envia 'imagens[]'. Capturamos todas as variações possíveis para garantir.
        let nomesImagens = req.body['imagens[]'] || req.body['imagens_urls[]'] || req.body.imagens || [];
        
        // Se vier apenas uma string (uma única foto), transformamos em array
        if (typeof nomesImagens === 'string') {
            nomesImagens = [nomesImagens];
        }

        const { titulo, descricao, localizacao, latitude, longitude } = req.body;

        const novoChamado = {
            titulo,
            descricao,
            localizacao,
            latitude: latitude ? parseFloat(latitude) : null, 
            longitude: longitude ? parseFloat(longitude) : null,
            imagens: nomesImagens, // Certifique-se que no seu Model o campo é 'imagem' do tipo Array
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

router.get('/gestao_de_melhorias/hub', async (req, res) => {
    try {
        // Ordena por data de criação decrescente
        const chamadosDocs = await Chamado.find().sort({ createdAt: -1 }).lean();
        
        const chamados = chamadosDocs.map(doc => {
            // Lógica de curtidas
            doc.jaCurtiu = req.user ? doc.curtidas.some(id => id.toString() === req.user._id.toString()) : false;
            
            // Define a imagem principal para o card (primeira posição do array)
            doc.imagemPrincipal = (doc.imagens && doc.imagens.length > 0) ? doc.imagens[0] : null;
            
            return doc;
        });

        res.render('categories/gestao_de_melhorias/hub', { chamados });
    } catch (err) {
        console.error("Erro no Hub:", err);
        res.redirect('/');
    }
});

router.get('/gestao_de_melhorias/detalhes/:id', async (req, res) => {
    try {
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

        res.render("categories/gestao_de_melhorias/detalhes", { 
            chamadoDoc: {
                ...chamadoDoc,
                curtidas: curtidas,
                comentarios: chamadoDoc.comentarios || [],
                imagens: chamadoDoc.imagens || [] 
            }, 
            jaCurtiu 
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

        const chamado = await Chamado.findById(req.params.id);
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

        const novoComentario = {
            texto: req.body.texto,
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
    res.render('categories/denuncias_sigilosas/saiba-mais')
});

router.get('/denuncias_sigilosas/abrir-denuncia', isUser, (req, res) => {
    res.render('categories/denuncias_sigilosas/abrir-denuncia');
});

router.get('/denuncias_sigilosas/hub', async (req, res) => {
    try {
        const denunciasDocs = await Denuncia.find().sort({ dataCriacao: -1 }).lean();
        
        const denunciasComLike = denunciasDocs.map(denuncia => {
            const curtidasArray = denuncia.curtidas || []; 
            return {
                ...denuncia,
                curtidas: curtidasArray,
                // Mapeia a primeira URL do Cloudinary para imagemPrincipal
                imagemPrincipal: denuncia.imagens && denuncia.imagens.length > 0 ? denuncia.imagens[0] : null,
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            };
        });

        res.render('categories/denuncias_sigilosas/hub', { denuncias: denunciasComLike });
    } catch (err) {
        console.error(err);
        req.flash("error_msg", "Erro ao carregar o painel");
        res.redirect("/");
    }
});

router.post('/denuncias_sigilosas/abrir-denuncia', isUser, async (req, res) => {
    try {
        const { tipoOcorrencia, titulo, descricao, localizacao, latitude, longitude, video_url } = req.body;
        
        // Captura flexível para as imagens enviadas via Cloudinary no Front-end
        let imagensCloudinary = req.body['imagens_urls[]'] || req.body.imagens_urls || [];
        if (typeof imagensCloudinary === 'string') imagensCloudinary = [imagensCloudinary];

        const novaDenuncia = {
            tipoOcorrencia,
            titulo: tipoOcorrencia === 'Outro' ? titulo : tipoOcorrencia,
            descricao,
            localizacao,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            imagens: imagensCloudinary,
            // Agora pegamos a URL que veio do input hidden 'video_url' preenchido pelo script do front
            video: video_url || null, 
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
        const denuncia = await Denuncia.findById(req.params.id)
            .populate('usuario')
            .populate('comentarios.usuario')
            .lean();

        if (!denuncia) {
            req.flash("error_msg", "Esta denúncia não foi encontrada.");
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }

        const curtidas = denuncia.curtidas || [];
        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        res.render("categories/denuncias_sigilosas/detalhes", { 
            denuncia: {
                ...denuncia,
                curtidas: curtidas,
                comentarios: denuncia.comentarios || [],
                imagens: denuncia.imagens || [],
                // Garante que o campo video chegue ao template (pode ser a URL do Cloudinary)
                video: denuncia.video || null 
            }, 
            jaCurtiu 
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
        const denuncia = await Denuncia.findById(req.params.id);
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
        const novaCita = {
            usuario: req.user._id,
            texto: req.body.texto
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
    res.render("categories/vitrine_do_trabalhador/saiba-mais")
});

router.get("/vitrine_do_trabalhador/criar-vitrine", isUser, (req, res) => {
    res.render("categories/vitrine_do_trabalhador/criar-vitrine")
});

// HUB da Vitrine
router.get('/vitrine_do_trabalhador/hub', async (req, res) => {
    try {
        const anunciosDocs = await Vitrine.find()
            .populate('usuario', 'name profileImage profession') 
            .sort({ dataCriacao: -1 })
            .lean(); 

        const vitrinesCompletas = anunciosDocs.map(anuncio => {
            const curtidasArray = anuncio.curtidas || []; 
            return {
                ...anuncio,
                curtidas: curtidasArray,
                // Garante uma imagem de capa para o card do HUB
                imagemPrincipal: anuncio.imagens && anuncio.imagens.length > 0 ? anuncio.imagens[0] : null,
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            };
        });
            
        res.render('categories/vitrine_do_trabalhador/hub', { anuncios: vitrinesCompletas });
    } catch (err) {
        console.error(err);
        req.flash("error_msg", "Erro ao carregar a Vitrine.");
        res.redirect('/categories');
    }
});

// Detalhes da Vitrine
router.get('/vitrine_do_trabalhador/detalhes/:id', async (req, res) => {
    try {
        const vitrineDoc = await Vitrine.findById(req.params.id)
            .populate('usuario')
            .populate('comentarios.usuario')
            .lean();

        if (!vitrineDoc) {
            req.flash("error_msg", "Esse anúncio não foi encontrado.");
            return res.redirect("/categories/vitrine_do_trabal_ador/hub");
        }

        const curtidas = vitrineDoc.curtidas || [];
        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        res.render("categories/vitrine_do_trabalhador/detalhes", { 
            vitrine: {
                ...vitrineDoc,
                curtidas: curtidas,
                comentarios: vitrineDoc.comentarios || [],
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
        const vitrine = await Vitrine.findById(req.params.id);
        if(!vitrine) return res.redirect("back");

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
        if (!req.body.texto || req.body.texto.trim() === "") {
            return res.redirect("back");
        }

        const novoComentario = {
            usuario: req.user._id,
            texto: req.body.texto,
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
router.post('/vitrine_do_trabalhador/criar-vitrine', isUser, upload.none(), async (req, res) => {
    try {
        if (!req.body.titulo || !req.body.descricao) {
            req.flash("error_msg", "Preencha todos os campos obrigatórios.");
            return res.redirect('back');
        }

        // Tratamento das URLs das imagens
        let imagensVitrine = req.body['imagens_urls[]'] || req.body.imagens_urls || [];
        if (typeof imagensVitrine === 'string') imagensVitrine = [imagensVitrine];

        const novoAnuncio = new Vitrine({
            titulo: req.body.titulo,
            categoria: req.body.categoria,
            categoria_especificada: req.body.categoria === 'Outros' ? req.body.categoria_especificada : null,
            descricao: req.body.descricao,
            produtos: req.body.produtos,
            servicos: req.body.servicos,
            contato: req.body.contato,
            localizacao: req.body.localizacao,
            latitude: req.body.latitude ? parseFloat(req.body.latitude) : null,
            longitude: req.body.longitude ? parseFloat(req.body.longitude) : null,
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