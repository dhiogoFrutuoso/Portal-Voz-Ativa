/*
 * Notificações por e-mail — Portal Voz Ativa.
 *
 * O cidadão registra uma demanda e some da tela: sem aviso, ele só descobre a
 * resposta se voltar ao site por conta própria. Aqui saem dois avisos:
 * quando a gestão responde no protocolo e quando o estágio muda.
 *
 * Regras que valem para todo envio:
 *
 * - Falha de e-mail NUNCA derruba a ação do usuário. Se o Resend estiver fora
 *   do ar ou sem chave, a resposta é gravada do mesmo jeito e o erro só vai
 *   para o log.
 * - Denúncia sigilosa não expõe o teor no corpo do e-mail. O aviso diz que há
 *   novidade e leva ao protocolo, onde a identificação já foi feita.
 * - Nada de segredo no HTML: o link vai para a página do protocolo, que exige
 *   login como qualquer outra.
 */
// Carrega o .env aqui também: assim o módulo funciona mesmo quando importado
// por um script isolado, sem depender da ordem de import do servidor.
import 'dotenv/config';
import { Resend } from 'resend';
import nodemailer from 'nodemailer';

const URL_PUBLICA = (process.env.URL_PUBLICA || 'https://portal-voz-ativa.onrender.com').replace(/\/$/, '');

/*
 * Dois caminhos de envio, escolhidos pelo que estiver configurado.
 *
 * SMTP (Gmail) vem primeiro porque funciona sem domínio próprio: a conta do
 * Resend, enquanto não houver domínio verificado, só entrega no e-mail do dono
 * da conta — inútil para avisar cidadão. Quando o domínio existir, basta
 * preencher RESEND_API_KEY e apagar as variáveis SMTP_* que o envio migra
 * sozinho, sem tocar em código.
 */
const SMTP_USUARIO = process.env.SMTP_USUARIO;
const SMTP_SENHA = process.env.SMTP_SENHA;
const CHAVE_RESEND = process.env.RESEND_API_KEY;

const usandoSmtp = Boolean(SMTP_USUARIO && SMTP_SENHA);

const REMETENTE =
    process.env.EMAIL_REMETENTE ||
    (usandoSmtp ? `Portal Voz Ativa <${SMTP_USUARIO}>` : 'Portal Voz Ativa <onboarding@resend.dev>');

const transporteSmtp = usandoSmtp
    ? nodemailer.createTransport({
          host: process.env.SMTP_HOST || 'smtp.gmail.com',
          port: Number(process.env.SMTP_PORTA || 587),
          secure: Number(process.env.SMTP_PORTA || 587) === 465,
          auth: { user: SMTP_USUARIO, pass: SMTP_SENHA }
      })
    : null;

const resend = !usandoSmtp && CHAVE_RESEND ? new Resend(CHAVE_RESEND) : null;

if (!transporteSmtp && !resend) {
    console.warn(
        'AVISO: nenhum envio de e-mail configurado (defina SMTP_USUARIO/SMTP_SENHA ou RESEND_API_KEY).'
    );
} else {
    console.log(`E-mail de notificação ativo via ${usandoSmtp ? 'SMTP' : 'Resend'}.`);
}

// --- Identidade visual ------------------------------------------------------
const VERDE = '#2fb344';
const VERDE_ESCURO = '#1f8f33';
const AZUL = '#13315c';
const TEXTO = '#1f2933';
const CINZA = '#6b7280';

// PNG, não WebP: o Outlook não renderiza WebP, e a logo sumiria justamente
// no cliente de e-mail mais usado em repartição pública.
const LOGO = `${URL_PUBLICA}/img/logo-email.png`;

const escapar = (texto) =>
    String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/*
 * Monta o HTML do e-mail.
 *
 * Cliente de e-mail não roda CSS moderno: nada de flex, grid ou folha externa.
 * Por isso o layout é feito em tabelas com estilo em linha — feio de escrever,
 * mas é o que renderiza igual no Gmail, no Outlook e no celular.
 */
