import express from 'express';
import mongoose from 'mongoose';
// Multer removido pois o upload agora é feito via Cloudinary no Front-end

// Importando modelos e helpers
import '../models/categories.js'; 
import '../models/denuncias.js';
import '../models/vitrine.js';

import isUser from '../helpers/isUser.js';

const Chamado = mongoose.model('chamados');
const Denuncia = mongoose.model('denuncias');
const Vitrine = mongoose.model('vitrine');
const router = express.Router();

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

// ROTA PARA SALVAR O CHAMADO (POST) - ADAPTADA PARA CLOUDINARY
router.post('/gestao_de_melhorias/abrir-chamado', isUser, async (req, res) => {
    try {
        // Agora recebemos as URLs do Cloudinary vindas do front-end via req.body
        const { titulo, descricao, localizacao, latitude, longitude, imagensUrls } = req.body;

        const novoChamado = {
            titulo,
            descricao,
            localizacao,
            latitude: latitude ? parseFloat(latitude) : null, 
            longitude: longitude ? parseFloat(longitude) : null,
            // imagensUrls deve ser enviado como um array de strings pelo front
            imagem: imagensUrls || [], 
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
        const chamadosDocs = await Chamado.find().sort({ dataCriacao: -1 }).lean();
        const chamados = chamadosDocs.map(doc => {
            doc.jaCurtiu = req.user ? doc.curtidas.some(id => id.toString() === req.user._id.toString()) : false;
            return doc;
        });
        res.render('categories/gestao_de_melhorias/hub', { chamados });
    } catch (err) {
        res.redirect('/');
    }
});

router.get('/gestao_de_melhorias/detalhes/:id', async (req, res) => {
    try {
        const chamadoDoc = await Chamado.findById(req.params.id)
            .populate('comentarios.usuario') 
            .populate('usuario'); 

        if (!chamadoDoc) {
            req.flash('error_msg', 'Chamado não encontrado.');
            return res.redirect('/categories/gestao_de_melhorias/hub');
        }

        let jaCurtiu = false;
        if (req.user) {
            jaCurtiu = chamadoDoc.curtidas.some(id => id.toString() === req.user._id.toString());
        }

        const chamado = chamadoDoc.toObject();
        res.render('categories/gestao_de_melhorias/detalhes', { chamado, jaCurtiu });

    } catch (err) {
        req.flash('error_msg', 'Erro interno ao carregar detalhes.');
        res.redirect('/categories/gestao_de_melhorias/hub');
    }
});

router.post('/gestao_de_melhorias/like/:id', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error_msg', 'Você precisa estar logado para curtir.');
            return res.redirect('/users/login'); 
        }
        const chamado = await Chamado.findById(req.params.id);
        const userIndex = chamado.curtidas.indexOf(req.user._id);
        if (userIndex !== -1) { chamado.curtidas.splice(userIndex, 1); } 
        else { chamado.curtidas.push(req.user._id); }
        await chamado.save();
        res.redirect(req.get('referer') || '/categories/gestao_de_melhorias/hub');
    } catch (err) {
        res.redirect('/categories/gestao_de_melhorias/hub');
    }
});

router.post('/gestao_de_melhorias/comentar/:id', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error_msg', 'Você precisa estar logado para comentar.');
            return res.redirect(`/users/login`);
        }
        const novoComentario = { texto: req.body.texto, usuario: req.user._id, createdAt: new Date() };
        await Chamado.findByIdAndUpdate(req.params.id, { $push: { comentarios: novoComentario } });
        res.redirect(`/categories/gestao_de_melhorias/detalhes/${req.params.id}`);
    } catch (err) {
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
        const denuncias = await Denuncia.find().sort({ dataCriacao: -1 }).lean();
        const denunciasComLike = denuncias.map(denuncia => {
            const curtidasArray = denuncia.curtidas || []; 
            return {
                ...denuncia,
                curtidas: curtidasArray,
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            };
        });
        res.render('categories/denuncias_sigilosas/hub', { denuncias: denunciasComLike });
    } catch (err) {
        res.redirect("/");
    }
});

// ROTA POST DENÚNCIA - ADAPTADA PARA CLOUDINARY
router.post('/denuncias_sigilosas/abrir-denuncia', isUser, async (req, res) => {
    try {
        // O front-end envia imagensUrl (array) e videoUrl (string) do Cloudinary
        const { tipoOcorrencia, titulo, descricao, localizacao, latitude, longitude, imagensUrls, videoUrl } = req.body;
        
        const novaDenuncia = {
            tipoOcorrencia,
            titulo: tipoOcorrencia === 'Outro' ? titulo : tipoOcorrencia,
            descricao,
            localizacao,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            imagens: imagensUrls || [],
            video: videoUrl || null,
            usuario: req.user._id
        };

        await new Denuncia(novaDenuncia).save();
        req.flash('success_msg', 'Denúncia enviada com sucesso!');
        res.redirect('/categories/denuncias_sigilosas/hub');
    } catch (err) {
        res.redirect('/categories/denuncias_sigilosas/abrir-denuncia');
    }
});

