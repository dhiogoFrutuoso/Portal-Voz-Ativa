import { origem } from './request-context.js';
import { auditPlugin } from './audit-plugin.js';
export const VERSAO_TERMOS = '2026-09-23';
export const aceito = (value) => value === true || value === 'true' || value === 'on' || value === '1';
export function evidenciaPublicacao(req, res, next) {
    if (!aceito(req.body.declaredAccuracy) || req.body.website) {
        return res.status(400).send('Confirme a declaração de veracidade para enviar a publicação.');
    }
    const origin = origem(req);
    req.evidencia = { declaredAccuracy: true, acceptedTermsAt: new Date(), termsVersion: VERSAO_TERMOS,
        authorIpAddress: origin.ipAddress, authorUserAgent: origin.userAgent,
        isConfidential: aceito(req.body.isConfidential) };
    next();
}
export function governancaPlugin(schema) {
    // Documentos antigos não recebem uma declaração retroativa que nunca existiu.
    schema.add({
        declaredAccuracy: { type: Boolean, required: function () { return this.isNew; }, immutable: true,
            validate: { validator: (v) => v === true || v === undefined, message: 'Declaração obrigatória.' } },
        acceptedTermsAt: { type: Date, default: function () { return this.isNew ? new Date() : undefined; }, immutable: true },
        termsVersion: { type: String, immutable: true },
        authorIpAddress: { type: String, required: function () { return this.isNew; }, immutable: true, select: false },
        authorUserAgent: { type: String, required: function () { return this.isNew; }, immutable: true, select: false },
        isConfidential: { type: Boolean, default: false, immutable: true }
    });
    auditPlugin(schema);
}
const protectedAuthor = { _id: null, name: 'Cidadão Protegido', profileImage: '/img/guest.webp', profession: 'Identidade protegida', anonimo: true };
function limparSaida(value, inherited = false) {
    if (!value || typeof value !== 'object' || value instanceof Date || value._bsontype) return value;
    if (Array.isArray(value)) return value.map((item) => limparSaida(item, inherited));
    const source = typeof value.toObject === 'function' ? value.toObject() : value;
    const privateReport = source.tipoOcorrencia && (source.privada === true ||
        (source.privada === undefined && source.tipoOcorrencia !== 'Foco de Queimada'));
    const confidential = inherited || source.isConfidential === true || Boolean(privateReport);
    const result = {};
    for (const [key, item] of Object.entries(source)) {
        if (['authorIpAddress', 'authorUserAgent', 'password', 'codeHash'].includes(key)) continue;
        if (confidential && ['usuario', 'autor'].includes(key)) result[key] = { ...protectedAuthor };
        else if (confidential && key === 'curtidas') result[key] = Array.isArray(item) ? item.map(() => null) : [];
        else result[key] = limparSaida(item, confidential);
    }
    return result;
}
export function protegerSaida(req, res, next) {
    const render = res.render.bind(res);
    res.render = (view, options, callback) => render(view, limparSaida(options), callback);
    const json = res.json.bind(res);
    res.json = (value) => json(limparSaida(value));
    next();
}
// [Melhoria Proativa Adicionada: evidências não são serializadas e registros legados não recebem consentimento fictício]
