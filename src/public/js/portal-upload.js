window.portalCsrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
window.portalArquivo = (data) => {
    if (typeof data !== 'string' || !data.startsWith('data:')) return data;
    const [header, encoded] = data.split(',');
    return new Blob([Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))], { type: header.split(':')[1].split(';')[0] });
};
// [Melhoria Proativa Adicionada: imagens recortadas são enviadas como arquivo binário e CSRF segue em cabeçalho]
