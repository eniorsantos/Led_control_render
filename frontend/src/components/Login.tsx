import { useState } from 'react';
import { api } from '../api';

interface LoginProps {
  token: string;
  login: string;
  setLogin: (v: string) => void;
  senha: string;
  setSenha: (v: string) => void;
  logando: boolean;
  setLogando: (v: boolean) => void;
  loginErro: string;
  setLoginErro: (v: string) => void;
  logo: string | null;
  onLogin: (resultado: { token: string; perfil: string; nome: string }) => void;
  /** Modo bootstrap: cria o primeiro admin (sem auth, só funciona se não houver admin) */
  bootstrap?: boolean;
  setBootstrap?: (v: boolean) => void;
  onBootstrap: (resultado: { token: string; refresh_token: string; perfil: string; nome: string; login: string }) => void;
}

export default function Login({
  login,
  setLogin,
  senha,
  setSenha,
  logando,
  setLogando,
  loginErro,
  setLoginErro,
  logo,
  onLogin,
  bootstrap = false,
  setBootstrap,
  onBootstrap,
}: LoginProps) {
  const [localErro, setLocalErro] = useState(loginErro);
  const [bootstrapLogin, setBootstrapLogin] = useState('admin');
  const [bootstrapNome, setBootstrapNome] = useState('Administrador');

  const fazerLogin = async () => {
    setLogando(true);
    setLocalErro('');
    try {
      const r = await api.login(login, senha);
      onLogin(r);
    } catch {
      setLocalErro('Login inválido — use admin/admin123 (demo). Entrando offline…');
    } finally {
      setLogando(false);
    }
  };

  const fazerBootstrap = async () => {
    if (!senha || senha.length < 6) {
      setLocalErro('Senha obrigatória (mín. 6 caracteres)');
      setLogando(false);
      return;
    }
    setLogando(true);
    setLocalErro('');
    try {
      const r = await api.bootstrapAdmin(senha, bootstrapLogin, bootstrapNome);
      onBootstrap(r);
    } catch (e: any) {
      setLocalErro(e.message || 'Erro ao criar admin');
    } finally {
      setLogando(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="card login-card">
        <div className="brand" style={{ marginBottom: 12 }}>
          {logo ? (
            <img className="brand-logo" src={logo} alt="Marca Controle de LED" />
          ) : (
            <div className="icon" aria-hidden="true">
              📺
            </div>
          )}
          <div>
            <h1>CONTROLE DE LED</h1>
            <span>PAINÉIS DE VEICULAÇÃO</span>
          </div>
        </div>

        {!bootstrap ? (
          <>
            <h2>Login</h2>
            <p className="sub">Fluxo §5 · perfis §9.2 (admin / regional / operador / visualizador)</p>
            <label htmlFor="login-input">Login</label>
            <input
              id="login-input"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="login"
              aria-describedby={localErro ? 'login-erro' : undefined}
            />
            <label htmlFor="senha-input">Senha</label>
            <input
              id="senha-input"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="senha"
              aria-describedby={localErro ? 'login-erro' : undefined}
            />
            {localErro && (
              <p
                id="login-erro"
                className="sub"
                style={{ color: 'var(--red)' }}
                role="alert"
                aria-live="polite"
              >
                {localErro}
              </p>
            )}
            <button onClick={fazerLogin} disabled={logando}>
              {logando ? 'Entrando…' : 'Entrar'}
            </button>
            {setBootstrap && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setBootstrap(true)}
                style={{ marginTop: 8, display: 'block' }}
              >
                Nenhum admin cadastrado? Criar primeiro admin
              </button>
            )}
            <p className="sub" style={{ marginTop: 10 }}>
              Demo: admin/admin123 · viewer/view123
            </p>
          </>
        ) : (
          <>
            <h2>Criar Primeiro Admin</h2>
            <p className="sub">
              Não há administrador cadastrado. Defina a senha para o usuário admin inicial.
            </p>
            <label htmlFor="bootstrap-login">Login do admin</label>
            <input
              id="bootstrap-login"
              value={bootstrapLogin}
              onChange={(e) => setBootstrapLogin(e.target.value)}
              placeholder="admin"
            />
            <label htmlFor="bootstrap-nome">Nome completo</label>
            <input
              id="bootstrap-nome"
              value={bootstrapNome}
              onChange={(e) => setBootstrapNome(e.target.value)}
              placeholder="Administrador"
            />
            <label htmlFor="bootstrap-senha">Senha (mín. 6 caracteres)</label>
            <input
              id="bootstrap-senha"
              type="password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              placeholder="senha"
              aria-describedby={localErro ? 'login-erro' : undefined}
            />
            {localErro && (
              <p
                id="login-erro"
                className="sub"
                style={{ color: 'var(--red)' }}
                role="alert"
                aria-live="polite"
              >
                {localErro}
              </p>
            )}
            <button onClick={fazerBootstrap} disabled={logando}>
              {logando ? 'Criando…' : 'Criar admin e entrar'}
            </button>
            {setBootstrap && (
              <button
                type="button"
                className="link-btn"
                onClick={() => setBootstrap(false)}
                style={{ marginTop: 8, display: 'block' }}
              >
                Voltar ao login
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
