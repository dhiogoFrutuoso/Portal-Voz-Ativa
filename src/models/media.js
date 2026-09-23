import mongoose from 'mongoose';
const schema = new mongoose.Schema({
    url: { type: String, unique: true, required: true },
    owner: { type: String, required: true, index: true },
    mime: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
export default mongoose.models.Media || mongoose.model('Media', schema);
// [Melhoria Proativa Adicionada: recibo de upload vincula URL validada ao usuário ou à sessão de cadastro]
