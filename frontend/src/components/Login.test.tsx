import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import Login from './Login'

vi.mock('../api', () => ({
  api: {
    login: vi.fn(),
    bootstrapAdmin: vi.fn(),
  },
}))

import { api } from '../api'

const mockLogin = vi.mocked(api.login)
const mockBootstrap = vi.mocked(api.bootstrapAdmin)

const defaultProps = {
  token: '',
  login: 'admin',
  setLogin: vi.fn(),
  senha: 'admin123',
  setSenha: vi.fn(),
  logando: false,
  setLogando: vi.fn(),
  loginErro: '',
  setLoginErro: vi.fn(),
  logo: null,
  onLogin: vi.fn(),
  bootstrap: false,
  setBootstrap: vi.fn(),
  onBootstrap: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  defaultProps.setLogin.mockClear()
  defaultProps.setSenha.mockClear()
  defaultProps.setLogando.mockClear()
  defaultProps.setLoginErro.mockClear()
  defaultProps.onLogin.mockClear()
  defaultProps.onBootstrap.mockClear()
  defaultProps.setBootstrap.mockClear()
  mockLogin.mockClear()
  mockBootstrap.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  cleanup()
})

describe('Login component', () => {
  it('renderiza os elementos principais', () => {
    render(<Login {...defaultProps} />)

    expect(screen.getByRole('heading', { name: /controle de led/i })).toBeInTheDocument()
    expect(screen.getByLabelText(/login/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/senha/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /entrar/i })).toBeInTheDocument()
  })

  it('renderiza a logo quando fornecida', () => {
    render(<Login {...defaultProps} logo="data:image/png;base64,abc" />)

    expect(screen.getByAltText(/marca controle de led/i)).toHaveAttribute('src', 'data:image/png;base64,abc')
  })

  it('renderiza o ícone padrão quando não há logo', () => {
    render(<Login {...defaultProps} logo={null} />)

    expect(screen.getByText('📺', { selector: '[aria-hidden="true"]' })).toBeInTheDocument()
  })

  it('atualiza o valor do login ao digitar', () => {
    const { setLogin } = defaultProps
    render(<Login {...defaultProps} />)

    const input = screen.getByLabelText(/login/i)
    fireEvent.change(input, { target: { value: 'operador' } })

    expect(setLogin).toHaveBeenCalledWith('operador')
  })

  it('atualiza o valor da senha ao digitar', () => {
    render(<Login {...defaultProps} />)

    const input = screen.getByLabelText(/senha/i)
    fireEvent.change(input, { target: { value: 'minhasenha' } })

    expect(defaultProps.setSenha).toHaveBeenCalledWith('minhasenha')
  })

  it('chama onLogin com credenciais válidas', async () => {
    mockLogin.mockResolvedValue({ token: 'abc123', perfil: 'admin', nome: 'Administrador' })

    render(<Login {...defaultProps} />)

    fireEvent.change(screen.getByLabelText(/login/i), { target: { value: 'admin' } })
    fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'admin123' } })
    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('admin', 'admin123')
    })

    expect(defaultProps.onLogin).toHaveBeenCalledWith({
      token: 'abc123',
      perfil: 'admin',
      nome: 'Administrador',
    })
  })

  it('desabilita o botão durante o login', () => {
    mockLogin.mockImplementation(() => new Promise(() => {}))

    render(<Login {...defaultProps} logando={true} />)

    expect(screen.getByRole('button', { name: /entrando/i })).toBeDisabled()
  })

  it('mostra erro quando o login falha', async () => {
    mockLogin.mockRejectedValue(new Error('credenciais inválidas'))

    render(<Login {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(screen.getByText(/login inválido/i)).toBeInTheDocument()
    })
  })

  it('não chama onLogin quando o login falha', async () => {
    mockLogin.mockRejectedValue(new Error('credenciais inválidas'))

    render(<Login {...defaultProps} />)

    fireEvent.click(screen.getByRole('button', { name: /entrar/i }))

    await waitFor(() => {
      expect(defaultProps.onLogin).not.toHaveBeenCalled()
    })
  })
})
