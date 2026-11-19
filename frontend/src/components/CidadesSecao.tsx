import { useState, useEffect } from 'react'
import { api } from '../api'

interface CidadesSecaoProps {
  cidades: { id: string; nome: string; uf: string; fuso?: string }[]
  canCidades: boolean
  carregar: () => void
}

interface CidadeForm {
  id: string
  nome: string
  uf: string
  fuso: string
}

export default function CidadesSecao({
  cidades,
  canCidades,
  carregar,
}: CidadesSecaoProps) {
  const [cidMsg, setCidMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [cidForm, setCidForm] = useState<CidadeForm>({
    id: '',
    nome: '',
    uf: '',
    fuso: 'America/Maceio',
  })
  const [cidEditando, setCidEditando] = useState<string | null>(null)
  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024)
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const isTablet = viewportWidth >= 600 && viewportWidth < 980

  const salvarCidade = async () => {
    setCidMsg(null)
    if (!cidForm.id.trim() || !cidForm.nome.trim()) {
      setCidMsg({ tipo: 'erro', texto: 'Preencha id e nome.' })
      return
    }
    try {
      if (cidEditando) {
        await api.editarCidade(cidEditando, {
          nome: cidForm.nome,
          uf: cidForm.uf,
          fuso: cidForm.fuso,
        })
        setCidMsg({ tipo: 'ok', texto: 'Cidade atualizada.' })
      } else {
        const { status, body } = await api.criarCidade(cidForm)
        if (status !== 201) {
          setCidMsg({ tipo: 'erro', texto: body?.erro || `Falha.` })
          return
        }
        setCidMsg({ tipo: 'ok', texto: `Cidade ${cidForm.nome} cadastrada.` })
      }
      setCidForm({ id: '', nome: '', uf: '', fuso: 'America/Maceio' })
      setCidEditando(null)
      carregar()
    } catch (e: any) {
      setCidMsg({ tipo: 'erro', texto: e.message })
    }
  }

  const excluirCidade = async (id: string) => {
    if (!confirm(`Excluir a cidade "${id}"? (só vazia)`)) return
    try {
      await api.excluirCidade(id)
      carregar()
    } catch (e: any) {
      setCidMsg({ tipo: 'erro', texto: e.message })
    }
  }

  if (!canCidades) return null

  return (
    <>
      <p className="sub">
        Conforme a tabela cidades: id, nome, UF e fuso. Exclusão só de cidade vazia (sem LEDs).
      </p>
      <div className="table-scroll">
        <table className={isTablet ? 'table-card' : ''}>
          <thead>
            <tr>
              <th>ID</th>
              <th>Nome</th>
              <th>UF</th>
              <th>Fuso</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {cidades.map((c: any) => (
              <tr key={c.id}>
                <td data-label="ID"><b>{c.id}</b></td>
                <td data-label="Nome">{c.nome}</td>
                <td data-label="UF">{c.uf}</td>
                <td data-label="Fuso" style={{ fontSize: '.7rem' }}>{c.fuso || ''}</td>
                <td className="row-actions" data-label="Ações">
                  <button
                    onClick={() => {
                      setCidEditando(c.id)
                      setCidForm({
                        id: c.id,
                        nome: c.nome,
                        uf: c.uf || '',
                        fuso: c.fuso || 'America/Maceio',
                      })
                    }}
                  >
                    Editar
                  </button>
                  <button className="danger" onClick={() => excluirCidade(c.id)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {cidades.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--muted)' }}>
                  Nenhuma cidade cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="spot-form">
        <h2 style={{ fontSize: '.85rem' }}>
          {cidEditando ? `EDITAR ${cidEditando}` : '＋ NOVA CIDADE'}
        </h2>
        <div className="spot-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
          <label>
            ID
            <input
              placeholder="recife"
              value={cidForm.id}
              disabled={!!cidEditando}
              onChange={(e) =>
                setCidForm({ ...cidForm, id: e.target.value.toLowerCase().trim() })
              }
            />
          </label>
          <label>
            Nome
            <input
              placeholder="Recife"
              value={cidForm.nome}
              onChange={(e) => setCidForm({ ...cidForm, nome: e.target.value })}
            />
          </label>
          <label>
            UF
            <input
              placeholder="PE"
              value={cidForm.uf}
              onChange={(e) => setCidForm({ ...cidForm, uf: e.target.value.toUpperCase() })}
            />
          </label>
          <label>
            Fuso
            <input
              placeholder="America/Recife"
              value={cidForm.fuso}
              onChange={(e) => setCidForm({ ...cidForm, fuso: e.target.value })}
            />
          </label>
        </div>
        {cidMsg && (
          <p className={`spot-msg ${cidMsg.tipo === 'ok' ? 'ok' : 'erro'}`}>
            {cidMsg.texto}
          </p>
        )}
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <button onClick={salvarCidade}>
            {cidEditando ? 'Salvar alterações' : 'Cadastrar cidade'}
          </button>
          {cidEditando && (
            <button
              className="ghost"
              onClick={() => {
                setCidEditando(null)
                setCidForm({ id: '', nome: '', uf: '', fuso: 'America/Maceio' })
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
