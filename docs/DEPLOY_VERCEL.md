# Publicação do Portal Voz Ativa na Vercel

## O que vai para cada serviço

O portal continua sendo uma aplicação Express com páginas Handlebars. Não precisa ser reescrito em React ou Next.js.

| Parte | Local após a mudança |
| --- | --- |
| Páginas, rotas, autenticação e regras | Função Node.js 24 da Vercel, entrada `src/index.js` |
| Templates | `src/views/`, incluídos no pacote da função |
| CSS, JavaScript e imagens do projeto | CDN da Vercel; o build copia `src/public/` para `public/` |
| Usuários, chamados, denúncias, anúncios e protocolos | MongoDB externo, mantendo o banco atual |
| Sessões de login | Coleção `sessions` no mesmo MongoDB, com expiração |
| Limites de requisições | Coleção `rate_limits` no MongoDB, com índice TTL |
| Fotos e vídeos enviados pelos usuários | Cloudinary; MongoDB guarda as URLs |
| Notificações | SMTP ou Resend, conforme as variáveis configuradas |
| Mapas e localização | Leaflet, OpenStreetMap e Nominatim, como antes |

Não há disco persistente para uploads na Vercel. O arquivo `.env` não deve ir para o GitHub. O build só prepara arquivos estáticos e não executa migrações nem acessa o banco.

## 1. Preparar banco e serviços

