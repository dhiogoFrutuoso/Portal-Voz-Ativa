window.portalCsrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
window.portalArquivo = (data) => {
    if (typeof data !== 'string' || !data.startsWith('data:')) return data;
    const [header, encoded] = data.split(',');
    return new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: header.split(':')[1].split(';')[0] });
};
window.portalMensagem = (message, type = 'danger') => {
    let region = document.getElementById('portal-mensagens');
    if (!region) { region = document.createElement('div'); region.id = 'portal-mensagens'; document.body.prepend(region); }
    region.className = 'container mt-3';
    region.style.scrollMarginTop = '120px';
    const box = document.createElement('div');
    box.className = 'alert alert-' + (['danger', 'success', 'info'].includes(type) ? type : 'danger') + ' alert-dismissible show border-0 shadow-sm rounded-4';
    box.setAttribute('role', 'alert'); box.tabIndex = -1;
    const text = document.createElement('span'); text.textContent = message;
    const close = document.createElement('button'); close.type = 'button'; close.className = 'btn-close'; close.setAttribute('aria-label', 'Fechar mensagem'); close.onclick = () => box.remove();
    box.append(text, close); region.replaceChildren(box); box.focus({ preventScroll: true });
    region.scrollIntoView({ behavior: 'instant', block: 'start' });
};
(() => {
    const MB = 1024 * 1024;
    const cache = new WeakMap();
    const blobFromCanvas = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível converter a imagem.')), 'image/webp', quality));
    async function imagem(file) {
        if (file.size > 50 * MB) throw new Error('A imagem original excede 50 MB. Escolha uma imagem menor para processar neste dispositivo.');
        let bitmap;
        try { bitmap = await createImageBitmap(file); } catch { throw new Error('Não foi possível ler a imagem. Use JPEG, PNG ou WebP.'); }
        try {
            if (bitmap.width * bitmap.height > 25000000) throw new Error('A imagem excede 25 megapixels. Reduza sua resolução.');
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            let result = await blobFromCanvas(canvas, .75);
            if (result.size > 3 * MB) result = await blobFromCanvas(canvas, .5);
            return new File([result], result.type === 'image/webp' ? 'imagem.webp' : 'imagem.png', { type: result.type });
        } finally { bitmap.close(); }
    }
    async function video(file) {
        if (file.size > 100 * MB) throw new Error('O vídeo original excede 100 MB. Escolha um trecho menor.');
        if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) throw new Error('Este navegador não permite converter vídeos. Tente em um navegador atualizado.');
        const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
        if (!mime) throw new Error('A conversão de vídeo não está disponível neste navegador.');
        const element = document.createElement('video'); element.playsInline = true; element.muted = true; element.preload = 'auto';
        const url = URL.createObjectURL(file);
        let audio, stream, recorder, frame, timer, stopOnHide;
        try {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('O vídeo demorou demais para abrir.')), 15000);
                element.onloadeddata = () => { clearTimeout(timeout); resolve(); };
                element.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível ler o vídeo. Use um MP4 ou WebM compatível.')); };
                element.src = url;
            });
            let duration = element.duration;
            // WebM gravado no navegador pode não trazer duração no cabeçalho.
            const seek = (time) => new Promise((resolve, reject) => {
                const timeout = setTimeout(() => { element.onseeked = null; reject(new Error('Não foi possível ler a duração do vídeo.')); }, 10000);
                element.onseeked = () => { clearTimeout(timeout); element.onseeked = null; resolve(); };
                element.currentTime = time;
            });
            if (duration === Infinity) {
                await seek(1e10); duration = Number.isFinite(element.duration) ? element.duration : element.currentTime;
                await seek(0);
            }
            if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error('Selecione um vídeo de até 60 segundos.');
            if (document.hidden) throw new Error('Mantenha esta aba aberta durante a conversão do vídeo.');
            const canvas = document.createElement('canvas');
            const scale = Math.min(1, 960 / element.videoWidth, 720 / element.videoHeight);
            canvas.width = Math.max(2, Math.floor(element.videoWidth * scale / 2) * 2); canvas.height = Math.max(2, Math.floor(element.videoHeight * scale / 2) * 2);
            const ctx = canvas.getContext('2d'); stream = canvas.captureStream(24);
            audio = new (window.AudioContext || window.webkitAudioContext)();
            await Promise.race([audio.resume(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Permita a reprodução de mídia e tente novamente.')), 5000); })]); clearTimeout(timer);
            const source = audio.createMediaElementSource(element); const destination = audio.createMediaStreamDestination(); source.connect(destination);
            // Som vai somente à gravação, sem tocar nos alto-falantes. Muted silenciaria também a faixa convertida.
            element.muted = false; element.volume = 1;
            destination.stream.getAudioTracks().forEach(track => stream.addTrack(track));
            recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.min(1000000, Math.floor(2.5 * MB * 8 / duration) - 64000), audioBitsPerSecond: 64000 });
            const chunks = [];
            const output = new Promise((resolve, reject) => {
                recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
                recorder.onerror = () => reject(new Error('Falha ao converter o vídeo. Tente um trecho menor.'));
                recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType.split(';')[0] }));
                stopOnHide = () => { if (document.hidden) reject(new Error('A conversão foi interrompida. Mantenha esta aba aberta e tente novamente.')); };
                document.addEventListener('visibilitychange', stopOnHide);
                timer = setTimeout(() => reject(new Error('A conversão do vídeo demorou demais. Tente novamente.')), (duration + 20) * 1000);
                element.onended = () => { if (recorder.state !== 'inactive') recorder.stop(); };
                element.onerror = () => reject(new Error('A reprodução do vídeo foi interrompida.'));
                const draw = () => { ctx.drawImage(element, 0, 0, canvas.width, canvas.height); frame = requestAnimationFrame(draw); }; draw();
                recorder.start(250); element.play().catch(() => reject(new Error('Não foi possível reproduzir o vídeo para conversão.')));
            });
            const result = await output;
            if (!result.size) throw new Error('O vídeo convertido está vazio.');
            return new File([result], result.type === 'video/mp4' ? 'video.mp4' : 'video.webm', { type: result.type });
        } finally {
            clearTimeout(timer); cancelAnimationFrame(frame);
            if (stopOnHide) document.removeEventListener('visibilitychange', stopOnHide);
            if (recorder && recorder.state !== 'inactive') recorder.stop();
            element.pause(); element.removeAttribute('src'); element.load();
            stream?.getTracks().forEach(track => track.stop()); if (audio) await audio.close(); URL.revokeObjectURL(url);
        }
    }
    window.portalPrepararArquivo = async (data) => {
        const file = window.portalArquivo(data);
        if (!(file instanceof Blob)) throw new Error('Selecione um arquivo válido.');
        if (['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return imagem(file);
        if (file.type.startsWith('video/')) return video(file);
        if (file.type === 'application/pdf') return file;
        throw new Error('Formato não aceito. Use JPEG, PNG, WebP, MP4, WebM ou PDF.');
    };
    window.portalEnviarArquivo = async (file) => {
        if (file instanceof Blob && cache.has(file)) return cache.get(file);
        const work = (async () => {
            const prepared = await window.portalPrepararArquivo(file);
            // Teto de transporte: a Vercel rejeita a requisição antes da API acima de 4,5 MB.
            if (prepared.size > 4 * MB) throw new Error('Mesmo após a conversão, o arquivo excede o limite de envio. Escolha uma imagem menor ou um vídeo mais curto.');
            const body = new FormData(); body.append('file', prepared, prepared.name || 'anexo.pdf');
            let response;
            try { response = await fetch('/uploads', { method: 'POST', headers: { 'x-csrf-token': window.portalCsrf() }, body }); }
            catch { throw new Error('Falha na conexão ao enviar o arquivo. Tente novamente.'); }
            const result = await response.json().catch(() => null);
            if (!response.ok || !result?.secure_url) throw new Error(result?.error || (response.status === 413 ? 'O arquivo convertido excede o limite de envio.' : 'Não foi possível enviar o arquivo. Recarregue a página e tente novamente.'));
            return result;
        })();
        if (file instanceof Blob) cache.set(file, work);
        try { return await work; } catch (error) { if (file instanceof Blob) cache.delete(file); throw error; }
    };
})();
// [Melhoria Proativa Adicionada: compressão anterior ao transporte, upload binário único e mensagens acessíveis sem alert do navegador]
