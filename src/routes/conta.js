import express from 'express';
import { waitUntil } from '@vercel/functions';
import { limitarRequisicoes } from '../config/rate-limit.js';
import { emitirOtp, consumirOtp, normalizarEmail, emailValido, envioOtpConfigurado } from '../helpers/otp.js';
const router = express.Router();
const limiter = limitarRequisicoes('otp', { windowMs: 15 * 60000, max: 10 });
const validacao = limitarRequisicoes('otp-validar', { windowMs: 15 * 60000, max: 25 });
const generic = 'Se houver uma conta para este e-mail, você receberá um código de recuperação. Confira também a caixa de spam.';
const unavailable = 'O envio de códigos está temporariamente indisponível. Tente novamente mais tarde.';
const render = (res, purpose, extra = {}) => res.render('users/otp', { reset: purpose === 'reset', ...extra });
function cadastroPendente(req, res, next) {
    if (!emailValido(req.session.registrationEmail)) return res.redirect('/users/register');
    next();
}
function agendarRecuperacao(email) {
    const work = emitirOtp(email, 'reset').catch(() => console.error('Falha no envio do código de recuperação.'));
    if (process.env.VERCEL) waitUntil(work);
}
router.get('/verificar-email', cadastroPendente, (req, res) => {
    const erro = req.session.registrationError;
    delete req.session.registrationError;
    render(res, 'verify', { email: req.session.registrationEmail, erro });
});
router.get('/redefinir-senha', (req, res) => {
    if (!req.session.recoveryEmail) return res.redirect('/esqueci-senha');
    render(res, 'reset', { email: req.session.recoveryEmail });
});
router.get('/esqueci-senha', (req, res) => res.render('users/esqueci-senha'));
router.post('/esqueci-senha', limiter, (req, res) => {
    const email = normalizarEmail(req.body.email);
    if (!emailValido(email) || req.body.website) return res.status(400).render('users/esqueci-senha', { email, erro: 'Informe um e-mail válido.' });
    if (!envioOtpConfigurado()) return res.status(503).render('users/esqueci-senha', { email, erro: unavailable });
    req.session.recoveryEmail = email;
    agendarRecuperacao(email);
    return render(res, 'reset', { email, mensagem: generic });
});
for (const [route, purpose] of [['/verificar-email', 'verify'], ['/redefinir-senha', 'reset']]) {
    const guard = purpose === 'verify' ? cadastroPendente : (_req, _res, next) => next();
    router.post(route + '/reenviar', limiter, guard, async (req, res) => {
        const email = purpose === 'verify' ? req.session.registrationEmail : normalizarEmail(req.body.email);
        if (!emailValido(email) || req.body.website) return render(res.status(400), purpose, { email, erro: 'Informe um e-mail válido.' });
        if (!envioOtpConfigurado()) return render(res.status(503), purpose, { email, erro: unavailable });
        if (purpose === 'verify') {
            try { await emitirOtp(email, purpose); }
            catch { return render(res.status(503), purpose, { email, erro: unavailable }); }
        } else {
            req.session.recoveryEmail = email;
            agendarRecuperacao(email);
        }
        render(res, purpose, { email, mensagem: purpose === 'verify' ? 'Código solicitado. Confira seu e-mail. Se acabou de pedir outro, aguarde 60 segundos.' : generic });
    });
    router.post(route, validacao, guard, async (req, res) => {
        const email = purpose === 'verify' ? req.session.registrationEmail : normalizarEmail(req.body.email);
        const code = typeof req.body.code === 'string' ? req.body.code : '';
        const password = req.body.password;
        if (!emailValido(email) || req.body.website || !/^\d{6}$/.test(code)) {
            return render(res.status(400), purpose, { email, erro: 'Confira o e-mail e digite os seis números do código.' });
        }
        if (purpose === 'reset' && (typeof password !== 'string' || password.length < 8 ||
            Buffer.byteLength(password) > 72 || password !== req.body.password_2)) {
            return render(res.status(400), purpose, { email, erro: 'As senhas devem ser iguais, com pelo menos 8 caracteres e no máximo 72 bytes.' });
        }
        try {
            if (await consumirOtp(email, purpose, code, password)) {
                return req.session.regenerate((error) => {
                    if (error) return res.redirect('/users/login');
                    req.flash('success_msg', purpose === 'verify' ? 'Cadastro confirmado! Entre com seu e-mail e senha.' : 'Senha alterada! Entre com sua nova senha.');
                    res.redirect('/users/login');
                });
            }
        } catch { console.error('Falha na validação do código.'); }
        render(res.status(400), purpose, { email, erro: 'Código inválido, expirado ou já utilizado. Solicite outro se necessário.' });
    });
}
export default router;
// [Melhoria Proativa Adicionada: confirmação restrita ao cadastro, recuperação independente e falhas de configuração visíveis]
