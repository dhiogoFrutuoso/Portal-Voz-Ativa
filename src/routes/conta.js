import express from 'express';
import { waitUntil } from '@vercel/functions';
import { limitarRequisicoes } from '../config/rate-limit.js';
import { emitirOtp, consumirOtp, normalizarEmail, emailValido } from '../helpers/otp.js';
const router = express.Router();
const limiter = limitarRequisicoes('otp', { windowMs: 15 * 60000, max: 10 });
const validacao = limitarRequisicoes('otp-validar', { windowMs: 15 * 60000, max: 25 });
const generic = 'Se houver uma conta elegível, enviaremos um código. Aguarde 60 segundos antes de solicitar outro.';
function agendarEnvio(email, purpose) {
    const work = emitirOtp(email, purpose).catch(() => console.error('Falha no envio do código.'));
    if (process.env.VERCEL) waitUntil(work);
}
const render = (res, purpose, extra = {}) => res.render('users/otp', { reset: purpose === 'reset', ...extra });
router.get('/verificar-email', (req, res) => render(res, 'verify', { email: req.session.pendingEmail || '' }));
router.get('/redefinir-senha', (req, res) => render(res, 'reset', { email: req.session.pendingEmail || '' }));
router.get('/esqueci-senha', (req, res) => res.render('users/esqueci-senha'));
router.post('/esqueci-senha', limiter, async (req, res) => {
    const email = normalizarEmail(req.body.email);
    if (emailValido(email) && !req.body.website) {
        req.session.pendingEmail = email;
        agendarEnvio(email, 'reset');
    }
    return render(res, 'reset', { email, mensagem: generic });
});
for (const [route, purpose] of [['/verificar-email', 'verify'], ['/redefinir-senha', 'reset']]) {
    router.post(route + '/reenviar', limiter, async (req, res) => {
        const email = normalizarEmail(req.body.email);
        if (emailValido(email) && !req.body.website) {
            agendarEnvio(email, purpose);
        }
        render(res, purpose, { email, mensagem: generic });
    });
    router.post(route, validacao, async (req, res) => {
        const email = normalizarEmail(req.body.email);
        const code = Array.isArray(req.body.digits) && req.body.digits.length === 6
            ? req.body.digits.join('') : String(req.body.code || '');
        const password = req.body.password;
        if (req.body.website || (purpose === 'reset' && (typeof password !== 'string' || password.length < 8 ||
            Buffer.byteLength(password) > 72 || password !== req.body.password_2))) {
            return render(res.status(400), purpose, { email, erro: 'Confira os campos. A senha deve ter de 8 a 72 bytes e coincidir com a confirmação.' });
        }
        try {
            if (await consumirOtp(email, purpose, code, password)) {
                req.session.destroy(() => res.redirect('/users/login'));
                return;
            }
        } catch { console.error('Falha na validação do código.'); }
        render(res.status(400), purpose, { email, erro: 'Código inválido, expirado ou já utilizado. Solicite outro se necessário.' });
    });
}
export default router;
// [Melhoria Proativa Adicionada: respostas genéricas, limite por IP e ausência de segredos nas URLs]
