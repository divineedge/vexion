import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { setDefaultHeaders } from '@workspace/api-client-react'

// Boot script to initialize auth headers if a token exists
const boot = () => {
  const token = localStorage.getItem('portal_token')
  const params = new URLSearchParams(window.location.search);
  const tenantParam = params.get("tenant");
  const tenantId = tenantParam ? tenantParam : "1";
  
  if (token) {
    setDefaultHeaders({
      'x-portal-token': token,
      'x-tenant-id': tenantId
    })
  } else {
    setDefaultHeaders({
      'x-tenant-id': tenantId
    })
  }
}

boot()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
