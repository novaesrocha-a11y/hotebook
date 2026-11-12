# HotelBook

Este projeto é um sistema de reservas de hotéis com telas de cadastro, perfil e admin.

## Estrutura do Projeto

- `index.html`: Página inicial.
- `cadastro.html`: Tela de cadastro de usuários.
- `perfil.html`: Tela de perfil do usuário.
- `admin.html`: Tela administrativa com tabela de quartos.
- `styles/styles.css`: Estilos do projeto.
- `scripts/app.js`: Lógica JavaScript do projeto.

## Como Executar

1. Instale o Node.js 20 ou superior.
2. Execute `npm install`.
3. Execute `npm start` e abra `http://localhost:3000`.

## Acessos de demonstração

- Cliente: `cliente@hotelbook.com` / `Estadia#2026!` (ou crie uma conta pelo formulário).
- Administrador: `admin@hotelbook.com` / `admin123`.

## API

A API REST roda na mesma origem das páginas. Contas, quartos e reservas são persistidos em SQLite em `server/data/hotelbook.sqlite`; senhas são armazenadas com hash e a sessão fica em cookie `HttpOnly`.

- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- `GET /api/me`, `PATCH /api/me`
- `GET /api/reservations`
- `GET /api/admin/rooms`, `POST /api/admin/rooms`, `PATCH /api/admin/rooms/:id`, `DELETE /api/admin/rooms/:id`
- `GET /api/health`

O administrador deve ser criado com a senha de demonstração na primeira execução. Para configurar segredos próprios, copie `.env.example` para `.env` e altere as credenciais antes de publicar. Em produção, `SESSION_SECRET`, `ADMIN_PASSWORD` e `DEMO_CLIENT_PASSWORD` são obrigatórios. As contas e reservas iniciais são dados de demonstração.

## Publicar para apresentação

O arquivo `render.yaml` configura o deploy do aplicativo completo como um serviço Node no Render.

1. Envie o projeto para um repositório GitHub.
2. No Render, escolha **New > Blueprint** e conecte esse repositório.
3. Quando solicitado, defina senhas fortes para `ADMIN_PASSWORD` e `DEMO_CLIENT_PASSWORD`; `SESSION_SECRET` é gerado automaticamente.
4. Aguarde o deploy e abra o endereço `.onrender.com` indicado no painel.

O Blueprint configura o serviço no plano pago Starter e monta um disco persistente de 1 GB em `/var/data`; o banco SQLite usa `/var/data/hotelbook.sqlite`, preservando contas, quartos e reservas entre reinicializações e deploys. O disco persistente do Render requer um serviço pago. Para alterar a configuração, mantenha `DATABASE_PATH` apontando para um caminho dentro do ponto de montagem do disco.