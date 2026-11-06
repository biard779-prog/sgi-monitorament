# SGI Almoxarifado · Monitoramento de Aplicações (site próprio)

Este pacote é o painel como **site de verdade**, igual ao site de compras (Render): endereço https próprio,
login e senha no servidor, banco de dados, perfis (administradora x visualização) e dados atualizados para todos.

## O que tem aqui
- `server.js` – servidor (login, perfis, banco de dados, site)
- `public/index.html` – o painel
- `package.json` – dependências (express, bcryptjs, pg)

## Como publicar no Render (passo a passo)
1. **Guarde os arquivos no GitHub** (repositório *privado*): crie uma conta em github.com, clique em *New repository*,
   envie todos os arquivos desta pasta (menos `node_modules` e `data`).
   Se o site de compras foi feito por alguém (desenvolvedor), entregue esta pasta a essa pessoa: ela publica em minutos.
2. No **render.com**: *New +* → *Web Service* → conecte o repositório.
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
3. Em **Environment** (variáveis de ambiente), crie:
   | Variável | Para que serve |
   |---|---|
   | `SESSION_SECRET` | texto longo e aleatório (mantém as pessoas conectadas) |
   | `SETUP_CODE` | código **só seu** para criar a conta de administradora no primeiro acesso |
   | `DATABASE_URL` | endereço do banco Postgres (veja "Onde ficam os dados") |
   | `SITE_TITLE` | (opcional) nome do site na aba do navegador |
   | `ANALYTICS_HTML` | (opcional) código do Google Analytics, Plausible ou Cloudflare Web Analytics |
   | `ADMIN_MAT` / `ADMIN_NAME` | (opcional) por padrão: 5761 / BIANCA SANTOS |
4. Clique em *Create Web Service*. Quando terminar, o Render mostra o endereço, por exemplo
   `https://sgi-rd.onrender.com` (o nome é o que você escolher ao criar o serviço).
5. **Primeiro acesso:** abra o endereço, aguarde a capa, e na tela *Primeiro acesso* digite o `SETUP_CODE` e crie a sua senha.
   Depois disso essa opção deixa de existir (só pode haver uma administradora).

## Onde ficam os dados (importante)
- **Recomendado:** um banco **Postgres** (no Render: *New +* → *PostgreSQL*; copie a *Internal Database URL* para `DATABASE_URL`).
  Os dados ficam seguros mesmo se o servidor reiniciar ou for atualizado.
- Alternativa: disco persistente do Render montado em uma pasta e `DATA_DIR=/pasta` (o painel grava um arquivo `data.json`).
- **Sem** `DATABASE_URL` e sem disco persistente, os dados ficam em disco temporário e **são perdidos** quando o servidor reinicia.
- Confira no Render os planos, limites e preços atuais (planos gratuitos podem hibernar o site e ter limites no banco).

## Levar os dados do painel atual (claude.ai) para o site
1. No painel atual: *Configurações → Backup e dados → Exportar JSON*.
2. No site novo (logada como administradora): *Configurações → Backup e dados → Importar backup (JSON)*.
3. As **contas de acesso não vão no backup** (por segurança). Cada pessoa usa *Criar cadastro* e você aprova em *Configurações → Acessos*,
   ou você cria o acesso com senha provisória.

## Acesso das pessoas
- Envie só o endereço do site. A pessoa abre, toca em **Criar cadastro** (nome, matrícula, senha) e você **aprova** em *Configurações → Acessos*.
- Quem foi aprovado entra com matrícula e senha e **só pode filtrar o painel** (somente leitura). Os dados atualizam sozinhos a cada ~30 s.
- Em celular, abra o site e use "Adicionar à tela inicial" para ter um ícone de aplicativo.

## Domínio próprio (opcional)
No Render: *Settings → Custom Domains* (precisa ter um domínio registrado, ex.: `monitoramento.suaempresa.com.br`).

## Segurança
- Senhas são guardadas com bcrypt; a sessão fica em cookie HttpOnly; há bloqueio após tentativas erradas.
- O servidor decide quem lê e quem grava: só a administradora grava os dados; visualizadoras só leem.
- Mantenha o repositório privado e não divulgue `SETUP_CODE`, `SESSION_SECRET` nem `DATABASE_URL`.
- Faça cópias de segurança: *Configurações → Backup e dados → Exportar JSON/Excel* (guarde fora do site).

## Rodar no seu computador (teste)
```
npm install
SESSION_SECRET=teste SETUP_CODE=meucodigo npm start
```
Abra http://localhost:3000
