import { forwardRef, TextareaHTMLAttributes, useEffect, useRef } from 'react';

export const AutoGrowTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function AutoGrowTextarea(props, forwardedRef) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);

    // JS fallback for browsers without field-sizing: content
    const resize = () => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    };

    useEffect(() => { resize(); }, [props.value]);

    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
    };

    return (
      <textarea
        {...props}
        ref={setRefs}
        onInput={(e) => { resize(); props.onInput?.(e); }}
        className={'auto-grow w-full bg-transparent border-0 outline-none resize-none ' + (props.className || '')}
      />
    );
  }
);
