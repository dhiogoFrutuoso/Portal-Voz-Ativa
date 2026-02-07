import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import passport from 'passport';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import '../models/user.js';

import '../models/vitrine.js';

const user = mongoose.model('users');
const router = express.Router();

// --- CONFIGURAÇÃO DO MULTER (Para outras necessidades) ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.resolve("src", "public", "img_users");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

// --- FUNÇÃO AUXILIAR PARA SALVAR BASE64 ---
const saveBase64Image = (base64String) => {
    const base64Data = base64String.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, 'base64');
    const fileName = `user_${Date.now()}.png`;
    const dir = path.resolve("src", "public", "img_users");
    
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    
    const filePath = path.join(dir, fileName);
    fs.writeFileSync(filePath, buffer);
    return "/img_users/" + fileName;
};

// --- ROTAS DE REGISTRO ---
router.get('/register', (req, res) => {
    res.render('users/register');
});

router.post('/register', async (req, res) => {
    const { name, email, profession, bio, password, password_2, croppedImage } = req.body;
    let errors = [];

    // 1. Validações de Campos
    if (!name || name.trim() === "") errors.push({ text: 'Nome inválido!' });
    if (!email || email.trim() === "") errors.push({ text: 'E-mail inválido!' });
    if (!password || password.length < 4) errors.push({ text: 'Senha muito curta (mínimo 4 caracteres)!' });
    if (password != password_2) errors.push({ text: 'As senhas não coincidem!' });

    // Se houver erros de validação, renderiza a página enviando o array 'errors'
    if (errors.length > 0) {
        return res.render('users/register', { errors, name, email, profession, bio });
    }

    try {
        const userExists = await user.findOne({ email: email });
        
        // 2. Verificação de E-mail duplicado
        if (userExists) {
            // Em vez de req.flash + render, enviamos o erro direto para o render
            return res.render('users/register', { 
                error_msg: "Já existe uma conta com este e-mail.", 
                name, email, profession, bio 
            });
        }

        // 3. Processamento da Imagem
        let caminhoFoto = "/img/guest.jpg";
        if (croppedImage && croppedImage.trim() !== "") {
            caminhoFoto = saveBase64Image(croppedImage); 
        }

        // 4. Criação do Usuário
        const newUser = new user({
            name, 
            email, 
            password, 
            profession, 
            bio, 
            profileImage: caminhoFoto 
        });

        // Hash da senha
        const salt = await bcrypt.genSalt(10);
        newUser.password = await bcrypt.hash(newUser.password, salt);
        
        await newUser.save();

        // Aqui usamos redirect, então o flash funciona perfeitamente!
        req.flash('success_msg', 'Usuário criado com sucesso!');
        res.redirect('/users/login');

    } catch (err) {
        console.error("Erro no Registro:", err);
        // Em caso de erro crítico de banco, também enviamos direto se for renderizar
        res.render('users/register', { 
            error_msg: 'Erro interno ao processar cadastro.',
            name, email, profession, bio 
        });
    }
});

// --- LOGIN / LOGOUT ---
router.get('/login', (req, res) => {
    res.render('users/login');
});

router.post('/login', (req, res, next) => {
    passport.authenticate('local', {
        successRedirect: '/',
        failureRedirect: '/users/login',
        failureFlash: true
    })(req, res, next);
});

router.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });
});

// --- PERFIL E EDIÇÃO ---
router.get('/profile', (req, res) => {
    if (!req.user) {
        req.flash('error_msg', 'Faça login para acessar.');
        return res.redirect('/users/login');
    }
    const userData = JSON.parse(JSON.stringify(req.user));
    res.render('users/profile', { user: userData });
});

