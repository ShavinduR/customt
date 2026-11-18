import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PwaProvider } from './context/PwaContext';
import { initNativeApp } from './native/platform';
import './index.css';

initNativeApp();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PwaProvider>
      <App />
    </PwaProvider>
  </StrictMode>
);
