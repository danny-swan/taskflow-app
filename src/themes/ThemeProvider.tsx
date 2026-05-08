import { useEffect } from 'react';
import { useStore } from '../store/useStore';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useStore(s => s.theme);
  const fontSize = useStore(s => s.fontSize);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  useEffect(() => {
    document.documentElement.style.fontSize = `${fontSize}px`;
  }, [fontSize]);
  return <>{children}</>;
}

/**
 * No theme watermarks/decorations. Themes apply only color tokens
 * (background, surface, accent, etc.). Removed in v0.6 by user request.
 */
export function ThemeWatermarks() {
  return null;
}
