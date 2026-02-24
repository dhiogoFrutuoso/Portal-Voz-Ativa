import express from 'express';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import passport from 'passport';
import { v2 as cloudinary } from 'cloudinary';
import rateLimit from 'express-rate-limit';
import { SignJWT, jwtVerify } from 'jose';
import 'dotenv/config';
import '../models/user.js';
import '../models/vitrine.js';
import isUser from '../helpers/isUser.js';

const user = mongoose.model('users');
const router = express.Router();
const JOSE_SECRET_KEY = new TextEncoder().encode(process.env.JWT_SECRET);
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;

// --- RATE LIMIT ---

const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutos
  max: 5,
  message: "Muitas tentativas de login, tente novamente mais tarde.",
})

// --- CONFIGURAÇÃO DO CLOUDINARY ---
cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET 
});

// --- FUNÇÃO AUXILIAR PARA SUBIR PARA O CLOUDINARY ---
const uploadToCloudinary = async (imageInput) => {
    try {
        if (!imageInput || imageInput === "") {
            return "/img/guest.jpg";
        }

        // Se já for uma URL do Cloudinary (enviada pelo seu AJAX frontend), apenas retorna ela
        if (imageInput.startsWith('http')) {
            return imageInput;
        }

        // Se for Base64, faz o upload normalmente
        if (imageInput.startsWith('data:image')) {
            const result = await cloudinary.uploader.upload(imageInput, {
                folder: 'img_users',
                transformation: [
                    { width: 500, height: 500, crop: "fill", gravity: "face" }
                ]
            });
            return result.secure_url;
        }

        return "/img/guest.jpg";
    } catch (error) {
        console.error("Erro no Cloudinary Backend:", error);
        return "/img/guest.jpg";
    }
};

// --- ROTAS DE REGISTRO ---
router.get('/register', (req, res) => {
    res.render('users/register');
});

router.post('/register', async (req, res) => {
    const token = req.body['g-recaptcha-response'];

    if (!token) {
        return res.render('users/register', { error_msg: 'Por favor, complete o reCAPTCHA.'});
    }

    try {
        const response = await fetch(`https://www.google.com/recaptcha/api/siteverify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${RECAPTCHA_SECRET}&response=${token}`
        });

        const googleData = await response.json();

        if (!googleData.success) {
            return res.render('users/login', "Falha na validação de segurança (Bot detectado).");
        };

    } catch (error) {
        console.error('Erro ao validar reCAPTCHA:', error);
        res.status(500).json({ error: 'Erro interno no servidor.' });
    }

    const { name, email, profession, bio, password, password_2, croppedImage } = req.body;
    let errors = [];

    if (!name || name.trim() === "") errors.push({ text: 'Nome inválido!' });
    if (!email || email.trim() === "") errors.push({ text: 'E-mail inválido!' });
    if (!password || password.length < 4) errors.push({ text: 'Senha muito curta!' });
    if (password != password_2) errors.push({ text: 'As senhas não coincidem!' });

    if (errors.length > 0) {
        return res.render('users/register', { errors, name, email, profession, bio });
    }

    try {
        const userExists = await user.findOne({ email: email });
        if (userExists) {
            return res.render('users/register', { error_msg: "Já existe uma conta com este e-mail.", name, email, profession, bio });
        }

        const profileImageUrl = await uploadToCloudinary(croppedImage);

        const newUser = new user({
            name, 
            email, 
            password, 
            profession, 
            bio, 
            profileImage: profileImageUrl 
        });

        const salt = await bcrypt.genSalt(10);
        newUser.password = await bcrypt.hash(newUser.password, salt);
        await newUser.save();

        req.flash('success_msg', 'Usuário criado com sucesso!');
        res.redirect('/users/login');

    } catch (err) {
        console.error("Erro no Registro:", err);
        res.render('users/register', { error_msg: 'Erro interno.', name, email, profession, bio });
    }
});

// --- LOGIN / LOGOUT ---
router.get('/login', (req, res) => {
    res.render('users/login');
});

