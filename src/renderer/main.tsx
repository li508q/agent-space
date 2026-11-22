import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('The renderer root is missing.');
createRoot(root).render(
  <App api={typeof window.agentSpace === 'undefined' ? null : window.agentSpace} />,
);
