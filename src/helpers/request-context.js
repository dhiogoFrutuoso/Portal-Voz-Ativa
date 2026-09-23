import { AsyncLocalStorage } from 'node:async_hooks';
import { isIP } from 'node:net';
export const requestContext = new AsyncLocalStorage();
export function origem(req) {
    // req.ip respeita trust proxy; nunca confiar no primeiro X-Forwarded-For livre.
    const ip = req.ip || req.socket?.remoteAddress || '';
    return { ipAddress: isIP(ip) ? ip : '0.0.0.0', userAgent: String(req.get('user-agent') || 'Não informado').slice(0, 512) };
}
export const contexto = (req, res, next) => requestContext.run({ req }, next);
// [Melhoria Proativa Adicionada: contexto isolado por requisição e IP resolvido por proxy confiável]
