import { useState, useEffect } from 'react'
import { api } from '../api'

interface UsuariosSecaoProps {
  usersLista: any[]
  cidades: { id: string; nome: string }[]
  recursosLista: { id: string; rotulo: string }[]
  canUsuarios: boolean
  carregarAcesso: () => void
  carregar: () => void
}

interface UserForm {
  login: string
  senha: string
  perfil: string
  nome: string
  cidades: string[]
  permissoes: string[]
}

export default function UsuariosSecao({
  usersLista,
  cidades,
  recursosLista,
  canUsuarios,
  carregarAcesso,
  carregar,
}: UsuariosSecaoProps) {
  const [usersMsg, setUsersMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [userForm, setUserForm] = useState<UserForm>({
    login: '',
    senha: '',
    perfil: 'visualizador',
    nome: '',
    cidades: [],
    permissoes: [],
  })
  const [userEditando, setUserEditando] = useState<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const isTablet = viewportWidth >= 600 && viewportWidth < 980

  const alternar = (lista: string[], v: string) =>
    lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]

  const salvarUsuario = async () => {
    setUsersMsg(null)
    if (!userForm.login.trim() || (!userEditando && !userForm.senha)) {
      setUsersMsg({ tipo: 'erro', texto: 'Preencha login e senha.' })
      return
    }
    try {
      if (userEditando) {
        const body: any = {
          perfil: userForm.perfil,
          nome: userForm.nome,
          cidades: userForm.cidades,
          permissoes: userForm.permissoes,
        }
        if (userForm.senha) body.senha = userForm.senha
        await api.editarUsuario(userEditando, body)
        setUsersMsg({ tipo: 'ok', texto: 'Usuário atualizado.' })
      } else {
        await api.criarUsuario(userForm)
        setUsersMsg({ tipo: 'ok', texto: `Usuário ${userForm.login} criado.` })
      }
      setUserForm({
        login: '',
        senha: '',
        perfil: 'visualizador',
        nome: '',
        cidades: [],
        permissoes: [],
      })
      setUserEditando(null)
      carregarAcesso && carregarAcesso()
      carregar()
    } catch (e: any) {
      setUsersMsg({ tipo: 'erro', texto: e.message })
    }
  }

  const excluirUsuario = async (login: string) => {
    if (!confirm(`Excluir o usuário "${login}"?`)) return
    try {
      await api.excluirUsuario(login)
      carregarAcesso && carregarAcesso()
    } catch (e: any) {
      setUsersMsg({ tipo: 'erro', texto: e.message })
    }
  }

  if (!canUsuarios) return null

  return (
    <>
      <p className="sub">
        Defina por usuário: perfil, <b>cidades que pode ver</b> e{' '}
        <b>recursos extras</b> além do perfil. Sem cidade vinculada = todas.
      </p>
      <div className="table-scroll">
        <table className={isTablet ? 'table-card' : ''}>
          <thead>
            <tr>
              <th>Login</th>
              <th>Nome</th>
              <th>Perfil</th>
              <th>Cidades</th>
              <th>Recursos</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {usersLista.map((u: any) => (
              <tr key={u.login}>
                <td data-label="Login"><b>{u.login}</b></td>
                <td data-label="Nome">{u.nome}</td>
                <td data-label="Perfil">{u.perfil}</td>
                <td data-label="Cidades" style={{ fontSize: '.7rem' }}>
                  {u.cidades.length ? u.cidades.join(', ') : 'todas'}
                </td>
                <td data-label="Recursos" style={{ fontSize: '.7rem' }}>{u.efetivas.join(', ')}</td>
                <td className="row-actions" data-label="Ações">
                  <button
                    onClick={() => {
                      setUserEditando(u.login)
                      setUserForm({
                        login: u.login,
                        senha: '',
                        perfil: u.perfil,
                        nome: u.nome,
                        cidades: u.cidades,
                        permissoes: u.permissoes,
                      })
                    }}
                  >
                    Editar
                  </button>
                  <button className="danger" onClick={() => excluirUsuario(u.login)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="spot-form">
        <h2 style={{ fontSize: '.85rem' }}>
          {userEditando ? `EDITAR ${userEditando}` : '＋ NOVO USUÁRIO'}
        </h2>
        <div className="spot-row">
          <label>
            Login
            <input
              value={userForm.login}
              disabled={!!userEditando}
              onChange={(e) => setUserForm({ ...userForm, login: e.target.value })}
            />
          </label>
          <label>
            {userEditando ? 'Nova senha (vazio mantém)' : 'Senha'}
            <input
              type="password"
              value={userForm.senha}
              onChange={(e) => setUserForm({ ...userForm, senha: e.target.value })}
            />
          </label>
          <label>
            Perfil
            <select
              value={userForm.perfil}
              onChange={(e) => setUserForm({ ...userForm, perfil: e.target.value })}
            >
              <option value="admin">admin</option>
              <option value="regional">regional</option>
              <option value="operador">operador</option>
              <option value="visualizador">visualizador</option>
            </select>
          </label>
        </div>
        <label>
          Nome
          <input
            value={userForm.nome}
            onChange={(e) => setUserForm({ ...userForm, nome: e.target.value })}
          />
        </label>
        <label>
          Cidades que pode ver (vazio = todas)
          <div className="perm-grid">
            {(cidades.length ? cidades : [{ id: 'aracaju', nome: 'Aracaju' }]).map(
              (c: any) => (
                <label key={c.id} className="check">
                  <input
                    type="checkbox"
                    checked={userForm.cidades.includes(c.id)}
                    onChange={() => {
                      setUserForm({
                        ...userForm,
                        cidades: alternar(userForm.cidades, c.id),
                      })
                    }}
                  />
                  {c.nome}
                </label>
              ),
            )}
          </div>
        </label>
        <label>
          Recursos extras além do perfil
          <div className="perm-grid">
            {recursosLista.map((r) => (
              <label key={r.id} className="check">
                <input
                  type="checkbox"
                  checked={userForm.permissoes.includes(r.id)}
                  onChange={() => {
                    setUserForm({
                      ...userForm,
                      permissoes: alternar(userForm.permissoes, r.id),
                    })
                  }}
                />
                {r.rotulo}
              </label>
            ))}
          </div>
        </label>
        {usersMsg && (
          <p className={`spot-msg ${usersMsg.tipo === 'ok' ? 'ok' : 'erro'}`}>
            {usersMsg.texto}
          </p>
        )}
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <button onClick={salvarUsuario}>
            {userEditando ? 'Salvar alterações' : 'Criar usuário'}
          </button>
          {userEditando && (
            <button
              className="ghost"
              onClick={() => {
                setUserEditando(null)
                setUserForm({
                  login: '',
                  senha: '',
                  perfil: 'visualizador',
                  nome: '',
                  cidades: [],
                  permissoes: [],
                })
              }}
            >
              Cancelar edição
            </button>
          )}
        </div>
      </div>
    </>
  )
}
