import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './admin.css'
import AdminApp from './components/AdminApp.tsx'

createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
)
