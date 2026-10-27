import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UpdateToast } from './components/PwaBits';
import { startLiquid } from './lib/liquid';
import { listenForLaunchFiles, registerServiceWorker } from './lib/pwa';
import './styles.css';

registerServiceWorker();
listenForLaunchFiles();
startLiquid();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateToast />
  </StrictMode>,
);