router.post('/profile/edit', async (req, res) => {
    if(!req.user) return res.redirect('/users/login');
    
    // Verificação de segurança
    if (!req.body) {
        req.flash('error_msg', 'Erro ao processar os dados do formulário.');
        return res.redirect('/users/profile');
    }

    try {
        const usuario = await user.findById(req.user._id);
        
        // Agora o erro não deve mais ocorrer aqui:
        usuario.name = req.body.name || usuario.name; 
        usuario.bio = req.body.bio;
        usuario.profession = req.body.profession;

        // Lógica do Cropper no Perfil
        if (req.body.croppedImage) {
            // Deleta imagem antiga para não entulhar o servidor
            if (usuario.profileImage && usuario.profileImage.includes('/img_users/')) {
                const oldPath = path.resolve("src", "public", usuario.profileImage.replace(/^\//, ''));
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }
            // Salva a nova imagem cortada
            usuario.profileImage = saveBase64Image(req.body.croppedImage);
        }

        await usuario.save();
        req.flash('success_msg', 'Perfil atualizado com sucesso!');
        res.redirect('/users/profile');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Erro ao salvar perfil');
        res.redirect('/users/profile');
    }
});

// --- TROCA DE SENHA ---
router.post('/profile/change-password', async (req, res) => {
    if (!req.user) return res.redirect('/users/login');
    const { oldPassword, newPassword, newPassword2 } = req.body;

    if (!oldPassword || !newPassword || !newPassword2) {
        req.flash('error_msg', 'Preencha todos os campos de senha.');
        return res.redirect('/users/profile');
    }

    if (newPassword !== newPassword2) {
        req.flash('error_msg', 'A confirmação da nova senha não coincide.');
        return res.redirect('/users/profile');
    }

    try {
        const usuario = await user.findById(req.user._id);
        const match = await bcrypt.compare(oldPassword, usuario.password);
        
        if (!match) {
            req.flash('error_msg', 'Senha atual incorreta.');
            return res.redirect('/users/profile');
        }

        const salt = await bcrypt.genSalt(10);
        usuario.password = await bcrypt.hash(newPassword, salt);
        
        await usuario.save();
        req.flash('success_msg', 'Senha alterada com sucesso!');
        res.redirect('/users/profile');

    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'Erro interno ao mudar senha.');
        res.redirect('/users/profile');
    }
});

router.get('/perfil/:id', async (req, res) => {
    
    try {
        // 1. Verificar se o ID é um ID válido do MongoDB para não travar o servidor
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error_msg', 'ID de usuário inválido.');
            return res.redirect('/');
        }

        // 2. Buscar o usuário (use o nome que você registrou no mongoose.model)
        const User = mongoose.model('users'); 
        const Chamado = mongoose.model('chamados');
        const Vitrine = mongoose.model('vitrine');

        const usuarioPerfil = await User.findById(req.params.id).lean();

        if (!usuarioPerfil) {
            req.flash('error_msg', 'Este usuário não foi encontrado.');
            return res.redirect('/');
        }

        // 3. Buscar os chamados e as vitrines dele
        const vitrinesUsuario = await Vitrine.find({ usuario: req.params.id }).sort({ datacriacao: -1 }).lean();
        const chamadosDoUsuario = await Chamado.find({ usuario: req.params.id }).sort({ dataCriacao: -1 }).lean();

        const vitrinesEChamados = { ...vitrinesUsuario, ...chamadosDoUsuario };

        // 4. Calcular total de curtidas recebidas
        const totalLikes = chamadosDoUsuario.reduce((acc, curr) => acc + (curr.curtidas ? curr.curtidas.length : 0), 0);

        const eDonoDoPerfil = req.params.id === req.user._id.toString();
        res.render('users/userProfile', {
            usuario: req.params.id, 
            user: req.user, 
            eDonoDoPerfil,
            perfil: usuarioPerfil, 
            vitrinesEChamados: vitrinesEChamados,
            totalLikes: totalLikes
        });

    } catch (err) {
        // ISSO VAI MOSTRAR O ERRO REAL NO SEU TERMINAL (VS CODE)
        console.error("ERRO DETALHADO NO PERFIL:", err);
        req.flash('error_msg', 'Erro interno ao carregar o perfil.');
        res.redirect('/');
    }
});

export default router;