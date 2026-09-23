import { emitirOtp, envioOtpConfigurado } from '../helpers/otp.js';
import { aceito, VERSAO_TERMOS } from '../helpers/governanca.js';
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import passport from "passport";
import { limitarRequisicoes } from '../config/rate-limit.js';
import "dotenv/config";
import "../models/user.js";
import "../models/vitrine.js";
import "../models/categories.js";
import "../models/denuncias.js";
import isUser from "../helpers/isUser.js";
import { verificarRecaptcha } from '../helpers/recaptcha.js';
import {
  registroSchema,
  loginSchema,
  perfilSchema,
  trocaDeSenhaSchema,
  primeiraMensagem,
  todasAsMensagens,
} from "../helpers/validators.js";

const user = mongoose.model("users");
const router = express.Router();

// --- RATE LIMIT ---

// Força bruta no login: 5 tentativas por IP a cada 15 minutos. Requisições bem
// sucedidas não entram na conta, então quem acerta a senha não é penalizado.
const loginLimiter = limitarRequisicoes('login', {
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (_req, res) => res.statusCode === 302 && res.getHeader('location') === '/',
  message: "Muitas tentativas de login. Aguarde 15 minutos e tente novamente.",
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = limitarRequisicoes('cadastro', {
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Muitas contas criadas a partir deste endereço. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Cobre troca de senha e exclusão de conta — ações sensíveis que conferem senha.
const contaLimiter = limitarRequisicoes('conta', {
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas nesta operação. Aguarde alguns minutos.",
  standardHeaders: true,
  legacyHeaders: false,
});

// URLs aceitas já passaram pela inspeção e pelo recibo de upload no middleware.
const uploadToCloudinary = async (imageInput) => {
  if (!imageInput) return '/img/guest.webp';
  if (typeof imageInput !== 'string' || !imageInput.startsWith('https://res.cloudinary.com/')) throw new Error('Use o seletor de foto.');
  return imageInput;
};

// --- ROTAS DE REGISTRO ---
router.get("/register", (req, res) => {
  res.render("users/register");
});

router.post("/register", registerLimiter, async (req, res) => {
  if (!aceito(req.body.acceptTerms) || req.body.website) return res.status(400).send('Aceite os termos de uso para criar sua conta.');
  const { name, email, profession, bio, croppedImage } = req.body;
  const token = req.body["g-recaptcha-response"];

  if (!token) {
    return res.render("users/register", {
      error_msg: "Não foi possível verificar a segurança. Recarregue a página e tente novamente.",
      name,
      email,
      profession,
      bio,
    });
  }

  try {
    if (!await verificarRecaptcha(token, 'register')) {
      return res.render("users/register", {
        error_msg: "Falha na validação de segurança do reCAPTCHA.",
        name,
        email,
        profession,
        bio,
      });
    }
  } catch (error) {
    console.error("Erro ao validar reCAPTCHA:", error);
    return res.render("users/register", {
      error_msg: "Erro ao validar o reCAPTCHA. Tente novamente.",
      name,
      email,
      profession,
      bio,
    });
  }

  // Validação de esquema: formato, tamanho e limpeza de HTML dos campos livres.
  const validacao = registroSchema.safeParse(req.body);

  if (!validacao.success) {
    return res.render("users/register", {
      errors: todasAsMensagens(validacao.error),
      name,
      email,
      profession,
      bio,
    });
  }

  const dados = validacao.data;

  try {
    const userExists = await user.findOne({ email: dados.email }).lean();
    if (userExists?.isVerified === false && await bcrypt.compare(dados.password, userExists.password)) {
      req.session.registrationEmail = dados.email;
      try { await emitirOtp(dados.email, 'verify'); }
      catch { req.session.registrationError = 'Não foi possível enviar o código agora. Tente reenviar em alguns instantes.'; }
      return res.redirect('/verificar-email');
    }
    if (userExists) {
      return res.render("users/register", {
        error_msg: "Já existe uma conta com este e-mail.",
        name,
        email,
        profession,
        bio,
      });
    }

    if (!envioOtpConfigurado()) {
      return res.status(503).render("users/register", {
        error_msg: "O cadastro está temporariamente indisponível. Tente novamente mais tarde.",
        name, email, profession, bio,
      });
    }

    let profileImageUrl;
    try {
      profileImageUrl = await uploadToCloudinary(croppedImage);
    } catch (erroImagem) {
      return res.render("users/register", {
        error_msg: erroImagem.message,
        name,
        email,
        profession,
        bio,
      });
    }

    const newUser = new user({
      isVerified: false,
      acceptedTermsAt: new Date(),
      termsVersion: VERSAO_TERMOS,
      name: dados.name,
      email: dados.email,
      password: dados.password,
      profession: dados.profession,
      bio: dados.bio,
      profileImage: profileImageUrl,
    });

    const salt = await bcrypt.genSalt(12);
    newUser.password = await bcrypt.hash(newUser.password, salt);
    await newUser.save();

    req.session.registrationEmail = dados.email;
    try { await emitirOtp(dados.email, 'verify'); } catch { req.session.registrationError = 'Não foi possível enviar o código agora. Tente reenviar em alguns instantes.'; }
    res.redirect('/verificar-email');
  } catch (err) {
    console.error("Erro no Registro:", err);
    res.render("users/register", {
      error_msg: "Erro interno no cadastro.",
      name,
      email,
      profession,
      bio,
    });
  }
});

// --- LOGIN / LOGOUT ---
router.get("/login", (req, res) => {
  res.render("users/login");
});

router.post("/login", loginLimiter, async (req, res, next) => {
  const recaptchaToken = req.body["g-recaptcha-response"];

  if (!recaptchaToken) {
    return res.render("users/login", {
      error_msg: "Não foi possível verificar a segurança. Recarregue a página e tente novamente.",
    });
  }

  // Garante que email e senha sejam strings de formato conhecido: sem isso um
  // objeto como {"$gt": ""} poderia chegar ao findOne do Mongo.
  const credenciais = loginSchema.safeParse(req.body);

  if (!credenciais.success) {
    return res.render("users/login", {
      error_msg: primeiraMensagem(credenciais.error),
    });
  }

  req.body.email = credenciais.data.email;
  req.body.password = credenciais.data.password;

  try {
    if (!await verificarRecaptcha(recaptchaToken, 'login')) {
      return res.render("users/login", {
        error_msg: "Falha na validação de segurança (reCAPTCHA inválido).",
      });
    }

    passport.authenticate("local", (err, user, info) => {
      if (err) {
        console.error("Erro no passport.authenticate:", err);
        return res.render("users/login", {
          error_msg: "Erro interno ao autenticar usuário.",
        });
      }

      if (!user) {
        return res.render("users/login", {
          error_msg: info && info.message ? info.message : "Credenciais inválidas.",
        });
      }

      // Regenera a sessão no login para evitar fixação de sessão: o ID que o
      // visitante trouxe é descartado e um novo é emitido já autenticado.
      req.session.regenerate((erroSessao) => {
        if (erroSessao) {
          console.error("Erro ao regenerar a sessão:", erroSessao);
          return res.render("users/login", {
            error_msg: "Erro ao iniciar a sessão.",
          });
        }

        req.logIn(user, (err) => {
          if (err) {
            console.error("Erro no req.logIn:", err);
            return res.render("users/login", {
              error_msg: "Erro ao iniciar a sessão.",
            });
          }

          req.flash("success_msg", "Login realizado com sucesso!");
          return res.redirect("/");
        });
      });
    })(req, res, next);
  } catch (err) {
    console.error("Erro no login:", err);
    return res.render("users/login", { error_msg: "Erro interno no servidor." });
  }
});

router.get("/logout", (req, res) => {
  req.logout(() => {
    req.flash("success_msg", "Desconectado com sucesso!");
    res.redirect("/");
  });
});

// --- PERFIL LOGADO ---
router.get("/profile", isUser, (req, res) => {
  const userData = JSON.parse(JSON.stringify(req.user));
  delete userData.password; // O hash nunca deve chegar ao template
  res.render("users/profile", { user: userData });
});

// --- EDIÇÃO DE PERFIL ---
router.post("/profile/edit", isUser, async (req, res) => {
  try {
    const { croppedImage } = req.body;
    const userId = req.user._id;

    const validacao = perfilSchema.safeParse(req.body);
    if (!validacao.success) {
      req.flash("error_msg", primeiraMensagem(validacao.error));
      return res.redirect("/users/profile");
    }

    const updateData = { ...validacao.data };

    // Se houver algo no croppedImage (URL ou Base64), processa
    if (croppedImage && croppedImage !== "") {
      updateData.profileImage = await uploadToCloudinary(croppedImage);
    }

    await user.findByIdAndUpdate(userId, updateData, { runValidators: true });

    req.flash("success_msg", "Perfil atualizado com sucesso!");
    res.redirect("/users/profile");
  } catch (err) {
    console.error("Erro ao atualizar perfil:", err);
    req.flash("error_msg", "Erro ao salvar as alterações.");
    res.redirect("/users/profile");
  }
});

// --- TROCA DE SENHA ---
router.post("/profile/change-password", isUser, contaLimiter, async (req, res) => {
  const validacao = trocaDeSenhaSchema.safeParse(req.body);

  if (!validacao.success) {
    req.flash("error_msg", primeiraMensagem(validacao.error));
    return res.redirect("/users/profile");
  }

  const { oldPassword, newPassword } = validacao.data;

  try {
    const usuario = await user.findById(req.user._id);
    const match = await bcrypt.compare(oldPassword, usuario.password);

    if (!match) {
      req.flash("error_msg", "Senha atual incorreta.");
      return res.redirect("/users/profile");
    }

    const hashAnterior = usuario.password;
    const salt = await bcrypt.genSalt(12);
    usuario.password = await bcrypt.hash(newPassword, salt);

    const alterado = await user.updateOne({ _id: usuario._id, password: hashAnterior }, { $set: { password: usuario.password }, $inc: { tokenVersion: 1 } });
    if (alterado.modifiedCount !== 1) throw new Error('Senha alterada em outra sessão.');
    req.session.destroy(() => res.redirect('/users/login'));
  } catch (err) {
    console.error(err);
    req.flash("error_msg", "Erro interno ao mudar senha.");
    res.redirect("/users/profile");
  }
});

// --- EXCLUSÃO DE CONTA PELO PRÓPRIO USUÁRIO ---
router.post("/profile/delete", isUser, contaLimiter, async (req, res) => {
  const { confirmPassword } = req.body;
  const userId = req.user._id;

  try {
    const usuario = await user.findById(userId);
    if (!usuario) {
      req.flash("error_msg", "Usuário não encontrado.");
      return res.redirect("/");
    }

    // A confirmação por senha é obrigatória: exclusão é irreversível.
    if (typeof confirmPassword !== "string" || confirmPassword === "") {
      req.flash("error_msg", "Confirme sua senha para excluir a conta.");
      return res.redirect("/users/profile");
    }

    const isMatch = await bcrypt.compare(confirmPassword, usuario.password);
    if (!isMatch) {
      req.flash("error_msg", "Senha incorreta! Não foi possível confirmar a exclusão da conta.");
      return res.redirect("/users/profile");
    }

    const Chamado = mongoose.models.chamados || mongoose.model("chamados");
    const Vitrine = mongoose.models.vitrine || mongoose.model("vitrine");
    const Denuncia = mongoose.models.denuncias || mongoose.model("denuncias");

    await Promise.all([
      user.findByIdAndDelete(userId),
      Chamado.deleteMany({ usuario: userId }),
      Vitrine.deleteMany({ usuario: userId }),
      Chamado.updateMany({}, { $pull: { curtidas: userId, comentarios: { usuario: userId } } }),
      Vitrine.updateMany({}, { $pull: { curtidas: userId, comentarios: { usuario: userId } } }),
      Denuncia.updateMany({}, { $pull: { curtidas: userId, comentarios: { usuario: userId } } }),
    ]);

    req.logout((err) => {
      if (err) console.error("Erro no logout ao excluir conta:", err);
      req.flash("success_msg", "Sua conta e seus dados foram excluídos com sucesso.");
      res.redirect("/");
    });
  } catch (err) {
    console.error("Erro ao excluir conta:", err);
    req.flash("error_msg", "Erro interno ao excluir sua conta.");
    res.redirect("/users/profile");
  }
});

// --- PERFIL PÚBLICO ---
router.get("/perfil/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.render("users/perfil-indisponivel", {
        user: req.user
      });
    }

    const User = mongoose.model("users");
    const Chamado = mongoose.model("chamados");
    const Vitrine = mongoose.model("vitrine");

    const usuarioPerfil = await User.findById(req.params.id)
      .select("name profession bio profileImage date")
      .lean();

    if (!usuarioPerfil) {
      return res.render("users/perfil-indisponivel", {
        user: req.user
      });
    }

    const vitrinesUsuario = await Vitrine.find({ usuario: req.params.id, isConfidential: { $ne: true } })
      .sort({ dataCriacao: -1 })
      .lean();
    const chamadosDoUsuario = await Chamado.find({ usuario: req.params.id, isConfidential: { $ne: true } })
      .sort({ dataCriacao: -1 })
      .lean();

    const vitrinesEChamados = [...vitrinesUsuario, ...chamadosDoUsuario];
    const totalLikes = chamadosDoUsuario.reduce(
      (acc, curr) => acc + (curr.curtidas ? curr.curtidas.length : 0),
      0,
    );

    const eDonoDoPerfil = req.user
      ? req.params.id === req.user._id.toString()
      : false;

    res.render("users/userProfile", {
      usuario: req.params.id,
      user: req.user,
      eDonoDoPerfil,
      perfil: usuarioPerfil,
      vitrinesEChamados,
      totalLikes,
    });
  } catch (err) {
    console.error("ERRO DETALHADO NO PERFIL:", err);
    req.flash("error_msg", "Erro interno ao carregar o perfil.");
    res.redirect("/");
  }
});

export default router;
// [Melhoria Proativa Adicionada: validações e integrações de governança aplicadas ao fluxo existente]
