import mongoose from 'mongoose';
const schema = new mongoose.Schema({
    ipAddress: { type: String, required: true },
    createdAt: { type: Date, default: Date.now, immutable: true },
    expiresAt: { type: Date, required: true }
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.AccessLog || mongoose.model('AccessLog', schema);
// [Melhoria Proativa Adicionada: registro mínimo de acesso sem senha, query string ou conteúdo da manifestação]
