/*
 * Curtida e comentários sem recarregar a página.
 *
 * Antes, apoiar uma publicação recarregava a página inteira e devolvia o
 * usuário ao topo, e ler comentários exigia sair do hub. Aqui:
 *
 * - a curtida vira um pedido pequeno que só atualiza o próprio botão;
 * - os comentários abrem num modal, carregados sob demanda.
 *
 * Tudo é progressivo: sem JavaScript, os formulários continuam funcionando
 * pelo caminho normal (submit + redirecionamento), que o servidor mantém.
 */
(function () {
    'use strict';

    const token = () => {
        const campo = document.querySelector('input[name="_csrf"]');
        return campo ? campo.value : '';
    };

    const pedir = (url, opcoes = {}) =>
        fetch(url, {
            ...opcoes,
            headers: { 'x-requested-with': 'fetch', ...(opcoes.headers || {}) }
        });

    // --- Curtida ---------------------------------------------------------
    function atualizarBotao(botao, dados) {
        const icone = botao.querySelector('i');

        if (icone) {
            icone.classList.toggle('bi-heart-fill', dados.jaCurtiu);
            icone.classList.toggle('bi-heart', !dados.jaCurtiu);
        }

        // Botão da página de detalhes: rótulo e contador têm lugar próprio, e
        // os estilos de cada estado vêm declarados no próprio elemento.
        const rotulo = botao.querySelector('[data-rotulo-curtida]');
        const contadorProprio = botao.querySelector('[data-contador-curtida]');

        if (rotulo || contadorProprio) {
            if (contadorProprio) contadorProprio.textContent = dados.curtidas;

            if (rotulo) {
                rotulo.textContent = dados.jaCurtiu
                    ? botao.dataset.rotuloCurtido
                    : botao.dataset.rotuloNeutro;
            }

            const curtido = (botao.dataset.classeCurtido || '').split(' ').filter(Boolean);
            const neutro = (botao.dataset.classeNeutro || '').split(' ').filter(Boolean);

            curtido.forEach((c) => botao.classList.toggle(c, dados.jaCurtiu));
            neutro.forEach((c) => botao.classList.toggle(c, !dados.jaCurtiu));
            return;
        }

        // Botão compacto dos cards do hub: só ícone e número.
        const contador = botao.querySelector('span');
        if (contador) contador.textContent = dados.curtidas;

        botao.classList.toggle('btn-danger', dados.jaCurtiu);
        botao.classList.toggle('text-white', dados.jaCurtiu);
        botao.classList.toggle('btn-light', !dados.jaCurtiu);
        botao.classList.toggle('text-danger', !dados.jaCurtiu);
    }

    async function curtir(formulario) {
        const botao = formulario.querySelector('button[type="submit"]');
        if (botao) botao.disabled = true;

        try {
            const resposta = await pedir(formulario.action, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ _csrf: token() }).toString()
            });

            const dados = await resposta.json();

            if (!resposta.ok) {
                // Sem sessão: manda para o login, como o fluxo normal faria.
                if (dados.login) window.location.href = dados.login;
                return;
            }

            if (botao) atualizarBotao(botao, dados);
        } catch (erro) {
            // Se o pedido falhar, deixa o formulário seguir o caminho normal.
            formulario.submit();
        } finally {
            if (botao) botao.disabled = false;
        }
    }

    document.addEventListener('submit', function (evento) {
        const formulario = evento.target.closest('[data-curtir]');
        if (!formulario) return;

        evento.preventDefault();
        curtir(formulario);
    });

    // --- Modal de comentários --------------------------------------------
    const modalElemento = document.getElementById('modalComentarios');
    if (!modalElemento) return;

    const lista = modalElemento.querySelector('[data-lista-comentarios]');
    const formulario = modalElemento.querySelector('[data-form-comentario]');
    const titulo = modalElemento.querySelector('[data-titulo-comentarios]');
    const aviso = modalElemento.querySelector('[data-aviso-comentarios]');
    const areaEnvio = modalElemento.querySelector('[data-area-envio]');
    let rotaComentarios = null;
    let eixoAtual = null;
    let idAtual = null;

    async function carregar(rota) {
        lista.innerHTML = '<p class="text-center text-muted small my-4">Carregando comentários...</p>';

        try {
            const resposta = await pedir(rota);
            if (!resposta.ok) throw new Error('falha');
            lista.innerHTML = await resposta.text();
            lista.scrollTop = lista.scrollHeight;
        } catch (erro) {
            lista.innerHTML = '<p class="text-center text-danger small my-4">Não foi possível carregar os comentários.</p>';
        }
    }

    document.addEventListener('click', function (evento) {
        const gatilho = evento.target.closest('[data-comentarios]');
        if (!gatilho) return;

        // Na página de detalhes a área inteira de comentários abre o modal,
        // mas um link ali dentro (o perfil de quem comentou) tem que continuar
        // levando ao seu destino.
        if (evento.target.closest('a')) return;

        evento.preventDefault();

        const eixo = gatilho.dataset.eixo;
        const id = gatilho.dataset.comentarios;

        eixoAtual = eixo;
        idAtual = id;
        rotaComentarios = `/categories/${eixo}/comentarios/${id}`;
        formulario.action = `/categories/${eixo}/comentario/${id}`;
        if (titulo) titulo.textContent = gatilho.dataset.titulo || 'Comentários';
        if (aviso) aviso.textContent = '';

        carregar(rotaComentarios);
        bootstrap.Modal.getOrCreateInstance(modalElemento).show();
    });

    if (formulario) {
        formulario.addEventListener('submit', async function (evento) {
            evento.preventDefault();

            const campo = formulario.querySelector('input[name="texto"]');
            const texto = campo.value.trim();
            if (!texto) return;

            const botao = formulario.querySelector('button[type="submit"]');
            if (botao) botao.disabled = true;
            if (aviso) aviso.textContent = '';

            try {
                const resposta = await pedir(formulario.action, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ _csrf: token(), texto }).toString()
                });

                if (!resposta.ok) {
                    const erro = await resposta.json().catch(() => ({}));
                    if (erro.login) return (window.location.href = erro.login);
                    if (aviso) aviso.textContent = erro.erro || 'Não foi possível publicar o comentário.';
                    return;
                }

                lista.innerHTML = await resposta.text();
                lista.scrollTop = lista.scrollHeight;
                campo.value = '';
            } catch (erro) {
                if (aviso) aviso.textContent = 'Não foi possível publicar o comentário.';
            } finally {
                if (botao) botao.disabled = false;
            }
        });
    }

    // --- Editar e excluir comentário -------------------------------------
    async function enviarAcao(url, corpo) {
        const resposta = await pedir(url, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ _csrf: token(), ...corpo }).toString()
        });

        if (!resposta.ok) {
            const erro = await resposta.json().catch(() => ({}));
            if (erro.login) {
                window.location.href = erro.login;
                return false;
            }
            if (aviso) aviso.textContent = erro.erro || 'Não foi possível concluir a ação.';
            return false;
        }

        // O servidor devolve a lista já atualizada.
        lista.innerHTML = await resposta.text();
        return true;
    }

    lista.addEventListener('click', function (evento) {
        const editar = evento.target.closest('[data-editar-comentario]');
        const cancelar = evento.target.closest('[data-cancelar-comentario]');
        const excluir = evento.target.closest('[data-excluir-comentario]');

        if (editar || cancelar) {
            const id = (editar || cancelar).dataset.editarComentario || cancelar.dataset.cancelarComentario;
            const bloco = lista.querySelector(`[data-comentario="${id}"]`);
            if (!bloco) return;

            const editando = Boolean(editar);
            bloco.querySelector('[data-texto-comentario]').classList.toggle('d-none', editando);
            bloco.querySelector(`[data-form-editar-comentario="${id}"]`).classList.toggle('d-none', !editando);
            bloco.querySelector(`[data-acoes-comentario="${id}"]`).classList.toggle('d-none', editando);
            return;
        }

        if (excluir) {
            const id = excluir.dataset.excluirComentario;
            if (!window.confirm('Excluir este comentário? A ação não pode ser desfeita.')) return;
            if (aviso) aviso.textContent = '';
            enviarAcao(`/categories/${eixoAtual}/comentario/${idAtual}/${id}/excluir`, {});
        }
    });

    lista.addEventListener('submit', async function (evento) {
        const form = evento.target.closest('[data-form-editar-comentario]');
        if (!form) return;

        evento.preventDefault();

        const id = form.dataset.formEditarComentario;
        const texto = form.querySelector('textarea[name="texto"]').value.trim();
        if (!texto) return;

        if (aviso) aviso.textContent = '';
        await enviarAcao(`/categories/${eixoAtual}/comentario/${idAtual}/${id}/editar`, { texto });
    });

    // Sem sessão o campo de comentário não aparece — o servidor recusaria mesmo.
    if (areaEnvio && areaEnvio.dataset.logado !== 'sim') {
        areaEnvio.innerHTML =
            '<a href="/users/login" class="btn btn-primary btn-sm rounded-3 w-100">Entrar para comentar</a>';
    }
})();
