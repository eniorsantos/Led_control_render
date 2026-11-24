-- ============================================================
-- DIAGNÓSTICO DE LOGIN - RODE NO SUPABASE SQL EDITOR
-- ============================================================

-- 1. VERIFICAR USUÁRIOS EXISTENTES
-- ============================================================
SELECT
  login,
  perfil,
  nome,
  senha,
  CASE WHEN senha LIKE '$2b$%' THEN 'bcrypt' ELSE 'plaintext/outro' END as tipo_senha,
  length(senha) as senha_length,
  -- Extrair custo do bcrypt (ex: $2b$10$... -> custo 10)
  CASE
    WHEN senha LIKE '$2b$%$%' THEN split_part(senha, '$', 3)
    ELSE NULL
  END as bcrypt_cost,
  -- Primeiros 30 chars para visualização
  left(senha, 30) as senha_preview
FROM usuarios
ORDER BY login;

-- 2. TESTAR COMPARAÇÃO BCRYPT DIRETO NO POSTGRES (pgcrypto)
-- ============================================================
-- Substitua 'admin' e 'admin123' pelos valores que você está testando
-- Esta query retorna TRUE se a senha estiver correta
SELECT
  login,
  crypt('admin123', senha) = senha as senha_correta
FROM usuarios
WHERE login = 'admin';

-- Repita para cada usuário:
-- SELECT login, crypt('reg123', senha) = senha as senha_correta FROM usuarios WHERE login = 'regional';
-- SELECT login, crypt('op123', senha) = senha as senha_correta FROM usuarios WHERE login = 'operador';
-- SELECT login, crypt('view123', senha) = senha as senha_correta FROM usuarios WHERE login = 'viewer';

-- 3. VERIFICAR CASE SENSITIVITY (MUITO COMUM NO POSTGRES)
-- ============================================================
-- Postgres é case-sensitive por default!
-- Se o login no banco for 'Admin' (maiúsculo) e você enviar 'admin', não acha
SELECT login, octet_length(login) as bytes_login, login = 'admin' as is_exact_admin
FROM usuarios
WHERE lower(login) = 'admin';

-- 4. VERIFICAR WHITESPACE INVISÍVEL
-- ============================================================
SELECT
  login,
  senha,
  -- Verifica espaços no início/fim
  senha != trim(senha) as tem_whitespace,
  -- Mostra caracteres invisíveis
  regexp_replace(senha, '[^\x20-\x7E]', '?', 'g') as senha_visible
FROM usuarios;

-- 5. GERAR HASHES CORRETOS PARA REINSERIR (se necessário)
-- ============================================================
-- Rode isto no terminal do seu PC (Node.js) para gerar hashes válidos:
-- node -e "console.log(require('bcrypt').hashSync('admin123', 10))"
-- node -e "console.log(require('bcrypt').hashSync('reg123', 10))"
-- node -e "console.log(require('bcrypt').hashSync('op123', 10))"
-- node -e "console.log(require('bcrypt').hashSync('view123', 10))"

-- 6. REINSERIR USUÁRIOS COM HASHES CORRETOS (se hashes estiverem ruins)
-- ============================================================
-- DESCOMENTE E SUBSTITUA OS HASHES ABAIXO PELOS GERADOS NO PASSO 5:
/*
DELETE FROM usuarios WHERE login IN ('admin','regional','operador','viewer');

INSERT INTO usuarios (login, senha, perfil, nome) VALUES
  ('admin', '$2b$10$SEU_HASH_AQUI', 'admin', 'Administrador'),
  ('regional', '$2b$10$SEU_HASH_AQUI', 'regional', 'Gestor Regional'),
  ('operador', '$2b$10$SEU_HASH_AQUI', 'operador', 'Operador'),
  ('viewer', '$2b$10$SEU_HASH_AQUI', 'visualizador', 'Visualizador')
ON CONFLICT (login) DO UPDATE SET
  senha = EXCLUDED.senha,
  perfil = EXCLUDED.perfil,
  nome = EXCLUDED.nome;

-- Vincular regional a Aracaju
INSERT INTO usuario_cidade (login, cidade_id) VALUES ('regional', 'aracaju')
ON CONFLICT DO NOTHING;
*/

-- 7. VERIFICAR SE EXISTE EXTENSÃO pgcrypto (necessária para crypt())
-- ============================================================
SELECT * FROM pg_extension WHERE extname = 'pgcrypto';

-- Se não existir, rode: CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 8. TESTE COMPLETO SIMULANDO O ENDPOINT
-- ============================================================
-- Simula exatamente o que o backend faz:
DO $$
DECLARE
  test_login TEXT := 'admin';      -- ALTERE AQUI
  test_senha TEXT := 'admin123';   -- ALTERE AQUI
  u RECORD;
  senha_valida BOOLEAN;
BEGIN
  -- Busca usuário (case-sensitive!)
  SELECT * INTO u FROM usuarios WHERE login = test_login;

  IF NOT FOUND THEN
    RAISE NOTICE 'USUÁRIO NÃO ENCONTRADO: %', test_login;
    RETURN;
  END IF;

  RAISE NOTICE 'Usuário encontrado: % (perfil: %)', u.login, u.perfil;
  RAISE NOTICE 'Hash no banco: %', left(u.senha, 50);

  -- Testa bcrypt
  IF u.senha LIKE '$2b$%' THEN
    senha_valida := crypt(test_senha, u.senha) = u.senha;
    RAISE NOTICE 'bcrypt.compare: %', senha_valida;
  ELSE
    senha_valida := u.senha = test_senha;
    RAISE NOTICE 'plaintext compare: %', senha_valida;
  END IF;

  IF senha_valida THEN
    RAISE NOTICE '✅ LOGIN VÁLIDO';
  ELSE
    RAISE NOTICE '❌ LOGIN INVÁLIDO';
    -- Testa variações
    RAISE NOTICE 'Testando trim: %', crypt(trim(test_senha), u.senha) = u.senha;
  END IF;
END $$;

-- 9. VERIFICAR TABELAS RELACIONADAS
-- ============================================================
SELECT 'usuarios' as tabela, count(*) as total FROM usuarios
UNION ALL
SELECT 'usuario_cidade', count(*) FROM usuario_cidade
UNION ALL
SELECT 'cidades', count(*) FROM cidades
UNION ALL
SELECT 'config', count(*) FROM config;