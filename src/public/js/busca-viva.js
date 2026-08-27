/*
 * Busca em tempo real e filtros instantâneos.
 *
 * Duas coisas diferentes acontecem aqui, de propósito:
 *
 * - Os BOTÕES DE FILTRO só escondem e mostram o que já está na página. Não há
 *   requisição, nem recarga: a troca é imediata, como alternar abas.
 *
 * - A BUSCA POR TEXTO precisa do servidor, porque o banco tem mais registros do
 *   que a página carregou. Para não disparar um pedido por tecla, o envio
 *   espera o usuário parar de digitar (debounce) e o pedido anterior é
 *   cancelado quando um novo começa.
 *
 * O servidor devolve o mesmo HTML dos cards da página, então o desenho continua
 * definido num único lugar (os partials do Handlebars).
 */
(function () {
    'use strict';

    const ESPERA_MS = 300;

    function iniciar(painel) {
        const campo = painel.querySelector('[data-busca-campo]');
        const resultados = document.querySelector(painel.dataset.buscaAlvo || '#resultados');
        const rota = painel.dataset.buscaRota;
        const contador = painel.querySelector('[data-busca-contador]');
        const aviso = painel.querySelector('[data-busca-status]');

        if (!resultados) return;

        const filtros = Array.from(painel.querySelectorAll('[data-filtro]'));
        let temporizador = null;
        let pedidoEmCurso = null;

        // --- Filtros: puramente visuais, sem ida ao servidor ---
        function filtrosAtivos() {
            const ativos = {};
            for (const botao of filtros) {
                if (botao.classList.contains('ativo') && botao.dataset.valor) {
                    ativos[botao.dataset.filtro] = botao.dataset.valor;
                }
            }
            return ativos;
        }

        function aplicarFiltros() {
            const ativos = filtrosAtivos();
            const itens = resultados.querySelectorAll('.item-filtravel');
            let visiveis = 0;

            itens.forEach(function (item) {
                const combina = Object.entries(ativos).every(function ([campoFiltro, valor]) {
                    return (item.dataset[campoFiltro] || '') === valor;
                });

                item.classList.toggle('d-none', !combina);
                if (combina) visiveis++;
            });

            if (contador) contador.textContent = String(visiveis);

            const vazio = resultados.querySelector('[data-sem-resultado]');
            if (vazio) vazio.classList.toggle('d-none', visiveis > 0 || itens.length === 0);
        }

        filtros.forEach(function (botao) {
            botao.addEventListener('click', function () {
                const grupo = botao.dataset.filtro;

                // Um valor ativo por grupo; clicar no que já está ativo limpa o filtro.
                const jaAtivo = botao.classList.contains('ativo');
                painel
                    .querySelectorAll('[data-filtro="' + grupo + '"]')
                    .forEach(function (irmao) {
                        irmao.classList.remove('ativo');
                    });

                if (!jaAtivo) botao.classList.add('ativo');
                else painel.querySelector('[data-filtro="' + grupo + '"][data-valor=""]')?.classList.add('ativo');

                aplicarFiltros();
            });
        });

        // --- Busca por texto: debounce + cancelamento do pedido anterior ---
        async function buscar(termo) {
            if (!rota) return;

            if (pedidoEmCurso) pedidoEmCurso.abort();
            pedidoEmCurso = new AbortController();

            if (aviso) aviso.textContent = 'buscando...';

            try {
                const endereco = rota + (rota.includes('?') ? '&' : '?') + 'q=' + encodeURIComponent(termo);
                const resposta = await fetch(endereco, {
                    signal: pedidoEmCurso.signal,
                    headers: { 'x-requested-with': 'fetch' }
                });

                if (!resposta.ok) throw new Error('resposta ' + resposta.status);

                resultados.innerHTML = await resposta.text();
                aplicarFiltros();

                if (aviso) {
                    const encontrados = resultados.querySelectorAll('.item-filtravel').length;
                    aviso.textContent = termo
                        ? encontrados + ' resultado(s) para “' + termo + '”'
                        : '';
                }
            } catch (erro) {
                if (erro.name === 'AbortError') return; // pedido substituído por outro
                if (aviso) aviso.textContent = 'não foi possível buscar agora';
            } finally {
                pedidoEmCurso = null;
            }
        }

        if (campo) {
            campo.addEventListener('input', function () {
                clearTimeout(temporizador);
                const termo = campo.value.trim();
                temporizador = setTimeout(function () {
                    buscar(termo);
                }, ESPERA_MS);
            });

            // Enter não recarrega a página: a lista já se atualiza sozinha.
            campo.form?.addEventListener('submit', function (evento) {
                evento.preventDefault();
                clearTimeout(temporizador);
                buscar(campo.value.trim());
            });
        }

        aplicarFiltros();
    }

    document.addEventListener('DOMContentLoaded', function () {
        document.querySelectorAll('[data-busca-painel]').forEach(iniciar);
    });
})();
