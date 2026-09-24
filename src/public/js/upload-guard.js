// Os limites de tamanho final são conferidos depois da conversão.
document.addEventListener('change', (event) => {
    const input = event.target;
    if (!input || input.tagName !== 'INPUT' || input.type !== 'file' || !input.files?.length) return;
    for (const file of input.files) {
        const image = ['image/png', 'image/jpeg', 'image/webp'].includes(file.type);
        const video = input.accept.includes('video/') && ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type);
        const pdf = input.accept.includes('application/pdf') && file.type === 'application/pdf';
        if (!image && !video && !pdf) {
            event.stopImmediatePropagation(); input.value = '';
            window.portalMensagem('Formato não aceito neste campo. Selecione um dos tipos indicados no seletor de arquivos.'); return;
        }
    }
}, true);
// [Melhoria Proativa Adicionada: seleção não rejeita uma imagem grande antes da compressão]
