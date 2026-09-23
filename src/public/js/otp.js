document.querySelectorAll('[data-otp-inputs]').forEach((group) => {
    const fields = [...group.querySelectorAll('input')];
    fields.forEach((field, index) => {
        field.addEventListener('input', () => {
            field.value = field.value.replace(/\D/g, '').slice(-1);
            if (field.value) fields[index + 1]?.focus();
        });
        field.addEventListener('keydown', (event) => { if (event.key === 'Backspace' && !field.value) fields[index - 1]?.focus(); });
        field.addEventListener('paste', (event) => {
            const code = event.clipboardData.getData('text').replace(/\D/g, '');
            if (code.length !== 6) return;
            event.preventDefault(); fields.forEach((input, i) => { input.value = code[i]; }); fields[5].focus();
        });
    });
});
// [Melhoria Proativa Adicionada: navegação por teclado e colagem do OTP sem envio automático]
