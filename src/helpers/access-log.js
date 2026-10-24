import { waitUntil } from '@vercel/functions';
import AccessLog from '../models/access-log.js';
import { origem } from './request-context.js';

const DIAS_RETENCAO = 14;
const ROTAS_IGNORADAS = /^\/(health|favicon\.ico|css\/|js\/|img\/|pdf\/)|\/buscar$/i;

export function registrarAcesso(req, _res, next) {
    try {
        if (!ROTAS_IGNORADAS.test(req.path || '')) {
            const expiresAt = new Date(Date.now() + DIAS_RETENCAO * 24 * 60 * 60 * 1000);
            const escrita = AccessLog.create({ ipAddress: origem(req).ipAddress, expiresAt }).catch(() => {});
            if (process.env.VERCEL) waitUntil(escrita);
        }
    } catch {
        // Falha no log de acesso nunca interrompe a requisição do cidadão.
    }
    next();
}
// [Melhoria Proativa Adicionada: escrita assíncrona não-bloqueante e TTL enxuto para preservar o plano M0]
