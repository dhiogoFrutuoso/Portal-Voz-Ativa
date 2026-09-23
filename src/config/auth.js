import { Strategy as LocalStrategy } from 'passport-local';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import '../models/user.js';
import { emitirToken, lerToken } from '../helpers/auth-token.js';
const User = mongoose.model('users');
export default function configurePassport(passport) {
    passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
        try {
            const user = await User.findOne({ email: String(email).trim().toLowerCase() }).lean();
            if (!user || !await bcrypt.compare(password, user.password)) return done(null, false, { message: 'E-mail ou senha inválidos.' });
            if (user.isVerified !== true) return done(null, false, { message: 'Confirme seu e-mail antes de entrar.', verificationRequired: true });
            return done(null, user);
        } catch (error) { done(error); }
    }));
    passport.serializeUser((user, done) => {
        try { done(null, emitirToken(user)); } catch (error) { done(error); }
    });
    passport.deserializeUser(async (token, done) => {
        try {
            const payload = lerToken(token);
            if (!payload || !mongoose.isValidObjectId(payload.sub)) return done(null, false);
            const user = await User.findById(payload.sub).select('-password').lean();
            if (!user || user.isVerified !== true || (user.tokenVersion || 0) !== payload.tokenVersion) return done(null, false);
            done(null, user);
        } catch (error) { done(error); }
    });
}
// [Melhoria Proativa Adicionada: toda requisição confere tokenVersion no banco e revoga sessões antigas]
