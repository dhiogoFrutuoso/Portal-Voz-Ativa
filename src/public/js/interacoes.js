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
        const contador = botao.querySelector('span');

        if (contador) contador.textContent = dados.curtidas;

        if (icone) {
            icone.classList.toggle('bi-heart-fill', dados.jaCurtiu);
            icone.classList.toggle('bi-heart', !dados.jaCurtiu);
        }

        // As duas variações de estilo usadas nos cards e na página de detalhes
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

        evento.preventDefault();

        const eixo = gatilho.dataset.eixo;
        const id = gatilho.dataset.comentarios;

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

    // Sem sessão o campo de comentário não aparece — o servidor recusaria mesmo.
    if (areaEnvio && areaEnvio.dataset.logado !== 'sim') {
        areaEnvio.innerHTML =
            '<a href="/users/login" class="btn btn-primary btn-sm rounded-3 w-100">Entrar para comentar</a>';
    }
})();
