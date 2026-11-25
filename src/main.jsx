import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './AppRuntime.jsx';
import { AppMessagesProvider } from './AppMessages.jsx';
import './index.css';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppMessagesProvider><App /></AppMessagesProvider>
  </StrictMode>,
);
