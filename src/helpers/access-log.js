import AccessLog from '../models/access-log.js';
import { origem } from './request-context.js';
export async function registrarAcesso(req, res, next) {
    try {
        const expiresAt = new Date();
        expiresAt.setUTCMonth(expiresAt.getUTCMonth() + 6);
        await AccessLog.create({ ipAddress: origem(req).ipAddress, expiresAt });
        next();
    } catch { res.status(503).send('Serviço temporariamente indisponível.'); }
}
// [Melhoria Proativa Adicionada: retenção de seis meses por TTL sem coleta de dados desnecessários]
