// Script de diagnóstico para testar login
// Uso: node test-login.js [login] [senha]

require('dotenv').config();
const db = require('./src/db.unified');
const bcrypt = require('bcrypt');

async function testLogin(login, senha) {
  console.log(`\n=== Testando login: ${login} / ${senha} ===`);
  console.log(`Database: ${db.USING_POSTGRES ? 'PostgreSQL' : 'SQLite'}`);

  try {
    // 1. Verificar se usuário existe
    const user = await db.prepare('SELECT * FROM usuarios WHERE login = ?').get(login);
    console.log('\n1. Usuário encontrado:', user ? 'SIM' : 'NÃO');

    if (!user) {
      console.log('   ERRO: Usuário não existe no banco');
      // Listar todos os usuários
      const all = await db.prepare('SELECT login, senha, perfil FROM usuarios').all();
      console.log('\n   Usuários no banco:');
      all.forEach(u => {
        const isHash = u.senha.startsWith('$2b$');
        console.log(`     - ${u.login} | hash: ${isHash ? 'bcrypt' : 'plain'} | perfil: ${u.perfil} | senha: ${u.senha.substring(0, 20)}...`);
      });
      return;
    }

    console.log(`   Login: ${user.login}`);
    console.log(`   Perfil: ${user.perfil}`);
    console.log(`   Nome: ${user.nome}`);
    console.log(`   Senha no banco (primeiros 30 chars): ${user.senha.substring(0, 30)}`);
    console.log(`   É hash bcrypt: ${user.senha.startsWith('$2b$')}`);

    // 2. Testar comparação de senha
    console.log('\n2. Testando comparação de senha:');
    let senhaValida;
    try {
      if (user.senha.startsWith('$2b$')) {
        console.log('   Usando bcrypt.compareSync...');
        senhaValida = bcrypt.compareSync(senha, user.senha);
        console.log(`   Resultado bcrypt: ${senhaValida}`);
      } else {
        console.log('   Comparação direta (texto plano)...');
        senhaValida = user.senha === senha;
        console.log(`   Resultado direto: ${senhaValida}`);
        console.log(`   Esperado: "${user.senha}" | Recebido: "${senha}"`);
      }
    } catch (e) {
      console.log(`   ERRO no bcrypt: ${e.message}`);
      senhaValida = user.senha === senha;
      console.log(`   Fallback direto: ${senhaValida}`);
    }

    if (!senhaValida) {
      console.log('\n   ❌ SENHA INVÁLIDA');
      // Testar hash da senha fornecida
      const testHash = bcrypt.hashSync(senha, 10);
      console.log(`   Hash da senha fornecida: ${testHash}`);
      console.log(`   Hash no banco: ${user.senha}`);
    } else {
      console.log('\n   ✅ SENHA VÁLIDA');
    }

    // 3. Testar geração de token
    if (senhaValida) {
      console.log('\n3. Testando geração de JWT...');
      const JWT_SECRET = process.env.JWT_SECRET || 'led-control-dev';
      const token = require('jsonwebtoken').sign(
        { login: user.login, perfil: user.perfil, nome: user.nome },
        JWT_SECRET,
        { expiresIn: '12h' }
      );
      console.log(`   Token gerado (primeiros 50 chars): ${token.substring(0, 50)}...`);
    }

  } catch (e) {
    console.error('\n❌ ERRO:', e.message);
    console.error(e.stack);
  }
}

// Credenciais padrão do seed
const login = process.argv[2] || 'admin';
const senha = process.argv[3] || 'admin123';

testLogin(login, senha).then(() => process.exit(0));