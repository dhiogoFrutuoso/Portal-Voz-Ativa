import mongoose from 'mongoose';
const schema = new mongoose.Schema({
    _id: String,
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'users' },
    purpose: { type: String, enum: ['verify', 'reset'], required: true },
    codeHash: { type: String, select: false },
    attempts: { type: Number, default: 0 },
    version: { type: Number, default: 0 },
    issuedAt: Date,
    expiresAt: { type: Date, required: true }
}, { versionKey: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export default mongoose.models.otp || mongoose.model('otp', schema);
// [Melhoria Proativa Adicionada: expiração TTL e chave única por conta e finalidade]
