// Validação de conveniência; os bytes são inspecionados no servidor antes do Cloudinary.
(function () {
    'use strict';

    var LIMITE_IMAGEM = 3 * 1024 * 1024; // 3 MB

    var TIPOS_IMAGEM = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

    function emMegabytes(bytes) {
        return (bytes / (1024 * 1024)).toFixed(1).replace('.', ',') + ' MB';
    }

    function problemaCom(arquivo) {
        var tipo = (arquivo.type || '').toLowerCase();

        if (tipo.indexOf('image/') === 0) {
            if (TIPOS_IMAGEM.indexOf(tipo) === -1) {
                return 'A imagem "' + arquivo.name + '" está em um formato não aceito. Use PNG, JPEG ou WEBP.';
            }
            if (arquivo.size > LIMITE_IMAGEM) {
                return 'A imagem "' + arquivo.name + '" tem ' + emMegabytes(arquivo.size) + '. O limite é 3 MB.';
            }
            return null;
        }

        if (tipo === 'application/pdf') return arquivo.size > LIMITE_IMAGEM ? 'O PDF excede 3 MB.' : null;
        return 'O arquivo "' + arquivo.name + '" não é JPEG, PNG, WebP ou PDF.';
    }

    // Fase de captura: roda antes dos handlers das páginas, então um arquivo
    // recusado nunca chega à lógica de envio de cada formulário.
    document.addEventListener(
        'change',
        function (evento) {
            var campo = evento.target;

            if (!campo || campo.tagName !== 'INPUT' || campo.type !== 'file') return;
            if (!campo.files || campo.files.length === 0) return;

            for (var i = 0; i < campo.files.length; i++) {
                var problema = problemaCom(campo.files[i]);

                if (problema) {
                    evento.stopImmediatePropagation();
                    evento.preventDefault();
                    campo.value = '';
                    window.alert(problema);
                    return;
                }
            }
        },
        true
    );
})();
// [Melhoria Proativa Adicionada: validações e integrações de governança aplicadas ao fluxo existente]
