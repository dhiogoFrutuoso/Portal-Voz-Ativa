import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import passport from "passport";
import { v2 as cloudinary } from "cloudinary";
import rateLimit from "express-rate-limit";
import "dotenv/config";
import "../models/user.js";
import "../models/vitrine.js";
import "../models/categories.js";
import "../models/denuncias.js";
import isUser from "../helpers/isUser.js";
import {
  registroSchema,
  loginSchema,
  perfilSchema,
  trocaDeSenhaSchema,
  validarImagemBase64,
  primeiraMensagem,
  todasAsMensagens,
} from "../helpers/validators.js";

const user = mongoose.model("users");
const router = express.Router();
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;

// --- RATE LIMIT ---

// Força bruta no login: 5 tentativas por IP a cada 15 minutos. Requisições bem
// sucedidas não entram na conta, então quem acerta a senha não é penalizado.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skipSuccessfulRequests: true,
  message: "Muitas tentativas de login. Aguarde 15 minutos e tente novamente.",
  standardHeaders: true,
  legacyHeaders: false,
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: "Muitas contas criadas a partir deste endereço. Tente novamente mais tarde.",
  standardHeaders: true,
  legacyHeaders: false,
});

// Cobre troca de senha e exclusão de conta — ações sensíveis que conferem senha.
const contaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Muitas tentativas nesta operação. Aguarde alguns minutos.",
  standardHeaders: true,
  legacyHeaders: false,
});

// --- CONFIGURAÇÃO DO CLOUDINARY ---
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// --- FUNÇÃO AUXILIAR PARA SUBIR PARA O CLOUDINARY ---
// Só sobe para o Cloudinary o que passou pela checagem de mime, assinatura
// binária (magic numbers) e tamanho. A transformação reencoda a imagem, o que
// descarta metadados EXIF — inclusive a localização GPS embutida pela câmera.
const uploadToCloudinary = async (imageInput) => {
  const checagem = validarImagemBase64(imageInput);

  if (checagem.erro) {
    throw new Error(checagem.erro);
  }

  if (checagem.vazio) {
    return "/img/guest.webp";
  }

  if (checagem.url) {
    return checagem.url;
  }

  try {
    const result = await cloudinary.uploader.upload(checagem.base64, {
      folder: "img_users",
      resource_type: "image",
      allowed_formats: ["png", "jpg", "jpeg", "webp"],
      format: "webp", // Guarda já convertido, no formato mais leve
      transformation: [
        { width: 500, height: 500, crop: "fill", gravity: "face", quality: "auto" },
      ],
    });
    return result.secure_url;
  } catch (error) {
    console.error("Erro no Cloudinary Backend:", error);
    throw new Error("Não foi possível processar a imagem enviada.");
  }
};

// --- ROTAS DE REGISTRO ---
router.get("/register", (req, res) => {
  res.render("users/register");
});

router.post("/register", registerLimiter, async (req, res) => {
  const { name, email, profession, bio, croppedImage } = req.body;
  const token = req.body["g-recaptcha-response"];

  if (!token) {
    return res.render("users/register", {
      error_msg: "Por favor, complete o reCAPTCHA para prosseguir.",
      name,
      email,
      profession,
      bio,
    });
  }

  try {
    const params = new URLSearchParams();
    params.append("secret", RECAPTCHA_SECRET || "");
    params.append("response", token);

    const response = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );

    const googleData = await response.json();

    if (!googleData.success) {
      console.warn("reCAPTCHA falhou no registro:", googleData["error-codes"]);
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
    const userExists = await user.findOne({ email: dados.email });
    if (userExists) {
      return res.render("users/register", {
        error_msg: "Já existe uma conta com este e-mail.",
        name,
        email,
        profession,
        bio,
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

    req.flash("success_msg", "Usuário criado com sucesso!");
    res.redirect("/users/login");
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
      error_msg: "Por favor faça o reCAPTCHA para provar que você não é um robô!",
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
    const params = new URLSearchParams();
    params.append("secret", RECAPTCHA_SECRET || "");
    params.append("response", recaptchaToken);

    const googleResponse = await fetch(
      "https://www.google.com/recaptcha/api/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      },
    );

    const googleData = await googleResponse.json();

    if (!googleData.success) {
      console.warn("reCAPTCHA falhou no login:", googleData["error-codes"]);
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

    const salt = await bcrypt.genSalt(12);
    usuario.password = await bcrypt.hash(newPassword, salt);

    await usuario.save();
    req.flash("success_msg", "Senha alterada com sucesso!");
    res.redirect("/users/profile");
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
      .select("-password")
      .lean();

    if (!usuarioPerfil) {
      return res.render("users/perfil-indisponivel", {
        user: req.user
      });
    }

    const vitrinesUsuario = await Vitrine.find({ usuario: req.params.id })
      .sort({ dataCriacao: -1 })
      .lean();
    const chamadosDoUsuario = await Chamado.find({ usuario: req.params.id })
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
