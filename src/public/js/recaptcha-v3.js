document.querySelectorAll('form[data-recaptcha-action]').forEach((form) => {
    let enviando = false;
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (enviando) return;
        enviando = true;
        const button = form.querySelector('button[type="submit"]');
        const message = form.querySelector('[data-recaptcha-error]');
        const field = form.querySelector('[name="g-recaptcha-response"]');
        button.disabled = true;
        message.hidden = true;
        field.value = '';
        let timeout;
        try {
            const token = await Promise.race([
                new Promise((resolve, reject) => {
                    if (!window.grecaptcha) return reject(new Error('API indisponível'));
                    window.grecaptcha.ready(() => {
                        try {
                            Promise.resolve(window.grecaptcha.execute(form.dataset.recaptchaKey, {
                                action: form.dataset.recaptchaAction
                            })).then(resolve, reject);
                        } catch (error) { reject(error); }
                    });
                }),
                new Promise((_, reject) => {
                    timeout = setTimeout(() => reject(new Error('Tempo excedido')), 15000);
                })
            ]);
            if (!token) throw new Error('Token ausente');
            field.value = token;
            HTMLFormElement.prototype.submit.call(form);
        } catch {
            message.textContent = 'Não foi possível verificar a segurança. Confira sua conexão e tente novamente.';
            message.hidden = false;
            button.disabled = false;
            enviando = false;
        } finally { clearTimeout(timeout); }
    });
});
