/**
 * EmojiPicker — v0.8.8
 * Контекстное меню с эмодзи: панель недавних (до 12) + кнопка «Больше» → полный picker.
 *
 * Используется в полях Название/Комментарий через кнопку 😊 справа от поля
 * или через правый клик внутри textarea.
 *
 * Недавние эмодзи хранятся в settings.recent_emojis (JSON-массив строк).
 */
import { useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../store/useStore';
import { Search, X } from 'lucide-react';

// Полный набор эмодзи по категориям (компактный, без редких)
const EMOJI_CATEGORIES: { name: string; nameRu: string; emojis: string[] }[] = [
  {
    name: 'Smileys',
    nameRu: 'Смайлы',
    emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🥴','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠'],
  },
  {
    name: 'Gestures',
    nameRu: 'Жесты',
    emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦿','🦶','👂','🦻','👃','🧠','🦷','🦴','👀','👁','👅','👄'],
  },
  {
    name: 'Objects',
    nameRu: 'Объекты',
    emojis: ['📱','💻','⌨️','🖥','🖨','🖱','🖲','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽','🎞','📞','☎️','📟','📠','📺','📻','🎙','🎚','🎛','🧭','⏱','⏲','⏰','🕰','⌛','⏳','📡','🔋','🔌','💡','🔦','🕯','🧯','🛢','💸','💵','💴','💶','💷','💰','💳','💎','⚖️','🦯','🧰','🔧','🔨','⚒','🛠','⛏','🔩','⚙️','🧱','⛓','🧲','🔫','💣','🧨','🪓','🔪','🗡','⚔️','🛡','🚬','⚰️','⚱️','🏺','🔮','📿','🧿','💈','⚗️','🔭','🔬','🕳','💊','💉','🩸','🩹','🩺','🌡','🧹','🧺','🧻','🚽','🚰','🚿','🛁','🛀','🧼','🪒','🧽','🧴','🛎','🔑','🗝','🚪','🪑','🛋','🛏','🛌','🧸','🖼','🛍','🛒','🎁','🎈','🎏','🎀','🎊','🎉','🎎','🏮','🎐','🧧','✉️','📩','📨','📧','💌','📥','📤','📦','🏷','📪','📫','📬','📭','📮','📯','📜','📃','📄','📑','📊','📈','📉','🗒','🗓','📆','📅','📇','🗃','🗳','🗄','📋','📁','📂','🗂','🗞','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇','📐','📏','🧮','📌','📍','✂️','🖊','🖋','✒️','🖌','🖍','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'],
  },
  {
    name: 'Symbols',
    nameRu: 'Символы',
    emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🚭','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🈳','🈂️','🛂','🛃','🛄','🛅','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','🔢','#️⃣','*️⃣','⏏️','▶️','⏸','⏯','⏹','⏺','⏭','⏮','⏩','⏪','⏫','⏬','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔀','🔁','🔂','🔄','🔃','🎵','🎶','➕','➖','➗','✖️','💲','💱','™️','©️','®️','〰️','➰','➿','🔚','🔙','🔛','🔝','🔜','✔️','☑️','🔘','⚪','⚫','🔴','🔵','🟤','🟣','🟢','🟡','🟠','🔶','🔷','🔸','🔹','🔺','🔻','💎','🔲','🔳','◼️','◻️','◾','◽','▪️','▫️','🟥','🟧','🟨','🟩','🟦','🟪','🟫','⬛','⬜'],
  },
  {
    name: 'Nature',
    nameRu: 'Природа',
    emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🐥','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷','🕸','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐕‍🦺','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿','🦔','🌲','🌳','🌴','🌵','🌾','🌿','☘️','🍀','🍁','🍂','🍃','🌷','🌹','🥀','🌺','🌸','🌼','🌻','🌞','🌝','🌛','🌜','🌚','🌕','🌖','🌗','🌘','🌑','🌒','🌓','🌔','🌙','🌎','🌍','🌏','💫','⭐','🌟','✨','⚡','☄️','💥','🔥','🌪','🌈','☀️','🌤','⛅','🌥','☁️','🌦','🌧','⛈','🌩','🌨','❄️','☃️','⛄','🌬','💨','💧','💦','☔','☂️','🌊','🌫'],
  },
  {
    name: 'Food',
    nameRu: 'Еда',
    emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🥪','🥙','🧆','🌮','🌯','🥗','🥘','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🥛','🍼','☕','🍵','🧃','🥤','🍶','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🧉','🍾','🧊','🥄','🍴','🍽','🥣','🥡','🥢','🧂'],
  },
  {
    name: 'Activities',
    nameRu: 'Действия',
    emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🥊','🥋','🥅','⛳','⛸','🎣','🤿','🎽','🎿','🛷','🥌','🎯','🎱','🔮','🧿','🎮','🕹','🎰','🎲','🧩','🧸','🃏','🀄','🎴','🎭','🖼','🎨','🧵','🧶','🎼','🎤','🎧','🎷','🎸','🪕','🎻','🎲','🎯','🎳','🎮','🎼','🎵','🎶','🥇','🥈','🥉','🏆','🏅','🎖','🏵','🎗','🎫','🎟','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎙','📻','🎷','🪗','🎸','🎹','🎺','🎻','🪕','🥁','🪘'],
  },
  {
    name: 'Travel',
    nameRu: 'Транспорт',
    emojis: ['🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🦼','🛴','🚲','🛵','🏍','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩','💺','🛰','🚀','🛸','🚁','🛶','⛵','🚤','🛥','🛳','⛴','🚢','⚓','⛽','🚧','🚦','🚥','🚏','🗺','🗿','🗽','🗼','🏰','🏯','🏟','🎡','🎢','🎠','⛲','⛱','🏖','🏝','🏜','🌋','⛰','🏔','🗻','🏕','⛺','🏠','🏡','🏘','🏚','🏗','🏭','🏢','🏬','🏣','🏤','🏥','🏦','🏨','🏪','🏫','🏩','💒','🏛','⛪','🕌','🕍','🛕','🕋','⛩','🛤','🛣','🗾','🎑','🏞','🌅','🌄','🌠','🎇','🎆','🌇','🌆','🏙','🌃','🌌','🌉','🌁'],
  },
];

const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap(c => c.emojis);
const MAX_RECENT = 12;

interface Props {
  open: boolean;
  anchorRect: DOMRect | null;
  onClose: () => void;
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ open, anchorRect, onClose, onSelect }: Props) {
  const lang = useStore(s => s.language);
  const recent = useStore(s => s.recentEmojis);
  const pushRecentEmoji = useStore(s => s.pushRecentEmoji);
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // Slight delay so the opening click itself doesn't immediately close
    const t = setTimeout(() => {
      document.addEventListener('mousedown', handler);
      document.addEventListener('keydown', keyHandler);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', keyHandler);
    };
  }, [open, onClose]);

  // Reset state when reopened
  useEffect(() => {
    if (open) {
      setExpanded(false);
      setSearch('');
      setActiveCategory(0);
    }
  }, [open]);

  // v0.8.11: не закрываем пикер после выбора, чтобы можно было вставить несколько эмодзи подряд.
  // Закрытие — кнопкой «Готово», Esc или кликом вне пикера.
  const handlePick = (emoji: string) => {
    pushRecentEmoji(emoji);
    onSelect(emoji);
  };

  // Position: prefer below anchor, flip above if no space
  const style: React.CSSProperties = useMemo(() => {
    if (!anchorRect) return { display: 'none' };
    const panelW = expanded ? 360 : 280;
    const panelH = expanded ? 360 : 80;
    let left = anchorRect.left;
    let top = anchorRect.bottom + 6;
    // Clamp to viewport
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8;
    if (left < 8) left = 8;
    if (top + panelH > window.innerHeight - 8) {
      top = Math.max(8, anchorRect.top - panelH - 6);
    }
    return { position: 'fixed', left, top, zIndex: 1100, width: panelW };
  }, [anchorRect, expanded]);

  if (!open) return null;

  const filteredEmojis = search
    ? ALL_EMOJIS.filter(e => e.includes(search)) // crude — но Unicode без shortcodes сложно искать
    : EMOJI_CATEGORIES[activeCategory].emojis;

  return createPortal(
    <div
      ref={panelRef}
      style={style}
      className="bg-surface border border-border rounded-lg shadow-xl overflow-hidden"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!expanded ? (
        // Compact: recent + "More"
        <div className="p-2 space-y-1.5">
          <div className="flex items-center justify-between px-1">
            <div className="text-[10px] text-muted uppercase tracking-wider">
              {lang === 'ru' ? 'Недавние' : 'Recent'}
            </div>
            {/* v0.8.11: явная кнопка закрытия пикера */}
            <button
              onClick={onClose}
              className="text-muted hover:text-text p-0.5 rounded hover:bg-surface-alt"
              type="button"
              title={lang === 'ru' ? 'Закрыть' : 'Close'}
              aria-label={lang === 'ru' ? 'Закрыть' : 'Close'}
            >
              <X size={12} />
            </button>
          </div>
          {recent.length === 0 ? (
            <div className="text-[12px] text-muted px-1 py-1">
              {lang === 'ru' ? 'Пока пусто. Откройте «Больше».' : 'Empty yet. Click "More".'}
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-0.5">
              {recent.slice(0, MAX_RECENT).map((emoji, i) => (
                <button
                  key={`${emoji}-${i}`}
                  onClick={() => handlePick(emoji)}
                  className="text-[20px] leading-none p-1.5 rounded hover:bg-surface-alt transition-colors"
                  type="button"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => setExpanded(true)}
              className="flex-1 text-[12px] px-2 py-1.5 rounded border border-border-soft hover:bg-surface-alt text-muted"
              type="button"
            >
              {lang === 'ru' ? 'Больше…' : 'More…'}
            </button>
            {/* v0.8.11: прямая кнопка «Готово» */}
            <button
              onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded border border-border-soft hover:bg-surface-alt text-text font-medium"
              type="button"
            >
              {lang === 'ru' ? 'Готово' : 'Done'}
            </button>
          </div>
        </div>
      ) : (
        // Expanded: full picker
        <div className="flex flex-col" style={{ height: 360 }}>
          {/* Search */}
          <div className="p-2 border-b border-border-soft flex items-center gap-2">
            <Search size={13} className="text-muted shrink-0" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'ru' ? 'Поиск эмодзи…' : 'Search emoji…'}
              className="flex-1 bg-transparent text-[12px] outline-none"
              autoFocus
            />
            {/* v0.8.11: в развёрнутом виде — кнопка «Готово» (закрывает пикер целиком) */}
            <button
              onClick={onClose}
              className="text-[11px] px-2 py-0.5 rounded border border-border-soft hover:bg-surface-alt text-text font-medium"
              type="button"
              title={lang === 'ru' ? 'Закрыть пикер' : 'Close picker'}
            >
              {lang === 'ru' ? 'Готово' : 'Done'}
            </button>
            <button onClick={() => setExpanded(false)} className="text-muted hover:text-text" type="button" title={lang === 'ru' ? 'Свернуть' : 'Collapse'}>
              <X size={14} />
            </button>
          </div>

          {/* Category tabs (hidden when searching) */}
          {!search && (
            <div className="flex border-b border-border-soft overflow-x-auto">
              {EMOJI_CATEGORIES.map((cat, i) => (
                <button
                  key={cat.name}
                  onClick={() => setActiveCategory(i)}
                  className={`px-2 py-1 text-[11px] whitespace-nowrap shrink-0 ${
                    i === activeCategory ? 'border-b-2 border-accent text-text font-medium' : 'text-muted hover:text-text'
                  }`}
                  title={lang === 'ru' ? cat.nameRu : cat.name}
                  type="button"
                >
                  {cat.emojis[0]}
                </button>
              ))}
            </div>
          )}

          {/* Emoji grid */}
          <div className="flex-1 overflow-y-auto p-2">
            {filteredEmojis.length === 0 ? (
              <div className="text-[12px] text-muted text-center py-4">
                {lang === 'ru' ? 'Ничего не найдено' : 'No results'}
              </div>
            ) : (
              <div className="grid grid-cols-8 gap-0.5">
                {filteredEmojis.map((emoji, i) => (
                  <button
                    key={`${emoji}-${i}`}
                    onClick={() => handlePick(emoji)}
                    className="text-[20px] leading-none p-1.5 rounded hover:bg-surface-alt transition-colors"
                    type="button"
                    title={emoji}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}

/**
 * Hook to wire an input/textarea to the EmojiPicker.
 * Returns:
 *   - emojiButtonProps: spread on a button to open the picker
 *   - emojiPickerProps: spread on <EmojiPicker /> for state/anchor
 *   - insertEmoji: programmatic insert at caret
 */
export function useEmojiPicker(
  inputRef: React.RefObject<HTMLInputElement | HTMLTextAreaElement | null>,
  value: string,
  onChange: (next: string) => void
) {
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const openPicker = () => {
    const target = buttonRef.current ?? inputRef.current;
    if (target) setAnchorRect(target.getBoundingClientRect());
    setOpen(true);
  };

  const insertEmoji = (emoji: string) => {
    const el = inputRef.current;
    if (!el) {
      onChange(value + emoji);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + emoji + value.slice(end);
    onChange(next);
    // Restore caret position after React re-renders
    requestAnimationFrame(() => {
      if (inputRef.current) {
        const pos = start + emoji.length;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  return {
    buttonRef,
    emojiButtonProps: {
      ref: buttonRef,
      onClick: openPicker,
      type: 'button' as const,
    },
    emojiPickerProps: {
      open,
      anchorRect,
      onClose: () => setOpen(false),
      onSelect: insertEmoji,
    },
    insertEmoji,
  };
}
