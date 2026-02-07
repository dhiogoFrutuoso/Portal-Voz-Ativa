import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import "../models/user.js";

const User = mongoose.model("users");

export default function configurePassport(passportInstance) { //recebe o passport como parâmetro

    passportInstance.use(new LocalStrategy({ usernameField: "email" }, (email, password, done) => { //Configura a estratégia local para verificar o login do usuario com email e senha
        
            User.findOne({ email: email }).lean().then((user) => { //procura o usuario pelo email no banco de dados
                    if (!user) {
                        return done(null, false, { message: "email inválido! essa conta não existe, tente novamente!" }); //se não encontrar, retorna uma mensagem de erro
                    };

                    bcrypt.compare(password, user.password, (err, isMatch) => { //compara a senha digitada com a senha do banco de dados
                        if (err) return done(err);

                        if (isMatch) { //se a senha estiver correta
                            return done(null, user); //retorna o usuario
                        } else {//se a senha estiver incorreta
                            return done(null, false, { message: "senha incorreta, tente novamente!" }); //retorna uma mensagem de erro
                        };
                    });
                }).catch((err) => done(err));
        })
    );

    passportInstance.serializeUser((user, done) => { //Salva o ID do usuario na sessão, tipo um cookie, armazena que o usuario esta logado
        done(null, user._id);
    });

    passportInstance.deserializeUser((id, done) => { //Recupera o usuario pelo ID salvo na sessão, para manter o usuario logado.
        User.findById(id).lean().then((user) => { //Busca o usuario no banco de dados pelo ID
            done(null, user); //retorna o usuario
        }).catch((err) => done(err));
    });
};