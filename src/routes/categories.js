import express from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

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
        if (file.fieldname === "video") {
            cb(null, path.join(__dirname, '../public/videos/'));
        } else {
            cb(null, path.join(__dirname, '../public/img_chamados/'));
        }
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + "-" + file.originalname);
    }
});

const upload = multer({ storage: storage });
const uploadDenuncia = upload.fields([
    { name: 'imagens', maxCount: 3 },
    { name: 'video', maxCount: 1 }
]);

// --- ROTAS ---

router.get('/', (req, res) => { 
    res.render('categories/categories');
});

router.get('/gestao_de_melhorias/saiba-mais', (req, res) => {
    res.render('categories/gestao_de_melhorias/saiba-mais');
});

router.get('/gestao_de_melhorias/abrir-chamado', isUser, (req, res) => {
    res.render('categories/gestao_de_melhorias/abrir-chamado');
});

// ROTA PARA SALVAR O CHAMADO (POST) - CORRIGIDA
router.post('/gestao_de_melhorias/abrir-chamado', isUser, upload.array('imagens', 3), async (req, res) => {
    try {
        // 1. Coleta os nomes das imagens salvas pelo multer
        const nomesImagens = req.files ? req.files.map(file => file.filename) : [];

        // 2. Desestrutura os dados do corpo da requisição
        const { titulo, descricao, localizacao, latitude, longitude } = req.body;

        // 3. Monta o objeto do novo chamado com as correções
        const novoChamado = {
            titulo,
            descricao,
            localizacao,
            // parseFloat pode retornar NaN se a string for vazia, por isso o check:
            latitude: latitude ? parseFloat(latitude) : null, 
            longitude: longitude ? parseFloat(longitude) : null,
            imagem: nomesImagens, // <-- CORRIGIDO: Agora usa a variável definida acima
            usuario: req.user._id
        };

        // 4. Salva no banco de dados
        await new Chamado(novoChamado).save();
        
        req.flash('success_msg', 'Melhoria registrada com sucesso!');
        res.redirect('/categories/gestao_de_melhorias/hub');
    } catch (err) {
        console.error("Erro ao salvar chamado:", err);
        req.flash('error_msg', 'Erro ao salvar o chamado. Tente novamente.');
        res.redirect('/categories/gestao_de_melhorias/abrir-chamado');
    }
});

// ROTA DE LISTAGEM (HUB)
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

// ROTA DE DETALHES (CORRIGIDA COM POPULATE)
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

        res.render('categories/gestao_de_melhorias/detalhes', { 
            chamado: chamado, 
            jaCurtiu: jaCurtiu 
        });

    } catch (err) {
        console.log("Erro ao buscar detalhes:", err);
        req.flash('error_msg', 'Erro interno ao carregar detalhes.');
        res.redirect('/categories/gestao_de_melhorias/hub');
    }
});

// ROTA PARA CURTIR/DESCURTIR
router.post('/gestao_de_melhorias/like/:id', async (req, res) => {
    try {
        if (!req.user) {
            req.flash('error_msg', 'Você precisa estar logado para curtir.');
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

// ROTA PARA COMENTAR (CORRIGIDA E SIMPLIFICADA)
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
            // Garante que curtidas seja pelo menos um array vazio se não existir no banco
            const curtidasArray = denuncia.curtidas || []; 
            
            return {
                ...denuncia,
                curtidas: curtidasArray, // Garante que o Handlebars receba um array para o .length
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

// ROTA POST ATUALIZADA
router.post('/denuncias_sigilosas/abrir-denuncia', isUser, uploadDenuncia, async (req, res) => {
    try {
        const { tipoOcorrencia, titulo, descricao, localizacao, latitude, longitude } = req.body;
        
        const novaDenuncia = {
            tipoOcorrencia,
            titulo: tipoOcorrencia === 'Outro' ? titulo : tipoOcorrencia,
            descricao,
            localizacao,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            imagens: req.files['imagens'] ? req.files['imagens'].map(f => f.filename) : [],
            video: req.files['video'] ? req.files['video'][0].filename : null,
            usuario: req.user._id
        };

        await new Denuncia(novaDenuncia).save();
        req.flash('success_msg', 'Denúncia enviada com sucesso!');
        res.redirect('/categories/denuncias_sigilosas/hub');
    } catch (err) {
        console.error(err);
        res.redirect('/categories/denuncias_sigilosas/abrir-denuncia');
    }
});

// ROTA DE DETALHES (Protegida e com caminho corrigido)
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
        const comentarios = denuncia.comentarios || [];

        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        res.render("categories/denuncias_sigilosas/detalhes", { 
            denuncia: {
                ...denuncia,
                curtidas: curtidas,
                comentarios: comentarios,
                imagens: denuncia.imagens || [] // Garante que o carousel não quebre
            }, 
            jaCurtiu 
        });

    } catch (err) {
        console.error("ERRO NO CONSOLE:", err); // Isso vai mostrar o erro real no seu terminal
        req.flash("error_msg", "Erro interno ao carregar detalhes");
        res.redirect("/categories/denuncias_sigilosas/hub");
    }
});

// ROTA DE LIKE
router.post('/denuncias_sigilosas/like/:id', async (req, res) => {
    if (!req.user) {
        req.flash("error_msg", "Você precisa estar logado para curtir");
        return res.redirect("/users/login");
    }
    try {
        const denuncia = await Denuncia.findById(req.params.id);
        const userIndex = denuncia.curtidas.indexOf(req.user._id);

        if (userIndex > -1) {
            denuncia.curtidas.splice(userIndex, 1); // Remove like
        } else {
            denuncia.curtidas.push(req.user._id); // Adiciona like
        }

        await denuncia.save();
        res.redirect(req.get('referer') || "/categories/denuncias_sigilosas/hub");
    } catch (err) {
        res.redirect("/categories/denuncias_sigilosas/hub");
    }
});

// ROTA DE COMENTÁRIO
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
        res.redirect(req.get('referer') || "/categories/denuncias_sigilosas/detalhes/:id");
    } catch (err) {
        res.redirect("/categories/denuncias_sigilosas/detalhes/:id");
    }
});

