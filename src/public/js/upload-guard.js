/*
 * Guarda de upload — Portal Voz Ativa
 *
 * As mídias sobem direto do navegador para o Cloudinary, sem passar pelo nosso
 * servidor. Este arquivo bloqueia, ainda no cliente, arquivos com tipo inválido
 * ou tamanho excessivo, evitando envios inúteis e travamentos em conexões ruins.
 *
 * Importante: por rodar no navegador, esta checagem é conveniência, não barreira
 * de segurança. O limite que realmente vale é o configurado no upload preset do
 * Cloudinary (formatos permitidos e tamanho máximo) e, no servidor, a checagem
 * de que a URL salva no banco pertence de fato à nossa conta do Cloudinary.
 */
(function () {
    'use strict';

    var LIMITE_IMAGEM = 5 * 1024 * 1024; // 5 MB
    var LIMITE_VIDEO = 50 * 1024 * 1024; // 50 MB

    var TIPOS_IMAGEM = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    var TIPOS_VIDEO = ['video/mp4', 'video/webm', 'video/quicktime'];

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
                return 'A imagem "' + arquivo.name + '" tem ' + emMegabytes(arquivo.size) + '. O limite é 5 MB.';
            }
            return null;
        }

        if (tipo.indexOf('video/') === 0) {
            if (TIPOS_VIDEO.indexOf(tipo) === -1) {
                return 'O vídeo "' + arquivo.name + '" está em um formato não aceito. Use MP4, WEBM ou MOV.';
            }
            if (arquivo.size > LIMITE_VIDEO) {
                return 'O vídeo "' + arquivo.name + '" tem ' + emMegabytes(arquivo.size) + '. O limite é 50 MB.';
            }
            return null;
        }

        return 'O arquivo "' + arquivo.name + '" não é uma imagem nem um vídeo.';
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
