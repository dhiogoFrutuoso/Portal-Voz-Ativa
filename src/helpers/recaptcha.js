// O Google valida assinatura, expiração, uso único e os domínios cadastrados.
// V3 também exige conferir a ação e a pontuação, não apenas success.
export async function verificarRecaptcha(token, action) {
    if (typeof token !== 'string' || !token || !process.env.RECAPTCHA_SECRET) return false;
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: process.env.RECAPTCHA_SECRET, response: token }),
        signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.success === true && data.action === action &&
        typeof data.score === 'number' && data.score >= 0.5 && data.score <= 1;
}