router.post('/login', loginLimiter, async (req, res, next) => {
    const recaptchaToken = req.body['g-recaptcha-response'];

    if (!recaptchaToken) {
        return res.render('users/login', "Por favor faça o reCAPTCHA para provar que você não é um robô!");
    }

    try {
        const googleResponse = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `secret=${RECAPTCHA_SECRET}&response=${recaptchaToken}`
        });

        const googleData = await googleResponse.json();

        if (!googleData.success) {
            return res.render('users/login', "Falha na validação de segurança (Bot detectado).");
        };

        passport.authenticate('local', {
            successRedirect: '/',
            failureRedirect: '/users/login',
            failureFlash: true
        })(req, res, next);

        if (isUser) {
            
            const token = await new SignJWT({ id: 1, role: 'admin' })
                .setProtectedHeader({ alg: 'HS256' })
                .setIssuedAt()
                .setExpirationTime('2h')
                .sign(JOSE_SECRET_KEY);
    
            res.cookie('auth_token', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production', 
                maxAge: 7200000 
            });
    
            return console.log('Login realizado com sucesso!');
        } else {
            return res.render('users/login', 'Credenciais inválidas');
        };
    } catch (err) {
        res.render('users/login', { error_msg: 'Erro interno.', err});
    }

});

router.get('/logout', (req, res) => {
    req.logout(() => {
        res.redirect('/');
    });

    res.clearCookie('auth_token');
    console.log('Saiu com sucesso.');
});

// --- PERFIL LOGADO ---
router.get('/profile', (req, res) => {
    if (!req.user) {
        req.flash('error_msg', 'Faça login para acessar.');
        return res.redirect('/users/login');
    }
    const userData = JSON.parse(JSON.stringify(req.user));
    res.render('users/profile', { user: userData });
});

// --- EDIÇÃO DE PERFIL ---
router.post('/profile/edit', async (req, res) => {
    try {
        const { name, bio, profession, croppedImage } = req.body;
        const userId = req.user._id;

        let updateData = { name, bio, profession };

        // Se houver algo no croppedImage (URL ou Base64), processa
        if (croppedImage && croppedImage !== "") {
            updateData.profileImage = await uploadToCloudinary(croppedImage);
        }

        await user.findByIdAndUpdate(userId, updateData);
        
        req.flash('success_msg', 'Perfil atualizado com sucesso!');
        res.redirect('/users/profile');
    } catch (err) {
        console.error("Erro ao atualizar perfil:", err);
        req.flash('error_msg', 'Erro ao salvar as alterações.');
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

// --- PERFIL PÚBLICO ---
router.get('/perfil/:id', async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
            req.flash('error_msg', 'ID de usuário inválido.');
            return res.redirect('/');
        }

        const User = mongoose.model('users'); 
        const Chamado = mongoose.model('chamados');
        const Vitrine = mongoose.model('vitrine');

        const usuarioPerfil = await User.findById(req.params.id).lean();

        if (!usuarioPerfil) {
            req.flash('error_msg', 'Este usuário não foi encontrado.');
            return res.redirect('/');
        }

        const vitrinesUsuario = await Vitrine.find({ usuario: req.params.id }).sort({ dataCriacao: -1 }).lean();
        const chamadosDoUsuario = await Chamado.find({ usuario: req.params.id }).sort({ dataCriacao: -1 }).lean();

        const vitrinesEChamados = [...vitrinesUsuario, ...chamadosDoUsuario];
        const totalLikes = chamadosDoUsuario.reduce((acc, curr) => acc + (curr.curtidas ? curr.curtidas.length : 0), 0);

        const eDonoDoPerfil = req.user ? req.params.id === req.user._id.toString() : false;

        res.render('users/userProfile', {
            usuario: req.params.id, 
            user: req.user, 
            eDonoDoPerfil,
            perfil: usuarioPerfil, 
            vitrinesEChamados,
            totalLikes
        });

    } catch (err) {
        console.error("ERRO DETALHADO NO PERFIL:", err);
        req.flash('error_msg', 'Erro interno ao carregar o perfil.');
        res.redirect('/');
    }
});

export default router;