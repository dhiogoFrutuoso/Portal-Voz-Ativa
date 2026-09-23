# Governança implementada — Portal Voz Ativa

## Decisões aplicadas

- O portal é uma iniciativa pessoal independente. Termos, política, navbar e footer não afirmam vínculo oficial com a Prefeitura. O contato público já existente é o canal de privacidade, sem nomear um DPO inexistente.
- A aplicação continua web, Express/Handlebars, sem APK. O layout global permanece compartilhado por todas as telas novas.
- A autenticação mantém Passport e sessão no MongoDB. A identidade serializada é um JWT HS256, assinado com `JWT_SECRET`, contendo `tokenVersion`. Cada requisição consulta a versão e a confirmação do e-mail no banco. O JWT não é entregue ao JavaScript do navegador.
- `JWT_SECRET` também assina o cookie da sessão e protege os hashes de OTP por HMAC-SHA-256. Não é necessário um novo segredo. Sessões antigas deixam de ser aceitas.
- Contas novas iniciam com `isVerified: false`. Contas antigas sem confirmação também precisam comprovar acesso ao e-mail. Nenhuma migração declara uma verificação que não ocorreu; o link “Verificar e-mail” permite solicitar o código.
- Registro do aceite da versão dos termos é separado de consentimento genérico. Nas manifestações, IP, agente do navegador, data e declaração são campos imutáveis. Registros antigos não recebem uma declaração fictícia retroativa.
- `isConfidential` mascara identidade na saída, incluindo comentários e links de perfil. Não altera a regra separada de acesso ao conteúdo (`privada`). Perfis públicos excluem publicações com identidade protegida. O vínculo real fica no banco.
- As rotas alternativas de comentários/curtidas de denúncias agora aplicam a mesma autorização de acesso do detalhe.

## Contratos de execução

O banco precisa suportar transações: MongoDB Atlas/replica set. Consumo de OTP e atualização de conta são atômicos. Alterações administrativas por query e sua evidência também são atômicas; falha no log desfaz a alteração. Os índices de `otp`, `sessions`, `rate_limits`, `accesslogs` e `media` precisam poder ser criados pelo ambiente.

Variáveis secretas: `JWT_SECRET` (mínimo 32 caracteres), `RECAPTCHA_SECRET`, `RESEND_API_KEY`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` e as URIs existentes `MONGO_URI_PROD`/`MONGO_URI_DEV`. `EMAIL_REMETENTE` e `URL_PUBLICA` alimentam os e-mails; `CLOUDINARY_CLOUD_NAME` identifica a conta. A variável pública `RECAPTCHA_SITE_KEY`, já existente na integração v3, foi preservada porque o navegador precisa da chave pública. Nenhuma nova variável de segredo foi criada. SMTP e preset unsigned não são mais usados pelo fluxo ativo.

## OTP e senha

- Código de seis dígitos gerado com `crypto.randomInt`, incluindo 999999.
- Hash com segredo; código simples nunca persistido nem registrado nos logs.
- Validade de dez minutos, verificada na query e com índice TTL para limpeza.
- Cinco tentativas reservadas atomicamente, cooldown de 60 segundos por e-mail/finalidade e limite por IP.
- Respostas genéricas de recuperação/reenvio; o envio é agendado com `waitUntil` na Vercel para não expor a latência do provedor na resposta.
- Consumo único por transação e invalidação dos códigos da conta após sucesso.
- Reset ou troca de senha incrementa `tokenVersion`. Senhas usam bcrypt e respeitam seu limite de 72 bytes.
- Resend envia HTML inline e texto simples. As mensagens de OTP não incluem o código na URL. Falhas não expõem o endereço existente ao solicitante; novo envio pode ser solicitado após o cooldown. Não há fila durável com retry automático.

## Arquivos

Novos arquivos passam por `POST /uploads`, com CSRF em cabeçalho e Multer em memória. O teto é 3 MB por arquivo para ficar abaixo do limite da Vercel. JPEG/PNG/WebP são reconhecidos por bytes e decodificados pelo sharp; a saída WebP elimina EXIF e outros metadados. Há limite de pixels e rejeição de imagens animadas. PDF é parseado e documentos criptografados, ativos ou com anexos são recusados. Isso não equivale a um antivírus completo.

O servidor faz upload autenticado ao Cloudinary e registra um recibo em `media`. Só URLs inspecionadas e vinculadas ao usuário/sessão podem ser usadas como novo anexo. URLs antigas já salvas continuam renderizáveis e podem ser mantidas no editor. Novos vídeos/Word/executáveis não são aceitos. PDF é permitido no recurso; os seletores de foto aceitam somente imagens.

Mídia Cloudinary continua com URL de entrega pública, como no projeto existente: esconder a identidade ou restringir a página não torna a URL privada. O armazenamento com entrega autenticada de anexos confidenciais, migração de URLs antigas e política de retenção documental exigem tratamento específico antes de alegar sigilo integral. Não houve alteração de dados, arquivos ou configurações nas contas reais.

## Auditoria e limites

`AuditLog` não tem rotas públicas de edição, exclusão ou consulta. O modelo bloqueia mutações e registra administrador, ação, alvo, estados anterior/posterior, IP, agente e data. Essa proteção é da aplicação; não impede que um administrador do MongoDB use o driver bruto. Para garantia operacional, restrinja privilégios da coleção, mantenha backups e controle separado de acesso ao banco. Não se apresenta esse mecanismo como armazenamento WORM ou certificação jurídica de prova.

`AccessLog` mantém IP/data de acessos dinâmicos ao Express por seis meses, sem query string nem credenciais, usando TTL. Assets servidos pela CDN não passam nesse middleware. Ordens específicas de preservação precisam suspender a expiração dos registros alcançados antes da limpeza automática; o portal não automatiza o recebimento dessas ordens.

## Validação automatizada

`npm test`, `npm run test:vercel` e `npm run test:governanca` usam bases descartáveis. O último cobre concorrência de OTP, limite de tentativas, expiração, reset e revogação, aceite obrigatório, honeypot, upload inválido, EXIF, PDF ativo, sigilo e rollback de auditoria. A entrega real pelo Resend, as chaves reais e as permissões do cluster de produção não foram exercitadas pelos testes.

<!-- // [Melhoria Proativa Adicionada: contratos e limitações verificáveis sem prometer conformidade jurídica automática] -->
