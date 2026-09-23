import { createHmac, timingSafeEqual } from 'node:crypto';
const sign = (text) => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET inválido.');
    return createHmac('sha256', process.env.JWT_SECRET).update(text).digest('base64url');
};
export function emitirToken(user) {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const message = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: String(user._id), tokenVersion: user.tokenVersion || 0,
        iat: now, exp: now + 7 * 86400, iss: 'portal-voz-ativa', aud: 'sessao-web' })}`;
    return `${message}.${sign(message)}`;
}
export function lerToken(token) {
    try {
        if (typeof token !== 'string' || token.length > 2048) return null;
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const expected = Buffer.from(sign(parts.slice(0, 2).join('.')));
        const provided = Buffer.from(parts[2]);
        if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
        const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
        if (header.alg !== 'HS256' || payload.iss !== 'portal-voz-ativa' || payload.aud !== 'sessao-web' ||
            !Number.isInteger(payload.exp) || payload.exp <= Date.now() / 1000 || !Number.isInteger(payload.tokenVersion)) return null;
        return payload;
    } catch { return null; }
}
// [Melhoria Proativa Adicionada: algoritmo fixo, expiração e versão validada sem JWT exposto ao JavaScript]
