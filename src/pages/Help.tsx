import { useState } from 'react';
import { useStore } from '../store/useStore';
import { tr } from '../lib/i18n';
import { ChevronDown } from 'lucide-react';
import { CHANGELOG } from '../data/changelog';
import { resetOnboarding } from '../components/Onboarding';

interface HelpSection {
  title: string;
  items: { q: string; a: React.ReactNode }[];
}

// ─── RU ──────────────────────────────────────────────────────────────────────
const sectionsRu: HelpSection[] = [
  {
    title: '📋 Основы',
    items: [
      {
        q: 'Как добавить задачу?',
        a: 'На вкладке «Задачи» нажмите кнопку «+ Новая задача» в правом верхнем углу — откроется модальное окно. Заполните название, выберите статус и тэг (можно создать новый через «+»), при необходимости задайте даты начала и дедлайн. Внизу формы — живой предпросмотр карточки.',
      },
      {
        q: 'Как работают тэги?',
        a: 'Тэги — это метки для категоризации задач. Создавайте их в Настройки → Тэги (имя + цвет) или прямо из модалки задачи кнопкой «+». На доске задач есть горизонтально прокручиваемая панель фильтрации по тэгу.',
      },
      {
        q: 'Как работают статусы?',
        a: (
          <>
            <p>Статусы определяют группировку задач на доске. Порядок задаётся стрелками в Настройки → Статусы.</p>
            <p className="mt-2">
              <strong>Скрытый</strong> — статус не показывается на доске, но виден в Статистике и Дашборде. Полезно для статусов, которые вы не используете каждый день.
            </p>
            <p className="mt-2">
              <strong>Свёрнут по умолчанию</strong> — секция статуса видна на доске, но свёрнута. Кликните по заголовку, чтобы раскрыть. По умолчанию — у «Выполнено».
            </p>
            <p className="mt-2">Стандартные статусы: Запланировано, Взять в работу, В работе, Приостановлено, Выполнено (свёрнут).</p>
            <p className="mt-2"><strong>«Выполнено»</strong> — системный статус, его нельзя удалить. На него опирается кнопка-галочка на карточке задачи.</p>
          </>
        ),
      },
      {
        q: 'Что такое статус «Выполнено» и куда уходит задача?',
        a: (
          <>
            <p>«Выполнено» — системный статус, в который задача попадает, когда вы нажимаете кнопку-галочку (✓) на карточке. Этот же эффект — если вручную перетащить задачу в секцию «Выполнено».</p>
            <p className="mt-2">Секция «Выполнено» по умолчанию свёрнута на доске — кликните по её заголовку, чтобы раскрыть и увидеть завершённые задачи.</p>
            <p className="mt-2"><strong>Можно вернуть задачу обратно</strong>: раскройте секцию «Выполнено», откройте карточку и смените статус на нужный (например, «В работе») — задача снова появится в активных.</p>
            <p className="mt-2">Поскольку «Выполнено» используется кнопкой-галочкой, удалить этот статус в Настройки → Статусы нельзя — вместо корзины показывается значок «системный».</p>
          </>
        ),
      },
      {
        q: 'Как перетащить задачу в другой статус?',
        a: 'Перетащите карточку за иконку ⋮⋮ (drag handle) с правой стороны. Поддерживаются перестановка внутри статуса и перенос между статусами. Клик по самой карточке открывает модалку редактирования — эти жесты не конфликтуют (исправлено в v0.8.6).',
      },
      {
        q: 'Как удалить или завершить задачу?',
        a: (
          <>
            <p>Чтобы пометить задачу выполненной — нажмите кнопку-галочку (✓) на карточке: задача уйдёт в секцию «Выполнено». Чтобы удалить задачу — нажмите корзину (🗑) на карточке или кнопку «Удалить» внизу модалки.</p>
            <p className="mt-2"><strong>Удалённые задачи можно восстановить.</strong> Откройте вкладку  <strong>Статистика</strong>  → раздел «Удалённые» — там лежат все удалённые задачи с кнопкой «Восстановить».</p>
            <p className="mt-2"><strong>Безвозвратное удаление</strong> происходит только внутри вкладки Статистика: если удалить задачу там же, она исчезнет окончательно и вернуть её уже нельзя.</p>
          </>
        ),
      },
      {
        q: 'Что такое эмодзи-пикер в полях задачи? (v0.8.8)',
        a: (
          <>
            <p>Рядом с заголовком полей <strong>Название</strong> и <strong>Комментарий</strong> есть кнопка 😊. Клик — открывается панель: сначала «Недавние» (до 12), потом кнопка «Больше…» раскрывает полный picker с поиском и 8 категориями (Смайлы, Жесты, Объекты, Символы, Природа, Еда, Действия, Транспорт).</p>
            <p className="mt-2">Эмодзи вставляется в позицию каретки, фокус сохраняется. Недавние сохраняются между запусками.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '📊 Дашборд',
    items: [
      {
        q: 'Что показывает Дашборд?',
        a: (
          <>
            <p>Дашборд разделён на две зоны:</p>
            <p className="mt-2"><strong>Текущий срез</strong> (не зависит от периода): топбар с метриками (Всего / В работе / Приостановлено / Выполнено / Просрочено / Самый частый тэг), круговая диаграмма «По статусу» и столбчатая «По тэгам».</p>
            <p className="mt-2"><strong>За период</strong> (период выбирается в правом верхнем углу): график «Активность» во всю ширину с тремя линиями — новые (синяя), выполненные (зелёная), просроченные (красная) — и тепловая карта «12 недель».</p>
            <p className="mt-2">Внизу — список «Недавно завершённые».</p>
          </>
        ),
      },
      {
        q: 'Как выбрать период?',
        a: (
          <>
            <p>Кнопки «Неделя / Месяц / Квартал / Год / Свой период» в правом верхнем углу Дашборда. Период влияет только на график «Активность» (и связанные счётчики за период, если они присутствуют).</p>
            <p className="mt-1.5">«Свой период» открывает поповер — даты «От» и «До», затем «Применить».</p>
            <p className="mt-1.5">Метрики в шапке и графики «По статусу» / «По тэгам» показывают текущее состояние всех задач и не зависят от периода.</p>
          </>
        ),
      },
      {
        q: 'Что за чипы в топбаре вкладки «Задачи»?',
        a: 'Всего (синий), В работе (зелёный), Внимание (оранжевый — дедлайн в ближайшие 3 дня), Просрочено (красный). Клик по чипу фильтрует доску по соответствующим задачам.',
      },
      {
        q: 'Как читать подсветку дедлайна?',
        a: 'Синий «сегодня», оранжевый жирный — 1–3 дня до дедлайна, серый — 4+ дней, красный жирный — просрочено. Жёлтый промежуточный цвет убран в v0.8.7 для большей контрастности.',
      },
    ],
  },
  {
    title: '📥 Экспорт / Импорт',
    items: [
      {
        q: 'В каких форматах можно экспортировать?',
        a: (
          <>
            <p><strong>JSON</strong> — полная резервная копия (задачи + тэги + статусы), идеальный формат для переноса между ПК.</p>
            <p className="mt-1.5"><strong>XLSX</strong> — удобный для просмотра в Excel/Google Sheets.</p>
            <p className="mt-1.5">CSV-экспорт убран в v0.8.8: он некорректно восстанавливал статусы при обратном импорте.</p>
          </>
        ),
      },
      {
        q: 'Как импортировать?',
        a: 'Настройки → Экспорт/Импорт → «Выберите файл». Поддерживаются JSON и XLSX. После выбора показывается предпросмотр и выбор стратегии: «Слить» (добавить к существующим) или «Заменить всё». При импорте задачи без указанного статуса попадают в «Взять в работу» (v0.8.8).',
      },
      {
        q: 'Как скачать шаблон для импорта?',
        a: 'Настройки → Экспорт/Импорт → кнопка «Шаблон». Скачивает XLSX-файл со столбцами: title, comment, status, tag, start_date, deadline. Статусы и тэги по умолчанию подбираются автоматически.',
      },
    ],
  },
  {
    title: '💾 Хранилище',
    items: [
      {
        q: 'Где хранятся данные?',
        a: (
          <>
            <p>В десктопной версии — два файла в папке профиля пользователя: <code>data.db</code> (SQLite со всеми данными) и <code>taskflow_config.json</code> (только переопределение пути, если задано).</p>
            <p className="mt-1.5">На Windows это <code>%APPDATA%\TaskFlow</code> — можно открыть через <code>Win+R</code> → <code>%APPDATA%\TaskFlow</code>, либо нажать кнопку <strong>«Открыть папку»</strong> в Настройки → Хранилище (v0.8.9).</p>
            <p className="mt-1.5">В браузерной версии — IndexedDB через sql.js (SQLite WASM).</p>
          </>
        ),
      },
      {
        q: 'Можно ли держать БД в OneDrive / Dropbox / Яндекс.Диске?',
        a: (
          <>
            <p>Можно, но с оговорками. SQLite блокирует файл во время работы приложения — если на двух устройствах TaskFlow будет открыт одновременно и облако синхронизирует <code>data.db</code> на лету, база может повредиться.</p>
            <p className="mt-2">Безопасный сценарий:</p>
            <ul className="mt-1 list-disc pl-4 space-y-1">
              <li>Используйте TaskFlow только на одном устройстве за раз.</li>
              <li>Перед запуском дождитесь, пока облачный клиент завершит синхронизацию папки.</li>
              <li>Полностью закрывайте приложение (а не сворачивайте) перед сменой устройства, чтобы файлы <code>data.db</code>, <code>data.db-wal</code> и <code>data.db-shm</code> успели уйти в облако.</li>
              <li>Для надёжного переноса между устройствами лучше используйте Экспорт/Импорт в JSON.</li>
            </ul>
          </>
        ),
      },
      {
        q: 'Резервная копия на закрытии — что это?',
        a: (
          <>
            <p>При каждом штатном закрытии TaskFlow в той же папке, где лежит <code>data.db</code>, создаётся файл <code>data.db.backup</code> (или <code>&lt;ваше_имя&gt;.db.backup</code>, если вы выбрали свой путь). Это копия последнего состояния базы.</p>
            <p className="mt-2">Создать копию вручную можно в Настройки → Хранилище → блок «Резервная копия» → «Создать копию сейчас». Кнопка «Открыть папку» рядом покажет место, где лежит файл.</p>
            <p className="mt-2">Это локальная страховка от случайных сбоев. Для переноса данных между устройствами всё равно используйте Экспорт/Импорт в JSON.</p>
          </>
        ),
      },
      {
        q: 'Что делать, если всё сломалось?',
        a: (
          <>
            <p>Если приложение не запускается или база повреждена — попробуйте восстановиться из резервной копии:</p>
            <ol className="mt-2 list-decimal pl-4 space-y-1">
              <li>Полностью закройте TaskFlow (включая иконку в трее, если есть).</li>
              <li>Откройте папку с данными: Настройки → Хранилище → «Открыть папку». Если приложение не запускается — откройте вручную <code>%APPDATA%\TaskFlow</code> через <code>Win+R</code>.</li>
              <li>Переименуйте текущий <code>data.db</code> в <code>data.db.broken</code> — на случай, если захотите потом изучить.</li>
              <li>Переименуйте <code>data.db.backup</code> в <code>data.db</code>.</li>
              <li>Запустите TaskFlow — данные будут из резервной копии (на момент последнего закрытия).</li>
            </ol>
            <p className="mt-2">Если у вас есть JSON-экспорт — это самый надёжный способ восстановления: создайте пустую БД (или сотрите данные через «Опасную зону») и сделайте Импорт.</p>
          </>
        ),
      },
      {
        q: 'Как изменить путь к файлу БД?',
        a: 'Настройки → Хранилище → «Выбрать…». Откроется системный диалог выбора папки — новый <code>taskflow.db</code> будет создан внутри. «Сбросить к умолчанию» возвращает <code>%APPDATA%\\TaskFlow\\data.db</code>. Функция доступна только в десктопной версии.',
      },
      {
        q: 'Что такое «Опасная зона»?',
        a: 'Настройки → Хранилище → «⚠ Опасная зона». Кнопка «Стереть все данные» требует двух подтверждений, затем полностью очищает БД, пересоздаёт стандартные статусы и welcome-задачу — без перезагрузки страницы. Исправлено в v0.8.7: раньше в десктопе очищался только кэш в памяти.',
      },
    ],
  },
  {
    title: '🛠 Диагностика и обслуживание',
    items: [
      {
        q: 'Где лежит лог-файл и что в нём?',
        a: (
          <>
            <p>С v0.8.12 приложение ведёт технический лог рядом с БД (<code>taskflow.log</code>). Одна строка = одно событие в JSON: время, уровень, сообщение и meta-данные.</p>
            <p className="mt-2">Сюда пишутся ошибки инициализации БД, проблемы бэкапа, необработанные promise rejection и факт старта приложения — ничего из этого никуда не отправляется.</p>
            <p className="mt-2">Открыть лог можно в <strong>Настройки → Хранилище → Диагностика → «Открыть лог»</strong>. Там же — кнопка «Очистить». При достижении 1 MB файл ротируется в <code>taskflow.log.old</code> автоматически.</p>
          </>
        ),
      },
      {
        q: 'Что такое «версия схемы БД» и при чём тут миграции?',
        a: (
          <>
            <p>С v0.8.12 в SQLite-базе хранится номер схемы (PRAGMA user_version). При обновлении приложения миграции выполняются последовательно и идемпотентно — вручную делать ничего не нужно.</p>
            <p className="mt-2">Текущий номер виден в <strong>Настройки → Хранилище → Диагностика</strong>. Если схема откатилась (например, вы открыли бэкап от более свежей версии приложения) — в логе будет предупреждение.</p>
          </>
        ),
      },
      {
        q: 'Как работает «Отменить» в уведомлениях?',
        a: 'С v0.8.12 при удалении или завершении задачи (кнопкой ✓ или drag-and-drop в «Выполнено») в правом верхнем углу пару секунд висит тост с кнопкой «Отменить». Статус (и finish_date) восстанавливаются ровно в тот вид, в котором были до действия.',
      },
      {
        q: 'Как перезапустить приветственный тур?',
        a: (
          <>
            <p>Онбординг показывается один раз при первом запуске. Чтобы пройти его ещё раз — нажмите кнопку ниже и перезагрузите вкладку.</p>
            <button
              onClick={() => { resetOnboarding(); window.location.hash = '#/tasks'; window.location.reload(); }}
              className="mt-2 px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
            >
              Запустить тур заново
            </button>
          </>
        ),
      },
    ],
  },
  {
    title: '🎨 Темы и язык',
    items: [
      {
        q: 'Как переключить тему?',
        a: 'Внизу левого сайдбара — кнопка с иконкой солнца/луны. Доступны 4 темы: Светлая, Тёмная, Акацуки, Деревня листа.',
      },
      {
        q: 'Как сменить язык?',
        a: 'Настройки → Общие → Язык: русский / English. Цитаты и подсказки переключаются вместе с языком.',
      },
      {
        q: 'Что за цитаты в топбаре?',
        a: 'При каждом запуске (и при смене темы/языка) случайно выбирается мотивирующая цитата. Набор зависит от темы (для Акацуки и Деревни листа — тематические).',
      },
    ],
  },
  {
    title: '⌨ Горячие клавиши',
    items: [
      {
        q: 'Список горячих клавиш',
        a: (
          <ul className="space-y-1 list-disc pl-4">
            <li><code>1</code> — Задачи</li>
            <li><code>2</code> — Дашборд</li>
            <li><code>3</code> — Статистика</li>
            <li><code>4</code> — Настройки</li>
            <li><code>5</code> — Помощь</li>
            <li><code>/</code> — фокус на поле поиска (на вкладке Задачи)</li>
            <li><code>Esc</code> — закрыть модальное окно / отменить редактирование / закрыть эмодзи-пикер</li>
            <li><code>Enter</code> в полях карточки — сохранить inline-правку</li>
          </ul>
        ),
      },
    ],
  },
  // v0.9.25: три новые секции под то, что появилось в v0.9.0–v0.9.24:
  // Облако и аккаунт (Supabase), Безопасность и приватность, Обновления.
  {
    title: '☁ Облако и аккаунт',
    items: [
      {
        q: 'Как работает облачная синхронизация?',
        a: (
          <>
            <p>С v0.9.0 TaskFlow умеет синхронизировать ваши задачи через Supabase (Postgres + Row Level Security). Каждый пользователь видит только свои данные — RLS-политики на стороне базы гарантируют, что SELECT/INSERT/UPDATE вернёт только строки с вашим user_id.</p>
            <p className="mt-2">Синхронизация двусторонняя: локальная SQLite-база → Supabase (upsert по updated_at) и обратно. Конфликты разрешаются по last-write-wins.</p>
            <p className="mt-2"><strong>Offline-грациа</strong>: если сети нет, приложение работает без входа в течение 7 дней (grace period) — все изменения накапливаются в SQLite и уйдут в облако, как только сеть вернётся.</p>
          </>
        ),
      },
      {
        q: 'Как зарегистрироваться?',
        a: (
          <>
            <p>На экране входа переключитесь на вкладку «Регистрация», введите email и пароль (мин. 8 символов, обязательные A-Z, a-z, цифра). С v0.9.23 на экране регистрации включен Cloudflare Turnstile — защита от массового автоматического создания аккаунтов (invisible/managed, не надо ничего решать вручную в большинстве случаев).</p>
            <p className="mt-2">На ваш email придёт письмо с подтверждением — кликните по ссылке (deep-link вернёт вас в приложение через схему <code>taskflow://</code>). Пока email не подтверждён, войти не получится.</p>
          </>
        ),
      },
      {
        q: 'Забыл пароль — что делать?',
        a: (
          <>
            <p>На экране входа кликните «Забыли пароль?», введите email — письмо с recovery-ссылкой придёт в течение минуты (отправитель: no-reply@yourtaskflow.app через Resend). Клик по ссылке в письме откроет модалку «Новый пароль» в приложении.</p>
            <p className="mt-2">Recovery-ссылка действует 1 час. Если письмо не пришло — проверьте Спам/Промоакции.</p>
          </>
        ),
      },
      {
        q: 'Как сменить пароль из приложения?',
        a: 'Настройки → Аккаунт → «Сменить пароль». Модалка попросит текущий пароль (для проверки) и дважды новый. С v0.9.25 верификация текущего пароля идёт через эфемерный клиент — ваша активная сессия не трогается, следовательно после смены вы не вылетаете из приложения.',
      },
      {
        q: 'Почему первый запрос к базе бывает медленным?',
        a: (
          <>
            <p>Supabase free-tier приостанавливает проект после 7 дней без активности — первые запросы после возобновления занимают 10-30 секунд. С v0.9.22 включен keep-alive: приложение при каждом старте дёргает базу fire-and-forget-запросом, плюс GitHub Actions пингает её раз в 3 дня. В 90% случаев база не успевает уснуть.</p>
            <p className="mt-2">Если всё-таки видите задержку на первом входе — это пробуждение, последующие запросы пойдут мгновенно.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '🔒 Безопасность и приватность',
    items: [
      {
        q: 'Какие требования к паролю?',
        a: (
          <>
            <p>С v0.9.24 политика синхронизирована с Supabase Auth: минимум 8 символов, обязательно хотя бы одна строчная буква (a-z), заглавная (A-Z) и цифра. Спецсимволы не обязательны, но рекомендуются.</p>
            <p className="mt-2">Клиентская валидация живёт в <code>src/lib/password.ts</code> и используется одновременно на экране регистрации и в модалке смены пароля (v0.9.25).</p>
          </>
        ),
      },
      {
        q: 'Какая телеметрия собирается?',
        a: (
          <>
            <p>С v0.9.23 включен Sentry — собирает <strong>только</strong> необработанные ошибки, вылеты и stack-трейсы. PII не собираются: email, содержимое задач, тэги, комментарии — всё это никуда не уходит. Ошибки помогают быстрее чинить баги до релиза.</p>
            <p className="mt-2"><strong>Opt-out</strong>: Настройки → Приватность → тоггл «Отправлять ошибки в Sentry». Отключается мгновенно, перезапуск не нужен.</p>
          </>
        ),
      },
      {
        q: 'Политика конфиденциальности и лицензия?',
        a: (
          <>
            <p>Privacy Policy — Настройки → Приватность → «Политика конфиденциальности», или онлайн на <a href="https://yourtaskflow.app/privacy.html" target="_blank" rel="noopener noreferrer" className="text-accent underline">yourtaskflow.app/privacy.html</a>.</p>
            <p className="mt-2">Лицензия: <strong>PolyForm Noncommercial 1.0.0</strong> — код открыт, можно изучать и использовать в личных целях и образовании, коммерческое использование требует отдельной договорённости с автором.</p>
          </>
        ),
      },
      {
        q: 'Rate limiting и защита от bruteforce?',
        a: 'С v0.9.23 на стороне Supabase включены Rate Limiting (ограничение частоты sign-in/sign-up/otp-запросов по IP), Attack Protection (автоматический блок подозрительных IP) и Security Email Notifications — вы получаете email при входе с нового устройства.',
      },
    ],
  },
  {
    title: '🔄 Обновления',
    items: [
      {
        q: 'Как обновлять TaskFlow?',
        a: (
          <>
            <p>TaskFlow в desktop-версии поддерживает auto-updater на базе Tauri Updater: приложение периодически читает <code>latest.json</code> из GitHub Releases и показывает плитку «Доступно обновление», когда серверная версия выше вашей.</p>
            <p className="mt-2">Клик по плитке → «Скачать и установить». Обновление подписано Ed25519 (private-key в CI, public-key в клиенте), неподписанные бинари будут отвергнуты.</p>
          </>
        ),
      },
      {
        q: 'Где скачать последнюю версию вручную?',
        a: (
          <>
            <p>Основной канал: <a href="https://yourtaskflow.app" target="_blank" rel="noopener noreferrer" className="text-accent underline">yourtaskflow.app</a> — на лендинге кнопка скачивания ведёт на свежий билд.</p>
            <p className="mt-2">Все версии (NSIS установщик, MSI для en-US/ru-RU, portable exe): <a href="https://github.com/danny-swan/taskflow-app/releases" target="_blank" rel="noopener noreferrer" className="text-accent underline">github.com/danny-swan/taskflow-app/releases</a>. Каждый релиз собирается GitHub Actions на windows-latest и гатится прогоном unit + E2E-тестов.</p>
          </>
        ),
      },
    ],
  },
  // v0.9.0: секции «Что нового в 0.8.13/0.8.14» убраны — вся история версий
  // живёт в Настройки → О приложении (экран changelog), а в Help остаётся
  // блок WhatsNewSection, который берёт последний релиз из CHANGELOG[0].
];

// ─── EN ──────────────────────────────────────────────────────────────────────
const sectionsEn: HelpSection[] = [
  {
    title: '📋 Basics',
    items: [
      {
        q: 'How do I add a task?',
        a: 'On the Tasks tab, click "+ New task" in the top right — a modal opens. Fill in the title, pick a status and tag (you can create a new one with "+"), optionally set start/deadline dates. The live card preview is at the bottom of the form.',
      },
      {
        q: 'How do tags work?',
        a: 'Tags are labels for categorising tasks. Create them in Settings → Tags (name + colour) or right from the task modal via the "+" button. The board has a horizontally scrollable filter strip.',
      },
      {
        q: 'How do statuses work?',
        a: (
          <>
            <p>Statuses group tasks on the board. Order is set with arrows in Settings → Statuses.</p>
            <p className="mt-2">
              <strong>Hidden</strong> — the status is not shown on the board but is visible in Statistics and Dashboard. Useful for statuses you don't use every day.
            </p>
            <p className="mt-2">
              <strong>Collapsed by default</strong> — the section is visible on the board but collapsed. Click the header to expand. Default for "Done".
            </p>
            <p className="mt-2">Default statuses: Planned, Take into work, In progress, On hold, Done (collapsed).</p>
            <p className="mt-2"><strong>"Done"</strong> is a system status and can't be deleted. The checkmark button on the task card relies on it.</p>
          </>
        ),
      },
      {
        q: 'What is the "Done" status and where does the task go?',
        a: (
          <>
            <p>"Done" is a system status the task moves to when you click the checkmark (✓) button on the card. The same happens if you drag the task into the "Done" section manually.</p>
            <p className="mt-2">The "Done" section is collapsed by default on the board — click its header to expand it and see completed tasks.</p>
            <p className="mt-2"><strong>You can move a task back</strong>: expand the "Done" section, open the card and change its status to whatever you need (e.g. "In progress") — the task will reappear among active ones.</p>
            <p className="mt-2">Because "Done" is what the checkmark button depends on, it cannot be deleted in Settings → Statuses — instead of the trash icon you'll see a "system" badge.</p>
          </>
        ),
      },
      {
        q: 'How do I drag a task between statuses?',
        a: 'Drag the card by the ⋮⋮ handle on the right. Both reordering inside one status and moving between statuses are supported. Clicking the card body opens the edit modal — these gestures no longer conflict (fixed in v0.8.6).',
      },
      {
        q: 'How do I complete or delete a task?',
        a: (
          <>
            <p>To mark a task as completed, click the checkmark (✓) button on the card — the task moves to the “Done” section. To delete a task, click the trash icon (🗑) on the card or the “Delete” button at the bottom of the modal.</p>
            <p className="mt-2"><strong>Deleted tasks can be restored.</strong> Open the  <strong>Statistics</strong>  tab → “Deleted” section — every deleted task lives there with a “Restore” button.</p>
            <p className="mt-2"><strong>Permanent deletion</strong> only happens inside the Statistics tab: if you delete a task from there, it’s gone for good and can’t be brought back.</p>
          </>
        ),
      },
      {
        q: 'What is the emoji picker in task fields? (v0.8.8)',
        a: (
          <>
            <p>Next to the labels of the <strong>Title</strong> and <strong>Comment</strong> fields there's a 😊 button. Click it to open a panel: first the recent emojis (up to 12), then a "More…" button expanding the full picker with search and 8 categories (Smileys, Gestures, Objects, Symbols, Nature, Food, Activities, Travel).</p>
            <p className="mt-2">The emoji is inserted at the caret position and focus is preserved. Recent emojis are remembered across launches.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '📊 Dashboard',
    items: [
      {
        q: 'What does the Dashboard show?',
        a: (
          <>
            <p>The Dashboard has two zones:</p>
            <p className="mt-2"><strong>Current snapshot</strong> (does NOT depend on the period): top bar with metrics (Total / In progress / On hold / Done / Overdue / Most-used tag), pie chart "By status" and bar chart "By tag".</p>
            <p className="mt-2"><strong>For the selected period</strong> (picked in the top-right): full-width "Activity" chart with three lines — created (blue), completed (green), overdue (red) — plus the 12-week heatmap.</p>
            <p className="mt-2">At the bottom — the "Recently completed" list.</p>
          </>
        ),
      },
      {
        q: 'How do I pick a period?',
        a: (
          <>
            <p>Buttons "Week / Month / Quarter / Year / Custom" in the top right. The period only affects the Activity chart (and any period-scoped counters there).</p>
            <p className="mt-1.5">"Custom" opens a popover — pick From/To dates and click Apply.</p>
            <p className="mt-1.5">The top-bar metrics and "By status" / "By tag" charts always show the current state of all tasks regardless of period.</p>
          </>
        ),
      },
      {
        q: 'What are the chips in the Tasks topbar?',
        a: 'Total (blue), In progress (green), Attention (orange — deadline within 3 days), Overdue (red). Clicking a chip filters the board.',
      },
      {
        q: 'How is the deadline coloured?',
        a: 'Blue for "today", bold orange for 1–3 days left, muted grey for 4+ days, bold red for overdue. The intermediate yellow tier was removed in v0.8.7 for higher contrast.',
      },
    ],
  },
  {
    title: '📥 Export / Import',
    items: [
      {
        q: 'Which export formats are supported?',
        a: (
          <>
            <p><strong>JSON</strong> — full backup (tasks + tags + statuses), ideal for moving between machines.</p>
            <p className="mt-1.5"><strong>XLSX</strong> — easy to inspect in Excel/Google Sheets.</p>
            <p className="mt-1.5">CSV export was removed in v0.8.8 — it didn't round-trip statuses correctly.</p>
          </>
        ),
      },
      {
        q: 'How do I import?',
        a: 'Settings → Export/Import → "Choose file". JSON and XLSX are supported. After picking a file you see a preview and a strategy choice: "Merge" (add on top of existing) or "Replace all". Tasks without an explicit status land in "Take into work" (v0.8.8).',
      },
      {
        q: 'How do I download an import template?',
        a: 'Settings → Export/Import → "Template" button. Downloads an XLSX with columns: title, comment, status, tag, start_date, deadline. Default statuses and tags are matched automatically.',
      },
    ],
  },
  {
    title: '💾 Storage',
    items: [
      {
        q: 'Where is my data stored?',
        a: (
          <>
            <p>In the desktop app — two files in the user profile folder: <code>data.db</code> (SQLite with all data) and <code>taskflow_config.json</code> (only the DB path override, if any).</p>
            <p className="mt-1.5">On Windows that's <code>%APPDATA%\TaskFlow</code> — you can open it via <code>Win+R</code> → <code>%APPDATA%\TaskFlow</code>, or use the new <strong>"Open folder"</strong> button in Settings → Storage (v0.8.9).</p>
            <p className="mt-1.5">In the browser — IndexedDB via sql.js (SQLite WASM).</p>
          </>
        ),
      },
      {
        q: 'Can I keep the DB on OneDrive / Dropbox / Google Drive?',
        a: (
          <>
            <p>You can, but with caveats. SQLite locks the file while the app runs — if TaskFlow is open on two devices at once and the cloud syncs <code>data.db</code> on the fly, the database may get corrupted.</p>
            <p className="mt-2">Safe pattern:</p>
            <ul className="mt-1 list-disc pl-4 space-y-1">
              <li>Only use TaskFlow on one device at a time.</li>
              <li>Before launching, wait until the cloud client finishes syncing the folder.</li>
              <li>Close the app completely (don't just minimise) before switching devices, so <code>data.db</code>, <code>data.db-wal</code> and <code>data.db-shm</code> have time to upload.</li>
              <li>For reliable cross-device transfer, prefer Export/Import in JSON.</li>
            </ul>
          </>
        ),
      },
      {
        q: 'What is the on-close backup?',
        a: (
          <>
            <p>On every graceful close, TaskFlow writes <code>data.db.backup</code> next to <code>data.db</code> (or <code>&lt;your_name&gt;.db.backup</code> if you chose a custom path). It's a snapshot of the latest database state.</p>
            <p className="mt-2">You can create a backup manually in Settings → Storage → "Backup" block → "Back up now". The "Open folder" button next to it shows where the file is located.</p>
            <p className="mt-2">This is a local safety net against accidental crashes. For moving data between devices still use Export/Import in JSON.</p>
          </>
        ),
      },
      {
        q: 'What if everything is broken?',
        a: (
          <>
            <p>If the app won't start or the database is corrupted, try restoring from the backup:</p>
            <ol className="mt-2 list-decimal pl-4 space-y-1">
              <li>Close TaskFlow completely (including the tray icon, if any).</li>
              <li>Open the data folder: Settings → Storage → "Open folder". If the app won't start, open <code>%APPDATA%\TaskFlow</code> manually via <code>Win+R</code>.</li>
              <li>Rename the current <code>data.db</code> to <code>data.db.broken</code> — just in case you want to inspect it later.</li>
              <li>Rename <code>data.db.backup</code> to <code>data.db</code>.</li>
              <li>Launch TaskFlow — your data will be restored from the backup (as of the last close).</li>
            </ol>
            <p className="mt-2">If you have a JSON export — that's the most reliable way: create an empty DB (or wipe via Danger Zone) and use Import.</p>
          </>
        ),
      },
      {
        q: 'How do I change the database path?',
        a: 'Settings → Storage → "Choose…". A system folder picker opens — a fresh <code>taskflow.db</code> is created inside. "Reset to default" goes back to <code>%APPDATA%\\TaskFlow\\data.db</code>. Desktop-only.',
      },
      {
        q: 'What is the Danger Zone?',
        a: 'Settings → Storage → "⚠ Danger Zone". "Erase all data" requires two confirmations, then fully wipes the DB, recreates default statuses and a welcome task — no page reload. Fixed in v0.8.7: previously only the in-memory cache was reset on desktop.',
      },
    ],
  },
  {
    title: '🛠 Diagnostics & maintenance',
    items: [
      {
        q: 'Where is the log file and what does it contain?',
        a: (
          <>
            <p>Since v0.8.12 the app writes a technical log next to the DB (<code>taskflow.log</code>). One JSON line per event: timestamp, level, message and meta.</p>
            <p className="mt-2">It captures DB init errors, backup failures, unhandled promise rejections and the fact that the app started — nothing is uploaded anywhere.</p>
            <p className="mt-2">Open the log via <strong>Settings → Storage → Diagnostics → "Open log"</strong>. The same place has a "Clear" button. When the file reaches 1 MB it rotates to <code>taskflow.log.old</code> automatically.</p>
          </>
        ),
      },
      {
        q: 'What is "DB schema version" and what about migrations?',
        a: (
          <>
            <p>Since v0.8.12 the SQLite DB stores a schema number (PRAGMA user_version). Migrations run sequentially and idempotently on app update — nothing manual is needed.</p>
            <p className="mt-2">The current number is visible under <strong>Settings → Storage → Diagnostics</strong>. If the schema rolled back (e.g. you restored a backup from a newer app version) — you'll see a warning in the log.</p>
          </>
        ),
      },
      {
        q: 'How does "Undo" in toasts work?',
        a: 'Since v0.8.12, when you delete or complete a task (via the ✓ button or by dragging into "Done"), a toast appears in the top-right corner with an "Undo" button for a few seconds. Status (and finish_date) is restored to exactly what it was before the action.',
      },
      {
        q: 'How do I re-run the welcome tour?',
        a: (
          <>
            <p>The onboarding is shown once on the first launch. To go through it again — click the button below and reload the tab.</p>
            <button
              onClick={() => { resetOnboarding(); window.location.hash = '#/tasks'; window.location.reload(); }}
              className="mt-2 px-3 py-1.5 text-[12px] border border-border-soft rounded-md hover:bg-surface-alt"
            >
              Restart the tour
            </button>
          </>
        ),
      },
    ],
  },
  {
    title: '🎨 Themes & Language',
    items: [
      {
        q: 'How do I switch theme?',
        a: 'Bottom of the left sidebar — sun/moon icon. Four themes: Light, Dark, Akatsuki, Hidden Leaf.',
      },
      {
        q: 'How do I change language?',
        a: 'Settings → General → Language: Russian / English. Quotes and hints follow the language.',
      },
      {
        q: 'What are the topbar quotes?',
        a: 'On each launch (and on theme/language change) a random motivational quote is picked. The set depends on the theme (Akatsuki and Hidden Leaf have themed quotes).',
      },
    ],
  },
  {
    title: '⌨ Keyboard Shortcuts',
    items: [
      {
        q: 'Shortcut list',
        a: (
          <ul className="space-y-1 list-disc pl-4">
            <li><code>1</code> — Tasks</li>
            <li><code>2</code> — Dashboard</li>
            <li><code>3</code> — Statistics</li>
            <li><code>4</code> — Settings</li>
            <li><code>5</code> — Help</li>
            <li><code>/</code> — focus the search box (on the Tasks tab)</li>
            <li><code>Esc</code> — close modal / cancel edit / close emoji picker</li>
            <li><code>Enter</code> in card fields — save the inline edit</li>
          </ul>
        ),
      },
    ],
  },
  // v0.9.25: three new sections mirroring the RU version —
  // Cloud & account (Supabase), Security & privacy, Updates.
  {
    title: '☁ Cloud & account',
    items: [
      {
        q: 'How does cloud sync work?',
        a: (
          <>
            <p>Since v0.9.0 TaskFlow can sync your tasks via Supabase (Postgres + Row Level Security). Each user only sees their own data — RLS policies on the database side guarantee that SELECT/INSERT/UPDATE will only return rows with your user_id.</p>
            <p className="mt-2">Sync is bidirectional: local SQLite → Supabase (upsert by updated_at) and back. Conflicts are resolved via last-write-wins.</p>
            <p className="mt-2"><strong>Offline grace</strong>: if there is no network, the app works without login for 7 days (grace period) — all changes are stored in SQLite and pushed to the cloud once connectivity returns.</p>
          </>
        ),
      },
      {
        q: 'How do I sign up?',
        a: (
          <>
            <p>On the auth screen switch to the "Sign up" tab, enter an email and a password (min. 8 characters, must include A-Z, a-z and a digit). Since v0.9.23 the signup screen is protected by Cloudflare Turnstile — defence against mass automated account creation (invisible/managed, no puzzles for legitimate users in most cases).</p>
            <p className="mt-2">A confirmation email will land in your inbox — click the link (the deep link brings you back to the app via the <code>taskflow://</code> scheme). Sign-in is blocked until the email is confirmed.</p>
          </>
        ),
      },
      {
        q: 'I forgot my password — what now?',
        a: (
          <>
            <p>On the auth screen click "Forgot password?", enter your email — a recovery email arrives within a minute (sender: no-reply@yourtaskflow.app via Resend). Clicking the link in the email opens the "New password" modal in the app.</p>
            <p className="mt-2">The recovery link is valid for 1 hour. If the email doesn't arrive — check Spam/Promotions.</p>
          </>
        ),
      },
      {
        q: 'How do I change the password from inside the app?',
        a: 'Settings → Account → "Change password". The modal asks for your current password (for verification) and the new one twice. Since v0.9.25 the current-password check goes through an ephemeral client — your active session is not touched, so you don\'t get signed out after the change.',
      },
      {
        q: 'Why is the first request to the database sometimes slow?',
        a: (
          <>
            <p>Free-tier Supabase pauses a project after 7 days of inactivity — the first requests after wake-up take 10-30 seconds. Since v0.9.22 keep-alive is enabled: on every start the app fires a fire-and-forget request against the database, plus GitHub Actions pings it every 3 days. In 90% of cases the database never gets a chance to sleep.</p>
            <p className="mt-2">If you still see a delay on the first sign-in, that's the wake-up — subsequent requests fire instantly.</p>
          </>
        ),
      },
    ],
  },
  {
    title: '🔒 Security & privacy',
    items: [
      {
        q: 'What are the password requirements?',
        a: (
          <>
            <p>Since v0.9.24 the policy is aligned with Supabase Auth: minimum 8 characters, must include at least one lowercase letter (a-z), one uppercase (A-Z) and one digit. Special characters are not required but recommended.</p>
            <p className="mt-2">Client-side validation lives in <code>src/lib/password.ts</code> and is shared between the signup screen and the change-password modal (v0.9.25).</p>
          </>
        ),
      },
      {
        q: 'What telemetry is collected?',
        a: (
          <>
            <p>Since v0.9.23 Sentry is enabled — it collects <strong>only</strong> unhandled errors, crashes and stack traces. No PII: email, task content, tags, comments — none of this leaves the device. Errors help us fix bugs faster before release.</p>
            <p className="mt-2"><strong>Opt-out</strong>: Settings → Privacy → the "Send errors to Sentry" toggle. Disables instantly, no restart needed.</p>
          </>
        ),
      },
      {
        q: 'Privacy policy and license?',
        a: (
          <>
            <p>Privacy Policy — Settings → Privacy → "Privacy policy", or online at <a href="https://yourtaskflow.app/privacy.html" target="_blank" rel="noopener noreferrer" className="text-accent underline">yourtaskflow.app/privacy.html</a>.</p>
            <p className="mt-2">License: <strong>PolyForm Noncommercial 1.0.0</strong> — source is open, you can study and use it for personal and educational purposes; commercial use requires a separate agreement with the author.</p>
          </>
        ),
      },
      {
        q: 'Rate limiting and bruteforce protection?',
        a: 'Since v0.9.23 the Supabase side has Rate Limiting enabled (throttles sign-in/sign-up/otp requests per IP), Attack Protection (automatic block of suspicious IPs) and Security Email Notifications — you get an email when a new device signs in.',
      },
    ],
  },
  {
    title: '🔄 Updates',
    items: [
      {
        q: 'How do I update TaskFlow?',
        a: (
          <>
            <p>The desktop version of TaskFlow supports auto-update via Tauri Updater: the app periodically reads <code>latest.json</code> from GitHub Releases and shows an "Update available" tile when the server version is higher than yours.</p>
            <p className="mt-2">Click the tile → "Download and install". The update is signed with Ed25519 (private key in CI, public key in the client); unsigned binaries are rejected.</p>
          </>
        ),
      },
      {
        q: 'Where do I download the latest build manually?',
        a: (
          <>
            <p>Primary channel: <a href="https://yourtaskflow.app" target="_blank" rel="noopener noreferrer" className="text-accent underline">yourtaskflow.app</a> — the landing page's download button links to the latest build.</p>
            <p className="mt-2">All versions (NSIS installer, MSI for en-US/ru-RU, portable exe): <a href="https://github.com/danny-swan/taskflow-app/releases" target="_blank" rel="noopener noreferrer" className="text-accent underline">github.com/danny-swan/taskflow-app/releases</a>. Each release is built by GitHub Actions on windows-latest and gated by unit + E2E test runs.</p>
          </>
        ),
      },
    ],
  },
  // v0.9.0: "What's New in 0.8.13/0.8.14" sections removed — release history
  // now lives in Settings → About (changelog screen). Help keeps the
  // WhatsNewSection block, which renders the latest CHANGELOG[0] entry.
];

/** "What's New" — generated from CHANGELOG[0]. */
function WhatsNewSection({ lang }: { lang: 'ru' | 'en' }) {
  const latest = CHANGELOG[0];
  const items = latest.items[lang];
  return (
    <div>
      <div className="text-[12px] text-muted uppercase tracking-wider mb-2 font-medium">
        {lang === 'ru' ? `🆕 Что нового в v${latest.version}` : `🆕 What's New in v${latest.version}`}
      </div>
      <div className="bg-surface border border-border-soft rounded-lg p-4">
        <div className="text-[11px] text-muted mb-3">{latest.date}</div>
        <ul className="space-y-1.5 list-disc pl-4 text-[13px] text-muted leading-relaxed">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** About section. */
function AboutSection({ lang }: { lang: 'ru' | 'en' }) {
  const latest = CHANGELOG[0];
  return (
    <div>
      <div className="text-[12px] text-muted uppercase tracking-wider mb-2 font-medium">
        ℹ {lang === 'ru' ? 'О приложении' : 'About'}
      </div>
      <div className="bg-surface border border-border-soft rounded-lg p-4 text-[13px] text-muted leading-relaxed">
        <p><strong>TaskFlow v{latest.version}</strong> — {lang === 'ru' ? 'менеджер задач с поддержкой Tauri (desktop) и браузерного режима.' : 'task manager with Tauri (desktop) and browser mode support.'}</p>
        {/* v0.9.25: сайт — основная ссылка для конечных пользователей. */}
        <p className="mt-2 text-[14px]">
          {lang === 'ru' ? 'Сайт:' : 'Website:'}{' '}
          <a
            href="https://yourtaskflow.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline font-medium"
          >
            yourtaskflow.app
          </a>
        </p>
        <p className="mt-1 text-[12px] opacity-70">
          {lang === 'ru' ? 'Лендинг, скачивание последней версии, Privacy Policy и Terms.' : 'Landing page, latest build download, Privacy Policy and Terms.'}
        </p>
        {/* v0.9.25: GitHub вынесен в отдельный «Для разработчиков»-блок мелким текстом. */}
        <div className="mt-3 pt-2 border-t border-border-soft/60">
          <p className="text-[11px] uppercase tracking-wider opacity-60 mb-1">
            {lang === 'ru' ? 'Для разработчиков' : 'For developers'}
          </p>
          <p className="text-[11.5px] opacity-75">
            {lang === 'ru' ? 'Исходный код:' : 'Source code:'}{' '}
            <a
              href="https://github.com/danny-swan/taskflow-app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline"
            >
              github.com/danny-swan/taskflow-app
            </a>
          </p>
        </div>
        <p className="mt-3 text-[10.5px] opacity-60">
          © 2026 Daniil Lebedev (danny-swan) · PolyForm Noncommercial License 1.0.0
        </p>
      </div>
    </div>
  );
}

export function HelpPage() {
  const lang = useStore(s => s.language);
  const sections = lang === 'ru' ? sectionsRu : sectionsEn;
  const [openKey, setOpenKey] = useState<string | null>(null);
  const latest = CHANGELOG[0];

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5">
      <div className="max-w-2xl">
        <h2 className="font-display text-[18px] font-semibold mb-1">{tr(lang, 'help_title')}</h2>
        <div className="text-[12px] text-muted mb-5">TaskFlow v{latest.version}</div>
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="text-[12px] text-muted uppercase tracking-wider mb-2 font-medium">{section.title}</div>
              <div className="space-y-2">
                {section.items.map((item, i) => {
                  const key = `${section.title}-${i}`;
                  const open = openKey === key;
                  return (
                    <div key={key} className="bg-surface border border-border-soft rounded-lg overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenKey(open ? null : key)}
                        aria-expanded={open}
                        className="w-full text-left list-none px-4 py-3 flex items-start gap-3 select-none hover:bg-surface-alt/40"
                      >
                        <span className="text-[13.5px] font-medium flex-1">{item.q}</span>
                        <ChevronDown
                          size={15}
                          className={'text-muted transition-transform shrink-0 mt-0.5 ' + (open ? 'rotate-180' : '')}
                        />
                      </button>
                      {open && (
                        <div className="px-4 pb-3.5 text-[13px] text-muted leading-relaxed">
                          {typeof item.a === 'string' ? <p>{item.a}</p> : item.a}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <WhatsNewSection lang={lang} />
          <AboutSection lang={lang} />
        </div>
      </div>
    </div>
  );
}
