import { createRoot } from 'react-dom/client';
import { App } from './App';
import { init } from './store';
import './styles.css';

init().then(() => {
  createRoot(document.getElementById('root')!).render(<App />);
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
