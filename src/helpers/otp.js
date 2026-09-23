import { randomInt, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { Resend } from 'resend';
import Otp from '../models/otp.js';
const digest = (value) => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres.');
    return createHmac('sha256', process.env.JWT_SECRET).update(value).digest('hex');
};
const chave = (email, purpose) => digest(`${purpose}:${email}`);
export const emailValido = (email) => typeof email === 'string' && email.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
export const normalizarEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const envioOtpConfigurado = () => {
    if (!process.env.RESEND_API_KEY?.trim() || !process.env.EMAIL_REMETENTE?.trim()) return false;
    try { const url = new URL(process.env.URL_PUBLICA); return url.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && url.protocol === 'http:'); }
    catch { return false; }
};
export async function emitirOtp(email, purpose) {
    if (!envioOtpConfigurado()) throw new Error('Envio de e-mail indisponível.');
    if (!emailValido(email) || !['verify', 'reset'].includes(purpose)) return;
    const now = new Date();
    const id = chave(email, purpose);
    const user = await mongoose.model('users').findOne({ email }).select('_id isVerified tokenVersion').lean();
    if (!user || (purpose === 'verify' && user.isVerified !== false) || (purpose === 'reset' && user.isVerified === false)) return;
    const code = String(randomInt(100000, 1000000));
    const codeHash = digest(`${id}:${code}`);
    // Upsert com _id único garante cooldown mesmo em instâncias concorrentes.
    try {
        await Otp.findOneAndUpdate({ _id: id, issuedAt: { $lte: new Date(+now - 60000) } }, {
            $set: { userId: user?._id || null, purpose, codeHash, attempts: 0,
                version: user?.tokenVersion || 0, issuedAt: now, expiresAt: new Date(+now + 10 * 60000) }
        }, { upsert: true });
    } catch (error) { if (error.code === 11000) return; throw error; }
    const base = new URL(process.env.URL_PUBLICA);
    if (base.protocol !== 'https:' && process.env.NODE_ENV === 'production') throw new Error('URL pública inválida.');
    const link = new URL(purpose === 'verify' ? '/verificar-email' : '/redefinir-senha', base).href;
    const title = purpose === 'verify' ? 'Confirme seu e-mail' : 'Redefina sua senha';
    try {
        const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
            from: process.env.EMAIL_REMETENTE, to: email, subject: `${title} — Portal Voz Ativa`,
            text: `${title}. Seu código é ${code}. Válido por 10 minutos. Não compartilhe. ${link}. Se não solicitou, ignore.`,
            html: `<html lang="pt-br"><body style="margin:0;background:#f4f6f9;font-family:Arial,sans-serif;color:#13315c"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px"><table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px"><tr><td style="padding:32px"><h1 style="font-size:24px;color:#13315c">Portal Voz Ativa</h1><h2>${title}</h2><p>Use o código abaixo. Ele expira em 10 minutos e permite até cinco tentativas.</p><p style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#198754;text-align:center">${code}</p><p><a href="${escape(link)}" style="color:#13315c">Continuar no portal</a></p><p>Não compartilhe este código. Se você não fez esta solicitação, ignore a mensagem.</p></td></tr></table></td></tr></table></body></html>`
        }, { idempotencyKey: `otp-${randomUUID()}` });
        if (result.error) throw new Error('Não foi possível entregar o código.');
    } catch (error) {
        // Libera nova tentativa se o provedor falhar; nunca apaga um código concorrente.
        await Otp.deleteOne({ _id: id, issuedAt: now, codeHash });
        throw error;
    }
}
export async function consumirOtp(email, purpose, code, password) {
    if (!emailValido(email) || !/^\d{6}$/.test(code || '')) return false;
    const id = chave(email, purpose);
    const hash = digest(`${id}:${code}`);
    // Toda tentativa é reservada atomicamente, inclusive sob concorrência.
    const attempt = await Otp.findOneAndUpdate({ _id: id, expiresAt: { $gt: new Date() }, attempts: { $lt: 5 } },
        { $inc: { attempts: 1 } }, { new: true }).select('+codeHash').lean();
    if (!attempt || !attempt.userId || typeof attempt.codeHash !== 'string' || attempt.codeHash.length !== hash.length ||
        !timingSafeEqual(Buffer.from(attempt.codeHash), Buffer.from(hash))) return false;
    const newHash = purpose === 'reset' ? await bcrypt.hash(password, 12) : null;
    let success = false;
    await mongoose.connection.transaction(async (session) => {
        success = false;
        const claimed = await Otp.findOneAndDelete({ _id: id, codeHash: hash, issuedAt: attempt.issuedAt,
            attempts: { $lte: 5 }, expiresAt: { $gt: new Date() } }, { session });
        if (!claimed) return;
        const update = purpose === 'verify' ? { $set: { isVerified: true } }
            : { $set: { password: newHash }, $inc: { tokenVersion: 1 } };
        const result = await mongoose.model('users').updateOne({ _id: attempt.userId,
            $or: [{ tokenVersion: attempt.version }, ...(attempt.version === 0 ? [{ tokenVersion: { $exists: false } }] : [])] }, update, { session });
        success = result.modifiedCount === 1;
        if (success) await Otp.deleteMany({ userId: attempt.userId }, { session });
    });
    return success;
}
// [Melhoria Proativa Adicionada: HMAC impede força bruta offline do OTP e transação impede reutilização concorrente]
