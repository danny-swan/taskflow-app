import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, ExternalLink, QrCode, ChevronDown } from 'lucide-react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';

type Method = {
  key: 'cloudtips' | 'usdt_trc' | 'ton' | 'usdt_erc';
  labelKey:
    | 'support_method_cloudtips'
    | 'support_method_usdt_trc'
    | 'support_method_ton'
    | 'support_method_usdt_erc';
  icon: string;
  kind: 'link' | 'address';
  value: string;   // URL для link, адрес для address
  network?: string; // короткая подпись сети (для крипты)
};

// v0.9.31: публичные адреса для приёма поддержки.
// Публиковать безопасно — с адреса нельзя снять средства без приватного ключа.
// v0.9.35-dev.6.1: значения вынесены в env (VITE_PAY_*). Пустые варианты
// скрываются; если пусты все 4 — весь блок скрыт (см. SupportBlock ниже).
const RAW_METHODS: Array<Method | null> = [
  import.meta.env.VITE_PAY_CLOUDTIPS_URL
    ? {
        key: 'cloudtips',
        labelKey: 'support_method_cloudtips',
        icon: '\u{1F4B3}',
        kind: 'link',
        value: import.meta.env.VITE_PAY_CLOUDTIPS_URL as string,
      }
    : null,
  import.meta.env.VITE_PAY_USDT_TRC20
    ? {
        key: 'usdt_trc',
        labelKey: 'support_method_usdt_trc',
        icon: '\u{1FA99}',
        kind: 'address',
        value: import.meta.env.VITE_PAY_USDT_TRC20 as string,
        network: 'Tron / TRC-20',
      }
    : null,
  import.meta.env.VITE_PAY_TON
    ? {
        key: 'ton',
        labelKey: 'support_method_ton',
        icon: '\u{1FA99}',
        kind: 'address',
        value: import.meta.env.VITE_PAY_TON as string,
        network: 'The Open Network',
      }
    : null,
  import.meta.env.VITE_PAY_USDT_ERC20
    ? {
        key: 'usdt_erc',
        labelKey: 'support_method_usdt_erc',
        icon: '\u{1FA99}',
        kind: 'address',
        value: import.meta.env.VITE_PAY_USDT_ERC20 as string,
        network: 'Ethereum / ERC-20',
      }
    : null,
];

const METHODS: Method[] = RAW_METHODS.filter((m): m is Method => m !== null);

export function SupportBlock() {
  const lang = useStore(s => s.language);
  const theme = useStore(s => s.theme);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // v0.9.35-dev.6.1: если ни один способ поддержки не настроен —
  // блок не показываем.
  if (METHODS.length === 0) return null;

  // Определяем тёмная тема или светлая — нужно для контраста QR
  const isDark = theme === 'dark' || theme === 'akatsuki';

  async function copyToClipboard(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1400);
    } catch {
      // fallback — временный textarea
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 1400);
    }
  }

  return (
    <aside className="bg-surface border border-border-soft rounded-lg p-4 text-[13px]">
      <h3 className="font-display text-[15px] font-semibold mb-3">{tr(lang, 'support_title')}</h3>

      <div className="space-y-2.5 text-muted leading-relaxed">
        <p>{tr(lang, 'support_intro_1')}</p>
        <p>{tr(lang, 'support_intro_2')}</p>
        <p>{tr(lang, 'support_intro_3')}</p>
      </div>

      <div className="mt-4 space-y-2">
        {METHODS.map((m) => {
          const isOpen = openKey === m.key;
          const label = tr(lang, m.labelKey);

          return (
            <div
              key={m.key}
              className="bg-surface-alt/60 border border-border-soft/60 rounded-md overflow-hidden"
            >
              {m.kind === 'link' ? (
                <a
                  href={m.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-alt/80 transition-colors"
                >
                  <span className="text-[16px] shrink-0" aria-hidden>{m.icon}</span>
                  <span className="flex-1 text-[13px] font-medium">{label}</span>
                  <ExternalLink size={14} className="text-muted shrink-0" />
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setOpenKey(isOpen ? null : m.key)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-surface-alt/80 transition-colors"
                  >
                    <span className="text-[16px] shrink-0" aria-hidden>{m.icon}</span>
                    <span className="flex-1">
                      <span className="text-[13px] font-medium block">{label}</span>
                      {m.network && (
                        <span className="text-[11px] text-muted">{m.network}</span>
                      )}
                    </span>
                    <ChevronDown
                      size={14}
                      className={'text-muted shrink-0 transition-transform ' + (isOpen ? 'rotate-180' : '')}
                    />
                  </button>

                  {isOpen && (
                    <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border-soft/40">
                      <div className="flex items-start gap-2">
                        <code
                          className="flex-1 text-[11.5px] font-mono break-all bg-surface px-2 py-1.5 rounded border border-border-soft/60 select-all"
                          title={m.value}
                        >
                          {m.value}
                        </code>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(m.value, m.key)}
                          className="shrink-0 p-1.5 rounded hover:bg-surface-alt border border-border-soft/60"
                          title={tr(lang, 'support_copy_address')}
                          aria-label={tr(lang, 'support_copy_address')}
                        >
                          {copiedKey === m.key ? (
                            <Check size={13} className="text-accent" />
                          ) : (
                            <Copy size={13} className="text-muted" />
                          )}
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-muted">
                          {copiedKey === m.key ? tr(lang, 'support_copied') : '\u00a0'}
                        </span>
                      </div>

                      <div className="flex flex-col items-center gap-1.5 pt-1">
                        <div
                          className="p-2 rounded bg-white"
                          style={{
                            // Белый фон даже в dark для читаемости QR камерой.
                            background: '#FFFFFF',
                          }}
                        >
                          <QRCodeSVG
                            value={m.value}
                            size={128}
                            level="M"
                            bgColor="#FFFFFF"
                            fgColor="#000000"
                          />
                        </div>
                        <div className="flex items-center gap-1 text-[10.5px] text-muted">
                          <QrCode size={11} />
                          <span>{tr(lang, 'support_show_qr')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      <p
        className="mt-3.5 text-[11px] text-muted leading-relaxed"
        style={{ colorScheme: isDark ? 'dark' : 'light' }}
      >
        {tr(lang, 'support_disclaimer')}
      </p>
    </aside>
  );
}
