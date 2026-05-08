// Theme-bound quote pool. Picked once per session.
import type { ThemeName } from '../store/useStore';

export const quotes = {
  light_dark: {
    ru: [
      'Сделанное лучше идеального.',
      'Глубокая работа важнее срочной.',
      'Не управляй временем — управляй вниманием.',
      'Внимание — единственная валюта, которой стоит дорожить.',
      'Большое складывается из малого, повторённого ежедневно.',
      'Сложные задачи распадаются на простые шаги — нужно лишь начать.',
      'Состояние потока возникает там, где заканчивается прокрастинация.',
      'Один важный звонок весит больше десяти второстепенных.',
      'Лучшая система — та, которая работает без напоминаний.',
      'Свобода — это дисциплина, превращённая в привычку.',
      'Не ищи мотивацию, ищи дисциплину.',
      'Сначала тяжёлое, потом лёгкое — никогда наоборот.',
      'Расставленные приоритеты — половина результата.',
      'Часовая концентрация стоит дня хаоса.',
      'Простота — высшая форма проектирования.',
    ],
    en: [
      'Done is better than perfect.',
      'Don\u2019t manage time — manage attention.',
      'Deep work beats urgent work.',
      'Focus is the new IQ.',
      'Discipline equals freedom.',
      'A goal without a system is a wish.',
      'Slow is smooth, smooth is fast.',
      'You don\u2019t rise to the level of your goals; you fall to the level of your systems.',
      'The most important things are rarely urgent.',
      'Hard work that is not aimed at a goal is still hard work.',
      'Compound interest applies to attention too.',
      'Eat the frog before noon.',
      'Cut the noise; ship the signal.',
      'Inputs you control beat outcomes you don\u2019t.',
      'Clarity is the first deliverable.',
    ],
  },
  akatsuki: {
    ru: [
      'Те, кто нарушает правила — мусор. Но те, кто бросает товарищей — хуже мусора.',
      'Боль — лучший учитель. Спокойствие учит лишь медлить.',
      'Одиночество — цена силы.',
      'Истинная боль рождает истинный мир.',
      'Реальность — это то, во что ты заставляешь верить других.',
      'Слабость — это иллюзия, которую сила не прощает.',
      'Кто видит сны, рискует проснуться героем.',
      'Тьма не побеждает свет — она его испытывает.',
      'Цена покоя — десять тысяч битв.',
      'Дождь омывает не город, а память.',
      'Ненависть — это форма привязанности, доведённая до предела.',
      'Любовь сильнее смерти, и потому опаснее всех клинков.',
    ],
    en: [
      'Those who break the rules are scum. But those who abandon their comrades are worse than scum.',
      'You are weak because you do not understand pain.',
      'Solitude is the price of power.',
      'In this world, wherever there is light, there are also shadows.',
      'Reality is whatever the strong make others believe.',
      'Knowing what it feels like to be in pain is exactly why we try to be kind to others.',
      'Hatred is just affection that has run out of patience.',
      'A storm prepares the soul for the calm.',
      'Peace earned without sacrifice is only borrowed.',
      'When you fight to protect, you become unbreakable.',
      'The night is longest just before sunrise.',
      'A clan without bonds is just a list of names.',
    ],
  },
  konoha: {
    ru: [
      'Воля огня — жить ради тех, кто рядом.',
      'Терпение распускается лепестками сакуры.',
      'Юность — это путь, а не возраст.',
      'Я никогда не отступаю от своего слова — это мой путь ниндзя.',
      'Тот, кто не верит в себя, не сможет поверить ни во что.',
      'Учитель — это тот, кто верит в ученика дольше, чем ученик в себя.',
      'Лучшие техники рождаются из любви, а не из страха.',
      'Конаха стоит, пока бьётся хотя бы одно сердце за неё.',
      'Сильнее тот, кто защищает, а не тот, кто разрушает.',
      'Свиток мудрости открывается тому, кто умеет ждать.',
      'Лист, кружась на ветру, всегда возвращается к корням.',
      'Книга — это дверь, ключ от которой ты делаешь сам.',
    ],
    en: [
      'A village is more than walls — it is the will of those who live in it.',
      'I never go back on my word — that is my ninja way.',
      'Youth is a path, not an age.',
      'A teacher believes in a student longer than the student believes in themselves.',
      'The leaf that drifts on the wind always returns to its roots.',
      'A scroll of wisdom opens only to one who can wait.',
      'You are not weak — you simply have not bloomed yet.',
      'Patience blossoms like sakura; rush, and you miss the spring.',
      'Strength is what you build to protect, not to destroy.',
      'Bonds forged in training outlast the sharpest blade.',
      'A small village can shelter a vast dream.',
      'Walk slowly through the morning — the village is watching.',
    ],
  },
};

export type QuoteSet = keyof typeof quotes;

export function quoteSetFor(theme: ThemeName): QuoteSet {
  if (theme === 'akatsuki') return 'akatsuki';
  if (theme === 'konoha') return 'konoha';
  return 'light_dark';
}

// Pick a random quote, preferring `lang` but falling back if pool empty.
export function pickQuote(set: QuoteSet, lang: 'ru' | 'en'): string {
  const pool = (quotes[set] as any)[lang] || quotes.light_dark.ru;
  return pool[Math.floor(Math.random() * pool.length)];
}
