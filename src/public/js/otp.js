document.querySelectorAll('[data-otp-code]').forEach((field) => {
    const digits = (value) => value.replace(/\D/g, '').slice(0, 6);
    field.addEventListener('input', () => { field.value = digits(field.value); });
    field.addEventListener('paste', (event) => {
        const value = event.clipboardData?.getData('text');
        if (!value) return;
        event.preventDefault();
        field.value = digits(value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    });
});
// [Melhoria Proativa Adicionada: digitação, colagem e autofill no mesmo campo, sem mover o foco ou enviar automaticamente]
