# Deploy online gratuito: Vercel + Supabase + Gemini

Este projeto continua sendo a mesma aplicacao, mas agora esta preparado para usar banco online em vez de depender do localStorage como base principal.

## 1. Supabase

1. Crie um projeto gratuito no Supabase.
2. Abra SQL Editor.
3. Execute o arquivo `supabase/schema.sql`.
4. Copie:
   - Project URL
   - anon public key
   - service_role key

## 2. Vercel

1. Suba esta pasta para um repositorio GitHub.
2. Importe o repositorio na Vercel.
3. Configure:
   - Build Command: `npm run build`
   - Output Directory: `vercel-dist`
4. Em Environment Variables, cadastre:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `GEMINI_API_KEY`

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` ou `GEMINI_API_KEY` no frontend.

## 3. Como a persistencia funciona

- Em `file://`, a aplicacao continua usando localStorage para funcionar localmente.
- Em URL online, a aplicacao busca clientes, registros, comentarios, configuracoes e insights nas APIs da Vercel.
- Importacao XLSX continua no navegador.
- Depois da leitura do XLSX, os dados normalizados sao enviados para `/api/import-clients`.

## 4. Rotas API criadas

- `GET /api/clients`
- `POST /api/import-clients`
- `POST /api/save-client`
- `POST /api/delete-client`
- `POST /api/save-record`
- `POST /api/delete-record`
- `GET /api/comments`
- `POST /api/save-comment`
- `GET /api/settings`
- `POST /api/settings`
- `GET /api/ai-insights`
- `POST /api/ai-insights`
- `POST /api/save-insight`
- `POST /api/delete-insight`

## 5. IA

O frontend chama apenas `/api/ai-insights`.
A chave Gemini fica somente na Vercel em `GEMINI_API_KEY`.

## 6. Primeiro uso online

Depois do deploy:

1. Acesse a URL da Vercel.
2. Entre como administrador.
3. Importe o XLSX inicial.
4. Confira clientes, dashboard e tela de cliente.
5. Gere um insight IA para validar Gemini.

Se o banco estiver vazio, a versao online nao cria clientes ficticios automaticamente.