1. Guarde um backup do banco atual antes da troca.
2. Copie do painel da Render a URI do MongoDB usado em produção. Preserve o nome do banco dentro da URI: mudar esse nome pode fazer o portal parecer vazio. Se o banco atual já é externo e acessível, não precisa mover os dados para migrar a hospedagem.
3. No MongoDB Atlas, confirme o usuário em **Database Access** e a conectividade em **Network Access**. O usuário precisa ler/gravar no banco e criar os índices de expiração de `sessions` e `rate_limits`.
4. A Vercel usa IPs de saída dinâmicos por padrão. Se usar **Static IPs**, habilite a região da função e libere os endereços fornecidos no Atlas. Não use o IP obtido ao consultar o domínio do site: esse é o endereço de entrada, não o de saída. Sem IPs fixos, uma regra ampla como `0.0.0.0/0` permite conexão de qualquer origem e reduz a proteção de rede; escolha essa alternativa conscientemente, com autenticação forte e usuário restrito ao banco. Para denúncias sigilosas, prefira uma lista restrita. [Documentação de IPs de saída](https://vercel.com/kb/guide/how-to-allowlist-deployment-ip-address).
5. Preserve a conta e o cloud name do Cloudinary para manter as URLs das mídias existentes. Confirme que o upload preset usado pelo navegador é **unsigned**, permite os formatos necessários e tem limites adequados. Chaves secretas ficam somente no servidor.
6. Cadastre o domínio definitivo do portal nas configurações da chave reCAPTCHA usada pelo projeto. Valide a compatibilidade entre site key, secret e a integração existente. URLs temporárias de Preview também precisam estar autorizadas para testar login/cadastro; prefira um domínio de teste estável.
7. Se quiser notificações, mantenha as credenciais SMTP válidas ou configure o Resend com remetente e domínio verificados. SMTP tem prioridade se usuário e senha estiverem preenchidos. Não configure os dois esperando fallback automático: ele não existe.

## 2. Subir o código e importar o projeto

As mudanças precisam estar na branch do GitHub escolhida para publicação. Elas não são enviadas automaticamente por esta adaptação local. Se a Render acompanha essa mesma branch, um push também pode disparar um deploy lá; uma branch separada permite validar a Vercel antes da troca.

Na Vercel, use **Add New → Project**, conecte o GitHub e importe `dhiogoFrutuoso/Portal-Voz-Ativa`.

| Configuração | Valor |
| --- | --- |
| Root Directory | Raiz do repositório (`.`) |
| Framework Preset | Express |
| Node.js | 24.x, também fixado em `package.json` |
| Install Command | `npm ci` |
| Build Command | `npm run build`, já declarado em `vercel.json` |
| Output Directory | Padrão do framework, sem override |
| Production Branch | Branch que contém estas alterações |
| Function Region | Próxima da região do MongoDB |

Não selecione `public` como saída de um site estático: o portal precisa executar o backend. Não há comando de servidor persistente a cadastrar na Vercel. O arquivo `vercel.json` inclui os templates e define duração máxima de 60 segundos para a função. [Suporte oficial a Express](https://vercel.com/docs/frameworks/backend/express).

## 3. Variáveis de ambiente

Cadastre-as em **Settings → Environment Variables**, antes do deploy. Depois de alterar variáveis, faça um novo deploy.

| Variável | Como preencher |
| --- | --- |
| `NODE_ENV` | `production` na Vercel |
| `MONGO_URI_PROD` | URI completa do banco existente, incluindo seu nome |
| `SESSION_SECRET` | Valor aleatório de pelo menos 32 caracteres; mantenha estável entre deploys |
| `CLOUDINARY_CLOUD_NAME` | Cloud da conta que armazena as mídias atuais |
| `CLOUDINARY_UPLOAD_PRESET` | Preset unsigned autorizado para upload pelo navegador |
| `CLOUDINARY_API_KEY` | Chave da mesma conta Cloudinary |
| `CLOUDINARY_API_SECRET` | Segredo da mesma conta Cloudinary |
| `RECAPTCHA_SITE_KEY` | Chave pública autorizada para o novo domínio |
| `RECAPTCHA_SECRET` | Segredo correspondente |
| `URL_PUBLICA` | URL HTTPS definitiva, sem barra final, por exemplo `https://seu-portal.vercel.app` |
| `SMTP_USUARIO`, `SMTP_SENHA` | Se usar SMTP; Gmail exige senha de aplicativo |
| `SMTP_HOST`, `SMTP_PORTA` | Opcionais; padrões `smtp.gmail.com` e `587` |
| `RESEND_API_KEY` | Se usar Resend em vez de SMTP |
| `EMAIL_REMETENTE` | Remetente autorizado; no Resend, use seu domínio verificado |

Não configure `PORT` na Vercel. `MONGO_URI_DEV` serve para desenvolvimento local. `MONGO_URI` também é aceito como alternativa, mas prefira a variável específica de produção para evitar ambiguidades.

**Preview também executa Node em modo de produção.** Configure `MONGO_URI_PROD` no escopo Preview apontando para um banco de testes, com outro segredo de sessão e sem credenciais de envio de mensagens reais. Não compartilhe automaticamente todas as credenciais de Production com Preview. A URL pública também deve corresponder ao ambiente; se omitida, o código tenta usar o domínio fornecido pela Vercel.

## 4. Conferir imagens antigas e limites

A Vercel limita o corpo de requisição e resposta da função a 4,5 MB. O Express agora aceita formulários de até 1 MB; as mídias seguem diretamente para o Cloudinary. A vitrine foi corrigida para publicar URLs, em vez de embutir as fotos em base64. [Limites das funções](https://vercel.com/docs/functions/limitations).

O banco pode conter imagens antigas em base64. Uma página que as inclua pode exceder o limite de resposta, mesmo com os novos uploads corrigidos. O projeto já possui um script para localizar e migrar imagens de chamados, denúncias e vitrine:

```powershell
# Execute localmente com as variáveis corretas do banco de produção.
$env:NODE_ENV = 'production'
npm run migrar:imagens
```

Sem `--aplicar`, esse comando apenas mostra o que mudaria. Revise o resultado e o backup. Para executar os uploads e atualizar o banco:

```powershell
npm run migrar:imagens -- --aplicar
```

Essa migração não foi executada no banco real. O script não cobre todos os possíveis campos legados, como fotos de perfil. Verifique também páginas de listagem com muitos registros: algumas não têm paginação, e ainda podem crescer além do limite. Não execute migrações como parte do build da Vercel.

## 5. Validar antes de desligar a Render

- Abra `/health`: deve retornar `{"status":"ok"}`. Ele verifica a conexão com o MongoDB, não o funcionamento de todos os serviços externos.
- Abra a página inicial, os três hubs, detalhes e a página institucional. Confirme CSS, JavaScript, logos e mapas.
- Faça cadastro e login com reCAPTCHA real. Navegue e recarregue para confirmar que a sessão permanece ativa.
- Publique um chamado e um anúncio de teste, com foto. Edite e remova a foto, e confira o conteúdo salvo.
- Teste uma denúncia privada com autor, outro cidadão e administrador. Há observações de autorização preexistentes na análise arquitetural; mudar de hospedagem não corrige esses comportamentos automaticamente.
- Responda a um protocolo como administrador e confirme a chegada do e-mail, inclusive o link para o novo domínio.
- Abra logs de runtime na Vercel e procure erros de conexão, sessão, reCAPTCHA, Cloudinary ou e-mail.
- Configure o domínio próprio, se houver, seguindo os registros DNS exibidos pela Vercel; atualize `URL_PUBLICA` e os domínios do reCAPTCHA, e publique novamente.
- Só depois dos testes e da mudança de domínio retire o serviço da Render. Mantenha o banco e o Cloudinary ativos.

Os cookies do domínio da Render não migram para outro domínio; os visitantes precisarão entrar novamente. Contas, publicações e arquivos continuam disponíveis se você mantiver os mesmos serviços de dados.

## Mudanças técnicas e limites da validação

- `src/index.js`: exporta o Express para a Vercel e mantém `npm start` local; usa caminhos absolutos para templates; limita formulários; evita cache de páginas de sessão.
- `src/config/db.js`: reutiliza a conexão por instância, compartilha conexões em andamento e usa pool de até cinco conexões. Várias instâncias ainda multiplicam esse consumo; monitore o limite do cluster.
- `src/config/session.js`: persiste sessões no MongoDB por até sete dias, eliminando dependência da memória de uma instância.
- `src/config/rate-limit.js`: contadores atômicos compartilhados, por janela fixa e com limpeza TTL. Essas operações acrescentam tráfego ao banco.
- `src/helpers/email.js`: protege envios em andamento com `waitUntil` na Vercel, corrige a URL pública e limita esperas SMTP. Isso não é uma fila durável nem garante reenvio após falha. [Documentação de waitUntil](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package).
- `scripts/preparar-vercel.js` e `vercel.json`: preparam assets públicos e incluem os templates da função.
- Dependências e lockfile: atualizados com correções de segurança, mantendo as versões principais.
- `npm test`: renderização, protocolos e edição de imagens.
- `npm run test:vercel`: duas instâncias HTTP, conexão concorrente, sessão compartilhada, login, CSRF, TTL, limites de acesso e payload, usando MongoDB descartável.

Os testes locais não substituem a validação de um deploy real. Credenciais, DNS, regras de rede do Atlas, permissões do Cloudinary, cotas do plano e entrega real de mensagens precisam ser conferidos nos respectivos painéis. O código não foi publicado na Vercel por esta alteração.

## Diagnóstico rápido

| Sintoma | O que verificar |
| --- | --- |
| `/health` retorna 503 | URI, nome do banco, senha, regra de rede e disponibilidade do cluster |
| Falha de inicialização | `SESSION_SECRET` de no mínimo 32 caracteres e logs da função |
| Login/cadastro recusados | Domínio, tipo e par de chaves reCAPTCHA |
| Sessão não permanece | Permissões de `sessions`, índices, HTTPS e segredo estável |
| CSS ou imagens locais em 404 | Build executado, raiz correta e ausência de override de Output Directory |
| Upload falha | Cloud name, preset unsigned, formatos, limites e cotas do Cloudinary |
| E-mail não chega | Provedor configurado, remetente autorizado e logs; SMTP tem prioridade |
| Links levam à Render | `URL_PUBLICA` antiga; atualize e faça novo deploy |
| Erro 413 | Formulário grande, arquivo enviado ao backend ou HTML com base64/listagem excessiva |
| Erro 429 | Limite compartilhado de requisições atingido; aguarde a janela indicada |