router.get('/denuncias_sigilosas/detalhes/:id', async (req, res) => { 
    try {
        const denuncia = await Denuncia.findById(req.params.id).populate('usuario').populate('comentarios.usuario').lean();
        if (!denuncia) {
            req.flash("error_msg", "Esta denúncia não foi encontrada.");
            return res.redirect("/categories/denuncias_sigilosas/hub");
        }
        const jaCurtiu = req.user ? (denuncia.curtidas || []).some(id => id.toString() === req.user._id.toString()) : false;
        res.render("categories/denuncias_sigilosas/detalhes", { denuncia, jaCurtiu });
    } catch (err) {
        res.redirect("/categories/denuncias_sigilosas/hub");
    }
});

router.post('/denuncias_sigilosas/like/:id', async (req, res) => {
    if (!req.user) return res.redirect("/users/login");
    try {
        const denuncia = await Denuncia.findById(req.params.id);
        const userIndex = denuncia.curtidas.indexOf(req.user._id);
        if (userIndex > -1) { denuncia.curtidas.splice(userIndex, 1); } 
        else { denuncia.curtidas.push(req.user._id); }
        await denuncia.save();
        res.redirect(req.get('referer') || "/categories/denuncias_sigilosas/hub");
    } catch (err) {
        res.redirect("/categories/denuncias_sigilosas/hub");
    }
});

router.post('/denuncias_sigilosas/comentar/:id', async (req, res) => {
    if (!req.user) return res.redirect("/users/login");
    try {
        const novaCita = { usuario: req.user._id, texto: req.body.texto };
        await Denuncia.findByIdAndUpdate(req.params.id, { $push: { comentarios: novaCita } });
        res.redirect(req.get('referer') || "/categories/denuncias_sigilosas/detalhes/" + req.params.id);
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

router.get('/vitrine_do_trabalhador/hub', async (req, res) => {
    try {
        const anuncios = await Vitrine.find().populate('usuario', 'name profileImage profession').sort({ dataCriacao: -1 }).lean(); 
        const vitrinesComLike = anuncios.map(anuncio => {
            const curtidasArray = anuncio.curtidas || []; 
            return {
                ...anuncio,
                curtidas: curtidasArray,
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            };
        });
        res.render('categories/vitrine_do_trabalhador/hub', { anuncios: vitrinesComLike });
    } catch (err) {
        res.redirect('/categories');
    }
});

router.get('/vitrine_do_trabalhador/detalhes/:id', async (req, res) => {
    try {
        const vitrine = await Vitrine.findById(req.params.id).populate('usuario').populate('comentarios.usuario').lean();
        if (!vitrine) return res.redirect("/categories/vitrine_do_trabalhador/hub");
        const jaCurtiu = req.user ? (vitrine.curtidas || []).some(id => id.toString() === req.user._id.toString()) : false;
        res.render("categories/vitrine_do_trabalhador/detalhes", { vitrine, jaCurtiu });
    } catch (err) {
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

router.post('/vitrine_do_trabalhador/curtir/:id', async (req, res) => {
    if (!req.user) return res.redirect("/users/login");
    try {
        const vitrine = await Vitrine.findById(req.params.id);
        const userIndex = vitrine.curtidas.indexOf(req.user._id);
        if (userIndex > -1) { vitrine.curtidas.splice(userIndex, 1); } 
        else { vitrine.curtidas.push(req.user._id); }
        await vitrine.save();
        res.redirect(req.get('referer') || "/categories/vitrine_do_trabalhador/hub");
    } catch (err) {
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

router.post('/vitrine_do_trabalhador/comentar/:id', async (req, res) => {
    if (!req.user) return res.redirect("/users/login");
    try {
        const novaCita = { usuario: req.user._id, texto: req.body.texto };
        await Vitrine.findByIdAndUpdate(req.params.id, { $push: { comentarios: novaCita } });
        res.redirect(req.get('referer') || "/categories/vitrine_do_trabalhador/detalhes/" + req.params.id);
    } catch (err) {
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

// PROCESSO DE CRIAÇÃO VITRINE - ADAPTADO PARA CLOUDINARY
router.post('/vitrine_do_trabalhador/criar-vitrine', isUser, async (req, res) => {
    try {
        const { titulo, categoria, categoria_especificada, descricao, produtos, servicos, contato, localizacao, latitude, longitude, imagensUrls } = req.body;

        if (!titulo || !descricao) {
            req.flash("error_msg", "Preencha todos os campos obrigatórios.");
            return res.redirect('back');
        }

        const novoAnuncio = {
            titulo,
            categoria,
            categoria_especificada: categoria === 'Outros' ? categoria_especificada : null,
            descricao,
            produtos,
            servicos,
            contato,
            localizacao,
            latitude,
            longitude,
            usuario: req.user._id,
            imagens: imagensUrls || [] // Recebe o array de URLs do Cloudinary
        };

        await new Vitrine(novoAnuncio).save();
        req.flash("success_msg", "Anúncio publicado com sucesso!");
        res.redirect('/categories/vitrine_do_trabalhador/hub');

    } catch (err) {
        console.error("ERRO NO CADASTRO VITRINE:", err);
        req.flash("error_msg", "Houve um erro interno ao salvar o anúncio.");
        res.redirect('/categories/vitrine_do_trabalhador/hub');
    }
});

export default router;