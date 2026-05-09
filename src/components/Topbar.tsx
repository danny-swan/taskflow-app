import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useStore } from '../store/useStore';
import { MetricChips } from './MetricChips';

/**
 * Topbar: rotating session quote on the left, optional datetime on the right.
 * No more breadcrumbs.
 */
export function Topbar({ showDateTime }: { showDateTime?: boolean }) {
  const quote = useStore(s => s.quote);
  const lang = useStore(s => s.language);
  const [now, setNow] = useState<Date>(new Date());

  useEffect(() => {
    if (!showDateTime) return;
    const tick = () => setNow(new Date());
    // Align to next minute boundary, then tick every minute.
    const ms = 60_000 - (Date.now() % 60_000);
    const timeout = setTimeout(() => {
      tick();
      const id = setInterval(tick, 60_000);
      (timeout as any)._id = id;
    }, ms);
    return () => {
      clearTimeout(timeout);
      const id = (timeout as any)._id;
      if (id) clearInterval(id);
    };
  }, [showDateTime]);

  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const dateStr = new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(now);
  const timeStr = new Intl.DateTimeFormat(locale, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(now);

  return (
    <div
      className="flex items-center gap-4 px-5 border-b border-border-soft text-muted shrink-0"
      style={{ minHeight: 36, background: 'var(--surface)' }}
    >
      <div
        className="italic truncate flex-1"
        style={{ fontSize: 13, lineHeight: 1.4 }}
        title={quote}
      >
        {quote}
      </div>
      {showDateTime && <MetricChips />}
      {showDateTime && (
        <div className="datetime-chip shrink-0">
          <Clock size={13} aria-hidden />
          <span>{dateStr}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span className="dt-time">{timeStr}</span>
        </div>
      )}
    </div>
  );
}
