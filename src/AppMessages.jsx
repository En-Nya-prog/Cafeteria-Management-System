import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';

const AppMessages = createContext(null);
const noticeIcons = { success: CheckCircle, error: AlertCircle, info: Info };

export function useAppMessages() {
  return useContext(AppMessages);
}

export function AppMessagesProvider({ children }) {
  const [notice, setNotice] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const sequence = useRef(0);
  const dialog = useRef(null);
  const resolveConfirmation = useRef(null);

  const notify = useCallback((message, tone = 'info', duration = 0) => {
    setNotice({ id: ++sequence.current, message, tone, duration });
  }, []);
  const dismissNotice = useCallback(() => setNotice(null), []);

  useEffect(() => {
    if (!notice?.duration) return;
    const timer = window.setTimeout(() => {
      setNotice(current => current?.id === notice.id ? null : current);
    }, notice.duration);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const confirmAction = useCallback((details) => {
    if (resolveConfirmation.current) return Promise.resolve(false);
    return new Promise(resolve => {
      resolveConfirmation.current = resolve;
      setConfirmation(details);
    });
  }, []);

  useEffect(() => {
    if (confirmation && !dialog.current.open) dialog.current.showModal();
  }, [confirmation]);

  const finishConfirmation = (confirmed) => {
    const resolve = resolveConfirmation.current;
    resolveConfirmation.current = null;
    if (dialog.current.open) dialog.current.close();
    setConfirmation(null);
    resolve?.(confirmed);
  };

  const NoticeIcon = noticeIcons[notice?.tone];
  return (
    <AppMessages.Provider value={{ notify, dismissNotice, confirmAction }}>
      {children}
      <div className="app-notice-region">
        <div role="status" aria-atomic="true">
          {notice && notice.tone !== 'error' && (
            <div key={notice.id} className={`app-notice app-notice-${notice.tone}`}
              style={{ '--notice-duration': `${notice.duration}ms` }}>
              <NoticeIcon size={18} aria-hidden="true" />
              <span>{notice.message}</span>
              {!notice.duration && <button type="button" onClick={dismissNotice} aria-label="Dismiss message"><X size={16} /></button>}
              {notice.duration > 0 && <span className="app-notice-countdown" aria-hidden="true" />}
            </div>
          )}
        </div>
        <div role="alert" aria-atomic="true">
          {notice?.tone === 'error' && <div key={notice.id} className="app-notice app-notice-error">
            <AlertCircle size={18} aria-hidden="true" />
            <span>{notice.message}</span>
            <button type="button" onClick={dismissNotice} aria-label="Dismiss error"><X size={16} /></button>
          </div>}
        </div>
      </div>
      <dialog ref={dialog} className="logout-dialog" aria-labelledby="app-confirm-title"
        aria-describedby="app-confirm-message" onCancel={(event) => { event.preventDefault(); finishConfirmation(false); }}>
        <div className="login-form">
          <h2 id="app-confirm-title">{confirmation?.title}</h2>
          <p id="app-confirm-message">{confirmation?.message}</p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-outline btn-md" autoFocus onClick={() => finishConfirmation(false)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => finishConfirmation(true)}>{confirmation?.label}</button>
          </div>
        </div>
      </dialog>
    </AppMessages.Provider>
  );
}