router.get("/vitrine_do_trabalhador/saiba-mais", (req, res) => {
    res.render("categories/vitrine_do_trabalhador/saiba-mais")
});

router.get("/vitrine_do_trabalhador/criar-vitrine", isUser, (req, res) => {
    res.render("categories/vitrine_do_trabalhador/criar-vitrine")
});

router.get('/vitrine_do_trabalhador/hub', async (req, res) => {
    try {
        const anuncios = await Vitrine.find()
            // Adicione 'name', 'profileImage' e 'profession' aqui:
            .populate('usuario', 'name profileImage profession') 
            .sort({ dataCriacao: -1 })
            .lean(); 

        const vitrinesComLike = anuncios.map(anuncio => { // mudei para singular para ficar mais claro
            const curtidasArray = anuncio.curtidas || []; 
            
            return {
                ...anuncio,
                curtidas: curtidasArray,
                jaCurtiu: req.user ? curtidasArray.some(id => id.toString() === req.user._id.toString()) : false
            };
        });
            
        res.render('categories/vitrine_do_trabalhador/hub', { anuncios: vitrinesComLike });
    } catch (err) {
        console.error(err); // Bom para você ver o erro real no console se algo falhar
        req.flash("error_msg", "Erro ao carregar a Vitrine.");
        res.redirect('/categories');
    }
});

// 2. DETALHES DO ANÚNCIO
router.get('/vitrine_do_trabalhador/detalhes/:id', async (req, res) => {
    try {
        const vitrine = await Vitrine.findById(req.params.id)
            .populate('usuario')
            .populate('comentarios.usuario')
            .lean();

        if (!vitrine) {
            req.flash("error_msg", "Esse anúncio não foi encontrada.");
            return res.redirect("/categories/vitrine_do_trabalhador/hub");
        }

        const curtidas = vitrine.curtidas || [];
        const comentarios = vitrine.comentarios || [];

        const jaCurtiu = req.user ? curtidas.some(id => id.toString() === req.user._id.toString()) : false;

        res.render("categories/vitrine_do_trabalhador/detalhes", { 
            vitrine: {
                ...vitrine,
                curtidas: curtidas,
                comentarios: comentarios,
                imagens: vitrine.imagens || [] // Garante que o carousel não quebre
            }, 
            jaCurtiu 
        });

    } catch (err) {
        console.error("ERRO NO CONSOLE:", err); // Isso vai mostrar o erro real no seu terminal
        req.flash("error_msg", "Erro interno ao carregar detalhes");
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

// 3. CURTIDAS
router.post('/vitrine_do_trabalhador/curtir/:id', async (req, res) => {
    if (!req.user) {
        req.flash("error_msg", "Você precisa estar logado para curtir");
        return res.redirect("/users/login");
    }
    try {
        const vitrine = await Vitrine.findById(req.params.id);
        const userIndex = vitrine.curtidas.indexOf(req.user._id);

        if (userIndex > -1) {
            vitrine.curtidas.splice(userIndex, 1); // Remove like
        } else {
            vitrine.curtidas.push(req.user._id); // Adiciona like
        }

        await vitrine.save();
        res.redirect(req.get('referer') || "/categories/vitrine_do_trabalhador/hub");
    } catch (err) {
        res.redirect("/categories/vitrine_do_trabalhador/hub");
    }
});

// 4. COMENTÁRIOS
router.post('/vitrine_do_trabalhador/comentar/:id', async (req, res) => {
    if (!req.user) {
        req.flash("error_msg", "Você precisa estar logado para comentar.");
        return res.redirect("/users/login");
    }
    try {
        const novaCita = {
            usuario: req.user._id,
            texto: req.body.texto
        };
        await Vitrine.findByIdAndUpdate(req.params.id, {
            $push: { comentarios: novaCita }
        });
        res.redirect(req.get('referer') || "/categories/vitrine_do_trabalhador/detalhes/:id");
    } catch (err) {
        res.redirect("/categories/vitrine_do_trabalhador/detalhes/:id");
    }
});

// 5. PROCESSO DE CRIAÇÃO (CORRIGIDO)
router.post('/vitrine_do_trabalhador/criar-vitrine', isUser, upload.array('imagens', 3), async (req, res) => {
    try {
        // Validação de Usuário
        if (!req.user) {
            req.flash("error_msg", "Você precisa estar logado para anunciar.");
            return res.redirect("/users/login");
        }

        // Validação Básica
        if (!req.body.titulo || !req.body.descricao) {
            req.flash("error_msg", "Preencha todos os campos obrigatórios.");
            return res.redirect('back');
        }

        const novoAnuncio = {
            titulo: req.body.titulo,
            categoria: req.body.categoria,
            // Se for 'Outros', usa o valor do campo especificado
            categoria_especificada: req.body.categoria === 'Outros' ? req.body.categoria_especificada : null,
            descricao: req.body.descricao,
            produtos: req.body.produtos,
            servicos: req.body.servicos,
            contato: req.body.contato,
            localizacao: req.body.localizacao,
            latitude: req.body.latitude,
            longitude: req.body.longitude,
            usuario: req.user._id,
            // Mapeia os nomes dos arquivos salvos pelo Multer
            imagens: req.files ? req.files.map(f => f.filename) : [] 
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