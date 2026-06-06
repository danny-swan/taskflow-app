import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles/globals.css';
import App from './App';
import { installGlobalErrorHandlers, logger } from './lib/logger';

// v0.8.12: подключаем глобальные обработчики ошибок и пишем «app start»
// в лог-файл (рядом с БД). В web-режиме всё это тихо no-op.
installGlobalErrorHandlers();
logger.info('app start', { ua: navigator.userAgent });

createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <App />
  </HashRouter>
);
