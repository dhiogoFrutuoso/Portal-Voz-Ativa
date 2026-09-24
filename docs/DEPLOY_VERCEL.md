# Hospedagem na Vercel

O portal usa Express, Node.js 24, MongoDB externo com suporte a transações e Cloudinary. A entrada continua em src/index.js; vercel.json inclui templates e restaura outputDirectory padrão. O build copia src/public para public na raiz.

A configuração ativa está em .env.example. As mudanças de autenticação, e-mail, arquivos, auditoria e seus requisitos estão em [GOVERNANCA.md](GOVERNANCA.md).

## Configuração de build

- Framework: Express; raiz do repositório.
- Instalação: npm ci; build: npm run build.
- Output Directory: sem Override. Não preencher N/A.
- Node: 24.x. Função com máximo de 60 segundos, preferencialmente próxima ao banco.
- Os arquivos novos de src/public precisam estar no GitHub; somente /public/ gerado é ignorado.

## Dependências de execução

- MONGO_URI_PROD / MONGO_URI_DEV: preservar nome do banco e liberar a rede da função. Preview deve usar banco isolado. Atlas/replica set é necessário para OTP e auditoria transacionais.
- JWT_SECRET: mínimo de 32 caracteres; substitui SESSION_SECRET como assinatura de sessão e JWT. Mudança revoga sessões antigas.
- RESEND_API_KEY, EMAIL_REMETENTE, URL_PUBLICA: envio e links de códigos/notificações. SMTP não é mais utilizado.
- RECAPTCHA_SECRET e a chave pública v3 já existente RECAPTCHA_SITE_KEY: o domínio deve corresponder à implantação.
- CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET: upload autenticado pelo servidor. Preset unsigned não é usado nos novos uploads.

O banco existente e os arquivos antigos não são movidos automaticamente. Novos anexos são comprimidos antes do envio e validados pelo servidor: limite final de 3 MB e teto de transporte de 4 MB. Vídeos nas denúncias têm até 60 segundos e são convertidos também pelo Cloudinary; imagens antigas em base64 ainda precisam de avaliação para evitar exceder o limite de resposta de 4,5 MB da Vercel. O script migrar:imagens permanece disponível, em modo de simulação por padrão; não execute migrações no build.

## Verificação

Valide /health, login, cadastro, confirmação por e-mail, recuperação, publicação com declaração, upload, protocolo e painel antes de retirar a hospedagem anterior. Contas antigas sem isVerified continuam entrando normalmente; novos cadastros pendentes precisam ser concluídos pela tela de cadastro. Alterações neste workspace não são publicadas sem enviar os arquivos ao GitHub e efetuar o deploy.

Referência: [Express na Vercel](https://vercel.com/docs/frameworks/backend/express).

<!-- // [Melhoria Proativa Adicionada: documentação sincronizada com uploads inspecionados e autenticação versionada] -->

## Ativação do remetente

Configure RESEND_API_KEY, EMAIL_REMETENTE autorizado no Resend e URL_PUBLICA HTTPS na Vercel, depois faça novo deploy. Não é necessário alterar código. Sem configuração, o cadastro/recuperação informa indisponibilidade; login de conta ativa continua funcionando. O endereço onboarding@resend.dev é restrito a testes para o e-mail da própria conta Resend, não libera envio para outros usuários. O site pode continuar em vercel.app, mas o Resend exige domínio de envio verificado para destinatários reais: https://resend.com/docs/knowledge-base/403-error-resend-dev-domain.
