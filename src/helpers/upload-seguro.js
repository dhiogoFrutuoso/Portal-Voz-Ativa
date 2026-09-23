import sharp from 'sharp';
import { PDFDocument, PDFDict } from 'pdf-lib';
export async function tratarArquivo(buffer) {
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    const webp = buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
    if (png || jpeg || webp) {
        const image = sharp(buffer, { limitInputPixels: 25000000, failOn: 'warning' });
        const metadata = await image.metadata();
        if (!['jpeg', 'png', 'webp'].includes(metadata.format) || (metadata.pages || 1) > 1) throw new Error('Imagem não suportada.');
        // Sem withMetadata/keepMetadata: sharp remove EXIF, XMP e ICC.
        return { buffer: await image.rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 }).toBuffer(),
            mime: 'image/webp', resource_type: 'image', extension: 'webp' };
    }
    if (buffer.toString('ascii', 0, 5) === '%PDF-') {
        const pdf = await PDFDocument.load(buffer, { updateMetadata: false });
        if (pdf.getPageCount() > 100) throw new Error('PDF excede 100 páginas.');
        const forbidden = new Set(['JS', 'JavaScript', 'Launch', 'OpenAction', 'AA', 'EmbeddedFiles', 'EF', 'RichMedia', 'XFA', 'SubmitForm', 'ImportData', 'GoToR']);
        for (const [, object] of pdf.context.enumerateIndirectObjects()) {
            const visit = (value, seen = new Set()) => {
                if (!value || seen.has(value)) return;
                seen.add(value);
                if (value instanceof PDFDict) {
                    for (const [key, item] of value.entries()) {
                        if (forbidden.has(key.decodeText()) || (item?.decodeText && forbidden.has(item.decodeText()))) throw new Error('PDF contém conteúdo ativo ou anexos.');
                        visit(item, seen);
                    }
                } else if (typeof value.asArray === 'function') value.asArray().forEach((item) => visit(item, seen));
            };
            visit(object);
        }
        return { buffer: Buffer.from(await pdf.save()), mime: 'application/pdf', resource_type: 'raw', extension: 'pdf' };
    }
    throw new Error('Envie apenas JPEG, PNG, WebP ou PDF.');
}
// [Melhoria Proativa Adicionada: validação real dos bytes, limite de pixels e rejeição de PDF ativo ou criptografado]