function montarHtml({ titulo, chamada, corpo, rotuloBotao, link, rodape, numero, estagio }) {
    return `<!DOCTYPE html>
<html lang="pt-br">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f4;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXTO};">
  <!-- Prévia que aparece na lista de mensagens, antes de abrir -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapar(chamada)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f4;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
               style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,0.08);">

          <tr>
            <td style="background:linear-gradient(135deg,${VERDE} 0%,${VERDE_ESCURO} 100%);padding:28px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="52" valign="middle">
                    <img src="${LOGO}" width="44" height="44" alt="Portal Voz Ativa"
                         style="display:block;border:0;background:#ffffff;border-radius:12px;padding:4px;">
                  </td>
                  <td valign="middle" style="padding-left:14px;">
                    <div style="color:rgba(255,255,255,0.85);font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">
                      Prefeitura de Cariús
                    </div>
                    <div style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:0.3px;">
                      Portal Voz Ativa
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.3;color:${AZUL};">${escapar(titulo)}</h1>
              <p style="margin:0;font-size:15px;line-height:1.6;color:${CINZA};">${escapar(chamada)}</p>
            </td>
          </tr>

          ${
              numero || estagio
                  ? `<tr>
            <td style="padding:20px 32px 0 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                     style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;">
                <tr>
                  <td style="padding:14px 18px;">
                    ${
                        numero
                            ? `<div style="font-size:12px;color:${CINZA};text-transform:uppercase;letter-spacing:0.6px;">Protocolo</div>
                       <div style="font-size:15px;font-weight:700;color:${AZUL};font-family:'Courier New',monospace;">${escapar(numero)}</div>`
                            : ''
                    }
                    ${
                        estagio
                            ? `<div style="font-size:12px;color:${CINZA};text-transform:uppercase;letter-spacing:0.6px;margin-top:10px;">Situação atual</div>
                       <div style="font-size:15px;font-weight:700;color:${VERDE_ESCURO};">${escapar(estagio)}</div>`
                            : ''
                    }
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
                  : ''
          }

          ${
              corpo
                  ? `<tr>
            <td style="padding:22px 32px 0 32px;">
              <div style="font-size:12px;color:${CINZA};text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Mensagem</div>
              <div style="background:#f8fafc;border-left:4px solid ${VERDE};border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.6;">
                ${escapar(corpo)}
              </div>
            </td>
          </tr>`
                  : ''
          }

          <tr>
            <td align="center" style="padding:28px 32px 8px 32px;">
              <a href="${link}"
                 style="display:inline-block;background:${VERDE};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:14px 34px;border-radius:999px;">
                ${escapar(rotuloBotao)}
              </a>
              <div style="margin-top:12px;font-size:13px;color:${CINZA};">
                Você também pode responder por lá, na própria página do protocolo.
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:12px 32px 28px 32px;">
              <div style="font-size:12px;color:${CINZA};line-height:1.6;word-break:break-all;">
                Se o botão não funcionar, copie este endereço no navegador:<br>
                <span style="color:${VERDE_ESCURO};">${escapar(link)}</span>
              </div>
            </td>
          </tr>

          <tr>
            <td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:20px 32px;">
              <div style="font-size:12px;color:${CINZA};line-height:1.6;">
                ${escapar(rodape)}
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
                Portal Voz Ativa · Ouvidoria digital de Cariús, Ceará<br>
                Esta é uma mensagem automática — não é preciso respondê-la por e-mail.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// Versão em texto puro, para quem lê e-mail sem HTML.
function montarTexto({ titulo, chamada, corpo, link, numero, estagio }) {
    return [
        titulo,
        '',
        chamada,
        numero ? `\nProtocolo: ${numero}` : '',
        estagio ? `Situação atual: ${estagio}` : '',
        corpo ? `\nMensagem:\n${corpo}` : '',
        `\nAcompanhe e responda em: ${link}`,
        '',
        'Portal Voz Ativa — Ouvidoria digital de Cariús, Ceará.'
    ]
        .filter((linha) => linha !== '')
        .join('\n');
}

/*
 * Envia o e-mail. Nunca lança: devolve { enviado, motivo } para quem chamou
 * decidir se registra algo — mas a ação do usuário segue de qualquer forma.
 */
async function enviar({ para, assunto, ...conteudo }) {
    if (!transporteSmtp && !resend) return { enviado: false, motivo: 'sem-configuracao' };
    if (!para) return { enviado: false, motivo: 'sem-destinatario' };

    const mensagem = {
        from: REMETENTE,
        to: para,
        subject: assunto,
        html: montarHtml(conteudo),
        text: montarTexto(conteudo)
    };

    try {
        if (transporteSmtp) {
            await transporteSmtp.sendMail(mensagem);
            return { enviado: true, via: 'smtp' };
        }

        const { error } = await resend.emails.send(mensagem);

        if (error) {
            console.error('Resend recusou o envio:', error.message || error);
            return { enviado: false, motivo: 'recusado' };
        }

        return { enviado: true, via: 'resend' };
    } catch (err) {
        console.error('Falha ao enviar e-mail:', err.message);
        return { enviado: false, motivo: 'excecao' };
    }
}

