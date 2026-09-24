import express from 'express';
import multer from 'multer';
import { randomUUID, createHmac } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { limitarRequisicoes } from '../config/rate-limit.js';
import { tratarArquivo, LIMITE_FINAL } from '../helpers/upload-seguro.js';
import Media from '../models/media.js';
export const donoMidia = (req) => req.user ? `user:${req.user._id}` : `session:${createHmac('sha256', process.env.JWT_SECRET).update(req.sessionID).digest('hex')}`;
const router = express.Router();
const multipart = multer({ storage: multer.memoryStorage(), limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 0, parts: 2 } }).single('file');
router.post('/', limitarRequisicoes('uploads', { windowMs: 15 * 60000, max: 20 }), (req, res, next) => {
    multipart(req, res, (error) => {
        if (!error) return next();
        const tooLarge = error.code === 'LIMIT_FILE_SIZE';
        res.status(tooLarge ? 413 : 400).json({ error: tooLarge
            ? 'O arquivo excede 4 MB após a conversão no navegador. Escolha um arquivo menor.'
            : 'Envie um arquivo binário por vez pelo seletor de arquivos.' });
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório.' });
        let file;
        try { file = await tratarArquivo(req.file.buffer); }
        catch (error) { return res.status(400).json({ error: error.message }); }
        if (file.resource_type !== 'video' && file.buffer.length > LIMITE_FINAL) return res.status(413).json({ error: 'Mesmo após a otimização, o arquivo excede 3 MB. Escolha um arquivo menor.' });
        const result = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({
                cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY,
                api_secret: process.env.CLOUDINARY_API_SECRET, resource_type: file.resource_type,
                public_id: `portal-validado/${randomUUID()}${file.resource_type === 'raw' ? '.pdf' : ''}`,
                ...(file.resource_type === 'video' ? { format: 'mp4', transformation: [{ width: 960, height: 720, crop: 'limit', quality: 'auto:eco', video_codec: 'h264', fps: 24 }] } : {}),
                timeout: 40000
            }, (error, value) => error ? reject(error) : resolve(value));
            stream.end(file.buffer);
        });
        const invalidVideo = file.resource_type === 'video' && (result.resource_type !== 'video' || result.format !== 'mp4' ||
            !Number.isFinite(result.duration) || result.duration <= 0 || result.duration > 60 || !(result.width > 0 && result.height > 0));
        if (!Number.isFinite(result.bytes) || result.bytes > LIMITE_FINAL || invalidVideo) {
            await cloudinary.uploader.destroy(result.public_id, { resource_type: file.resource_type, cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
            return res.status(413).json({ error: invalidVideo ? 'Envie um vídeo válido de até 60 segundos.' : 'Mesmo após a otimização, o arquivo excede 3 MB. Escolha uma imagem menor ou um vídeo mais curto.' });
        }
        await Media.create({ url: result.secure_url, owner: donoMidia(req), mime: file.resource_type === 'video' ? 'video/mp4' : file.mime });
        res.json({ secure_url: result.secure_url });
    } catch { res.status(503).json({ error: 'Não foi possível processar ou armazenar o arquivo agora. Tente novamente em instantes.' }); }
});
export async function validarMidiasRecebidas(req, res, next) {
    if (req.method !== 'POST') return next();
    const names = ['imagens', 'imagens[]', 'imagens_urls', 'imagens_urls[]', 'novas_imagens', 'novas_imagens[]', 'imagem_url', 'arquivo_url', 'croppedImage', 'video_url'];
    try {
        for (const name of names) {
            const value = req.body?.[name];
            for (const url of (Array.isArray(value) ? value : [value]).filter(Boolean)) {
                if (typeof url !== 'string') return res.status(400).send('Mídia inválida.');
                const record = await Media.findOne({ url, owner: donoMidia(req) }).lean();
                if (!record || (name === 'video_url' ? !record.mime.startsWith('video/') : name === 'arquivo_url' ? !['image/', 'application/pdf'].some(type => record.mime.startsWith(type)) : !record.mime.startsWith('image/'))) return res.status(400).send('Use o seletor de arquivos para enviar uma mídia válida.');
            }
        }
        next();
    } catch { res.status(503).send('Não foi possível validar a mídia.'); }
}
export default router;
// [Melhoria Proativa Adicionada: multipart abaixo do limite Vercel e rejeição de URLs sem recibo de inspeção]
