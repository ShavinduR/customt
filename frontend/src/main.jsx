import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PwaProvider } from './context/PwaContext';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PwaProvider>
      <App />
    </PwaProvider>
  </StrictMode>
);