const linkDoProtocolo = (tipo, id) => `${URL_PUBLICA}/protocolos/${tipo}/${id}`;

/*
 * Aviso de resposta da gestão no protocolo.
 *
 * Em denúncia sigilosa o texto da resposta não vai no e-mail: caixa de entrada
 * é lugar mais exposto que a página autenticada, e o teor de uma denúncia não
 * precisa circular por lá.
 */
export function notificarRespostaDaGestao({ destinatario, protocolo, mensagem, sigilosa }) {
    if (!destinatario) return Promise.resolve({ enviado: false, motivo: 'sem-destinatario' });

    return enviar({
        para: destinatario,
        assunto: `A gestão respondeu seu protocolo ${protocolo.numero}`,
        titulo: 'Sua demanda teve uma resposta',
        chamada: `A gestão municipal respondeu o protocolo "${protocolo.titulo}".`,
        corpo: sigilosa ? null : mensagem,
        numero: protocolo.numero,
        estagio: protocolo.estagio,
        rotuloBotao: 'Ver resposta e responder',
        link: linkDoProtocolo(protocolo.tipo, protocolo.id),
        rodape: sigilosa
            ? 'Por se tratar de denúncia sigilosa, o conteúdo da resposta fica apenas na página do protocolo, acessível só a você e à gestão.'
            : 'Você recebeu este aviso porque registrou esta demanda no Portal Voz Ativa.'
    });
}

// Aviso de mudança de estágio (Novo, Em Atendimento, Resolvido...).
export function notificarMudancaDeEstagio({ destinatario, protocolo, de, para, mensagem, sigilosa }) {
    if (!destinatario) return Promise.resolve({ enviado: false, motivo: 'sem-destinatario' });

    return enviar({
        para: destinatario,
        assunto: `Protocolo ${protocolo.numero}: agora em "${para}"`,
        titulo: `Seu protocolo mudou para "${para}"`,
        chamada: `A situação de "${protocolo.titulo}" passou de "${de}" para "${para}".`,
        corpo: sigilosa ? null : mensagem,
        numero: protocolo.numero,
        estagio: para,
        rotuloBotao: 'Acompanhar protocolo',
        link: linkDoProtocolo(protocolo.tipo, protocolo.id),
        rodape:
            para === 'Improcedente'
                ? 'Se não concordar com o arquivamento, você pode apresentar um recurso na página do protocolo.'
                : 'Você recebeu este aviso porque registrou esta demanda no Portal Voz Ativa.'
    });
}

// Aviso de decisão sobre o recurso.
export function notificarDecisaoDeRecurso({ destinatario, protocolo, aceito, mensagem, sigilosa }) {
    if (!destinatario) return Promise.resolve({ enviado: false, motivo: 'sem-destinatario' });

    return enviar({
        para: destinatario,
        assunto: `Recurso do protocolo ${protocolo.numero}: ${aceito ? 'aceito' : 'indeferido'}`,
        titulo: aceito ? 'Seu recurso foi aceito' : 'Seu recurso foi analisado',
        chamada: aceito
            ? `A gestão considerou sua demanda pertinente e reabriu o protocolo "${protocolo.titulo}".`
            : `A gestão analisou seu recurso sobre "${protocolo.titulo}" e manteve o arquivamento.`,
        corpo: sigilosa ? null : mensagem,
        numero: protocolo.numero,
        estagio: aceito ? 'Reaberto' : 'Improcedente',
        rotuloBotao: 'Ver decisão completa',
        link: linkDoProtocolo(protocolo.tipo, protocolo.id),
        rodape: 'Você recebeu este aviso porque apresentou um recurso no Portal Voz Ativa.'
    });
}

export const emailAtivo = () => Boolean(transporteSmtp || resend);

// Útil para diagnóstico: por onde os e-mails estão saindo.
export const provedorDeEmail = () => (transporteSmtp ? 'smtp' : resend ? 'resend' : 'nenhum');
