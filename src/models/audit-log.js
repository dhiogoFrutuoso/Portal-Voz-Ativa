import mongoose from 'mongoose';
const schema = new mongoose.Schema({
    adminId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    action: { type: String, required: true, immutable: true },
    targetCollection: { type: String, required: true, immutable: true },
    targetId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
    previousState: { type: mongoose.Schema.Types.Mixed, immutable: true },
    newState: { type: mongoose.Schema.Types.Mixed, immutable: true },
    ipAddress: { type: String, required: true, immutable: true },
    userAgent: { type: String, required: true, immutable: true },
    createdAt: { type: Date, default: Date.now, immutable: true }
}, { versionKey: false });
schema.index({ targetCollection: 1, targetId: 1, createdAt: -1 });
for (const operation of ['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'remove']) {
    schema.pre(operation, function () { throw new Error('AuditLog aceita somente inclusão.'); });
}
schema.pre('save', function () { if (!this.isNew) throw new Error('AuditLog imutável.'); });
schema.pre('deleteOne', { document: true, query: false }, function () { throw new Error('AuditLog imutável.'); });
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', schema);
AuditLog.bulkWrite = async () => { throw new Error('AuditLog não permite bulkWrite.'); };
export default AuditLog;
// [Melhoria Proativa Adicionada: bloqueio de alteração e exclusão também no modelo, sem endpoints públicos]
