import { TextareaHTMLAttributes, useEffect, useRef } from 'react';

export function AutoGrowTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // JS fallback for browsers without field-sizing: content
  const resize = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  };

  useEffect(() => { resize(); }, [props.value]);

  return (
    <textarea
      {...props}
      ref={ref}
      onInput={(e) => { resize(); props.onInput?.(e); }}
      className={'auto-grow w-full bg-transparent border-0 outline-none resize-none ' + (props.className || '')}
    />
  );
}
