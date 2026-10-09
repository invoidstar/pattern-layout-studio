import { useEffect, useState } from 'react';
import {
  ANNOUNCEMENTS,
  ANNOUNCEMENT_STORAGE_PREFIX,
  LATEST_ANNOUNCEMENT,
} from '../content/announcements';
import Icon from './ui/Icon';

interface AnnouncementCenterProps {
  openRequest: number;
}

const latestKey = `${ANNOUNCEMENT_STORAGE_PREFIX}${LATEST_ANNOUNCEMENT.id}`;

export default function AnnouncementCenter({ openRequest }: AnnouncementCenterProps) {
  const [bannerVisible, setBannerVisible] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(LATEST_ANNOUNCEMENT.id);

  useEffect(() => {
    try {
      setBannerVisible(window.localStorage.getItem(latestKey) !== '1');
    } catch {
      setBannerVisible(true);
    }
  }, []);

  useEffect(() => {
    if (openRequest > 0) {
      setSelectedId(LATEST_ANNOUNCEMENT.id);
      setDialogOpen(true);
    }
  }, [openRequest]);

  useEffect(() => {
    if (!dialogOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDialogOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialogOpen]);

  const markRead = () => {
    setBannerVisible(false);
    try {
      window.localStorage.setItem(latestKey, '1');
    } catch {
      // Storage may be blocked. The current session still dismisses the notice.
    }
  };

  const openLatest = () => {
    setSelectedId(LATEST_ANNOUNCEMENT.id);
    setDialogOpen(true);
    markRead();
  };

  const selected = ANNOUNCEMENTS.find((a) => a.id === selectedId)
    ?? LATEST_ANNOUNCEMENT;

  return (
    <>
      {bannerVisible && (
        <aside className="v2-announcement-banner" aria-label="最新更新公告">
          <span className="v2-announcement-pill">
            <Icon name="sparkles" size={14}/> NEW {LATEST_ANNOUNCEMENT.version}
          </span>
          <span className="v2-announcement-message">
            <strong>{LATEST_ANNOUNCEMENT.title}</strong>
            <span>{LATEST_ANNOUNCEMENT.summary}</span>
          </span>
          <button type="button" className="v2-announcement-read" onClick={openLatest}>
            查看更新 <Icon name="chevron-right" size={15}/>
          </button>
          <button type="button" className="v2-icon-button" onClick={markRead} aria-label="关闭更新提示">
            <Icon name="x" size={17}/>
          </button>
        </aside>
      )}
      {dialogOpen && (
        <div className="v2-modal-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setDialogOpen(false);
        }}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="announcement-title"
            className="v2-modal-card v2-announcement-dialog"
          >
            <div className="v2-modal-header">
              <div>
                <span className="v2-eyebrow">RELEASE NOTES</span>
                <h2 id="announcement-title">更新公告</h2>
              </div>
              <button type="button" className="v2-icon-button" onClick={() => setDialogOpen(false)} aria-label="关闭公告">
                <Icon name="x"/>
              </button>
            </div>
            <div className="v2-announcement-content">
              <div className="v2-release-list" aria-label="历史版本">
                {ANNOUNCEMENTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`v2-release-row ${a.id === selected.id ? 'active' : ''}`}
                    onClick={() => setSelectedId(a.id)}
                    aria-pressed={a.id === selected.id}
                  >
                    <span>{a.version}</span>
                    <small>{a.date}</small>
                  </button>
                ))}
              </div>
              <article className="v2-release-detail">
                <span className="v2-release-version">{selected.version} · {selected.date}</span>
                <h3>{selected.title}</h3>
                <p>{selected.summary}</p>
                <ul>{selected.changes.map((change, i) => <li key={i}>{change}</li>)}</ul>
              </article>
            </div>
            <div className="v2-modal-footer">
              <button type="button" className="v2-button primary" onClick={() => {
                markRead();
                setDialogOpen(false);
              }}>知道了</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
