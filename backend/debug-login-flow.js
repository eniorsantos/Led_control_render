// Debug completo do fluxo de login - replica exatamente o que o endpoint faz
require('dotenv').config();
const db = require('./src/db.unified');
const bcrypt = require('bcrypt');

async function debugLoginFlow(login, senha) {
  console.log(`\n=== DEBUG LOGIN FLOW ===`);
  console.log(`Login: "${login}"`);
  console.log(`Senha: "${senha}" (length: ${senha.length})`);
  console.log(`Database: ${db.USING_POSTGRES ? 'PostgreSQL' : 'SQLite'}`);
  console.log(`Node: ${process.version}`);

  try {
    // PASSO 1: Query exata do endpoint
    console.log('\n--- PASSO 1: Buscar usuário ---');
    const sql = 'SELECT * FROM usuarios WHERE login = ?';
    console.log(`SQL: ${sql}`);
    console.log(`Params: ["${login}"]`);

    const stmt = db.prepare(sql);
    console.log(`Statement type: ${stmt.constructor.name}`);

    const user = await stmt.get(login);
    console.log(`Resultado: ${user ? 'ENCONTRADO' : 'NÃO ENCONTRADO'}`);

    if (!user) {
      console.log('\n❌ USUÁRIO NÃO ENCONTRADO');
      // Buscar todos para comparação
      const all = await db.prepare('SELECT login, senha FROM usuarios').all();
      console.log('Usuários no banco:');
      all.forEach(u => console.log(`  - "${u.login}" (${u.senha.substring(0,30)}...)`));
      return;
    }

    console.log(`\nUsuário encontrado:`);
    console.log(`  login: "${user.login}"`);
    console.log(`  perfil: ${user.perfil}`);
    console.log(`  nome: "${user.nome}"`);
    console.log(`  senha (full): ${user.senha}`);
    console.log(`  senha length: ${user.senha.length}`);
    console.log(`  starts with $2b$: ${user.senha.startsWith('$2b$')}`);
    console.log(`  bcrypt version in hash: $${user.senha.split('$')[1]} (should be 2b)`);

    // PASSO 2: Validação de senha (cópia exata do index.js)
    console.log('\n--- PASSO 2: Validar senha ---');
    let senhaValida;
    try {
      if (user.senha.startsWith('$2b$')) {
        console.log('  Usando bcrypt.compareSync...');
        console.log(`  Hash: ${user.senha}`);
        console.log(`  Input: "${senha}"`);

        // Testar também com compare (async) para ver se dá diferença
        const syncResult = bcrypt.compareSync(senha, user.senha);
        console.log(`  compareSync result: ${syncResult}`);

        const asyncResult = await bcrypt.compare(senha, user.senha);
        console.log(`  compare (async) result: ${asyncResult}`);

        senhaValida = syncResult;
      } else {
        console.log('  Comparação direta (plaintext)...');
        senhaValida = user.senha === senha;
        console.log(`  Direto: ${senhaValida}`);
      }
    } catch (e) {
      console.log(`  ❌ ERRO no bcrypt: ${e.message}`);
      console.log(e.stack);
      senhaValida = user.senha === senha;
      console.log(`  Fallback direto: ${senhaValida}`);
    }

    // PASSO 3: Testar variações da senha
    console.log('\n--- PASSO 3: Testar variações ---');
    const variacoes = [
      senha,
      senha.trim(),
      senha.replace(/\s+/g, ''),
      login === 'admin' ? 'admin123' :
      login === 'regional' ? 'reg123' :
      login === 'operador' ? 'op123' :
      login === 'viewer' ? 'view123' : null,
    ].filter(Boolean);

    for (const v of variacoes) {
      if (v === senha) continue; // já testou
      try {
        const r = user.senha.startsWith('$2b$') ? bcrypt.compareSync(v, user.senha) : v === user.senha;
        if (r) console.log(`  ✅ FUNCIONOU com: "${v}"`);
      } catch {}
    }

    // PASSO 4: Gerar hash da senha fornecida para comparar
    console.log('\n--- PASSO 4: Hash da senha fornecida ---');
    const novoHash = bcrypt.hashSync(senha, 10);
    console.log(`  Novo hash (cost 10): ${novoHash}`);
    console.log(`  Hash no banco:       ${user.senha}`);
    console.log(`  São iguais? ${novoHash === user.senha}`);

    // Verificar custo do hash no banco
    const hashParts = user.senha.split('$');
    if (hashParts.length >= 4) {
      console.log(`  Custo do hash no banco: ${hashParts[2]}`);
    }

    // PASSO 5: Testar se o problema é encoding
    console.log('\n--- PASSO 5: Verificar encoding ---');
    console.log(`  Senha bytes: ${Buffer.from(senha).toString('hex')}`);
    console.log(`  Login bytes: ${Buffer.from(login).toString('hex')}`);

    // PASSO 6: JWT
    if (senhaValida) {
      console.log('\n--- PASSO 6: JWT ---');
      const JWT_SECRET = process.env.JWT_SECRET || 'led-control-dev';
      console.log(`  JWT_SECRET (preview): ${JWT_SECRET.substring(0, 10)}...`);
      const token = require('jsonwebtoken').sign(
        { login: user.login, perfil: user.perfil, nome: user.nome },
        JWT_SECRET,
        { expiresIn: '12h' }
      );
      console.log(`  Token OK: ${token ? 'SIM' : 'NÃO'}`);
    }

    console.log(`\n=== RESULTADO FINAL: ${senhaValida ? '✅ LOGIN VÁLIDO' : '❌ LOGIN INVÁLIDO'} ===`);

  } catch (e) {
    console.error('\n❌ ERRO GERAL:', e.message);
    console.error(e.stack);
  }
}

// Permitir testar múltiplos usuários
const args = process.argv.slice(2);
if (args.length === 0) {
  // Testar todos os usuários padrão
  const credenciais = [
    ['admin', 'admin123'],
    ['regional', 'reg123'],
    ['operador', 'op123'],
    ['viewer', 'view123'],
  ];

  (async () => {
    for (const [l, s] of credenciais) {
      await debugLoginFlow(l, s);
      console.log('\n' + '='.repeat(60));
    }
    process.exit(0);
  })();
} else if (args.length >= 2) {
  debugLoginFlow(args[0], args[1]).then(() => process.exit(0));
} else {
  console.log('Uso: node debug-login-flow.js [login] [senha]');
  console.log('Sem args: testa todos os usuários padrão');
  process.exit(1);
}