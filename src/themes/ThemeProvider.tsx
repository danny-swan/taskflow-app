import { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { deriveCustomTheme, applyCustomTheme } from '../lib/customTheme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useStore(s => s.theme);
  const fontSize = useStore(s => s.fontSize);
  // v0.9.29: кастом-тема — подписываемся на 3 базовых цвета
  const customAccent = useStore(s => s.customThemeAccent);
  const customBg = useStore(s => s.customThemeBg);
  const customText = useStore(s => s.customThemeText);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    // v0.9.29: если тема 'custom' — инжектим переменные, иначе снимаем инжекции.
    if (theme === 'custom') {
      applyCustomTheme(deriveCustomTheme({ accent: customAccent, bg: customBg, text: customText }));
    } else {
      applyCustomTheme(null);
    }
  }, [theme, customAccent, customBg, customText]);

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
