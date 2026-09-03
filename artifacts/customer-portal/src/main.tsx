import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { setDefaultHeaders } from '@workspace/api-client-react'

// Boot script to initialize auth headers if a token exists
const boot = () => {
  const token = localStorage.getItem('portal_token')

  if (token) {
    setDefaultHeaders({
      'x-portal-token': token
    })
  } else {
    setDefaultHeaders({})
  }
}

boot()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
