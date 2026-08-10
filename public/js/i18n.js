// ============================================================================
// Glowup Book - runtime i18n for the static SPA (no build step).
//
// Loaded as a classic script BEFORE the module scripts, so window.t() is
// available when app.js renders. Strings live in DICT keyed by id.
//   - Static markup in index.html: data-i18n="key" (textContent),
//     data-i18n-ph="key" (placeholder), data-i18n-html="key" (innerHTML).
//   - JS-generated strings in app.js: t('key', {var: x}).
// Language is saved to localStorage and auto-detected from the browser on first
// visit. User/DB content (salon names, services) is never translated.
// ============================================================================
(function () {
  const SUPPORTED = ['en', 'ru', 'ky'];
  const NAMES = { en: 'English', ru: 'Русский', ky: 'Кыргызча' };

  const DICT = {
    en: {
      'home.hero.h1': 'Find & book beauty and nail salons near you',
      'home.hero.sub': 'Browse local salons, barbers and nail studios — and book in seconds.',
      'home.search.ph': 'Search by name or city…',
      'type.all': 'All types',
      'type.hair': 'Hair salons',
      'type.barber': 'Barber shops',
      'type.nails': 'Nail studios',
      'type.beauty': 'Beauty & spa',
      'home.carousel.head': '✨ Fresh looks from salons on Glowup Book',
      'home.view.list': '☰ List',
      'home.view.map': '📍 Map',
      'home.how.h2': 'Book your next appointment in 3 steps',
      'home.how.s1.h': 'Find a salon',
      'home.how.s1.p': 'Search by name, neighborhood or type — or browse the map.',
      'home.how.s2.h': 'Book in seconds',
      'home.how.s2.p': 'Pick a service, your specialist and a time. No phone call.',
      'home.how.s3.h': 'Get confirmed',
      'home.how.s3.p': 'Instant confirmation email, plus a reminder before your visit.',
      'home.owners.eyebrow': 'For salon owners',
      'home.owners.h2': 'Run your whole salon in one place',
      'home.owners.p': 'Appointment calendar, customer records, staff & services — plus your own online booking page. Free to start.',
      'home.owners.b1': '📅 Calendar (day/week/month) with online booking',
      'home.owners.b2': '👥 Customer history, staff schedules & services',
      'home.owners.b3': '🔗 Your own page at <strong>glowupbook.com/your-salon</strong>',
      'home.owners.b4': '✉️ Automatic booking confirmations & reminders',
      'home.owners.cta.demo': '▶ Try the live demo',
      'home.owners.cta.list': 'List your salon free →',
      'home.owners.stat1': 'salons already listed',
      'home.owners.stat2': 'to get started',
      'home.owners.stat3': 'to set up your page',
      'foot.tagline': 'Find & book beauty, hair and nail salons — and the tools to run them.',
      'foot.customers': 'Customers',
      'foot.browse': 'Browse salons',
      'foot.account': 'My account',
      'foot.owners': 'Salon owners',
      'foot.list': 'List your salon',
      'foot.demo': 'See the demo',
      'foot.ownerlogin': 'Owner login',
      'foot.company': 'Company',
      'foot.contact': 'Contact',
      'foot.emplogin': 'Employee login',
      'foot.terms': 'Terms of Service',
      'foot.privacy': 'Privacy Policy',
      // --- auth ---
      'auth.tagline': 'Booking & CRM for salons, barbers, and nail studios.',
      'auth.tab.login': 'Log in',
      'auth.tab.signup': 'Sign up',
      'auth.name': 'Your name',
      'auth.email': 'Email',
      'auth.password': 'Password',
      'auth.submit.login': 'Log in',
      'auth.forgot': 'Forgot password?',
      'auth.demo': '▶ See a live demo of the dashboard',
      'auth.demo.sub': 'No signup — explore the salon CRM with sample data.',
      // --- onboarding ---
      'onb.title': 'Set up your salon',
      'onb.sub': 'This creates your dashboard and your public booking page.',
      'onb.name': 'Business name',
      'onb.type': 'Type',
      'onb.type.hair': 'Hair salon',
      'onb.type.barber': 'Barber shop',
      'onb.type.nails': 'Nail studio',
      'onb.type.beauty': 'Beauty / spa',
      'onb.currency': 'Currency',
      'onb.link': 'Booking page link',
      'onb.tz': 'Timezone',
      'onb.submit': 'Create salon →',
      // --- dashboard nav ---
      'nav.calendar': '📅 Calendar',
      'nav.appointments': '📋 Appointments',
      'nav.customers': '👥 Customers',
      'nav.services': '✂️ Services',
      'nav.staff': '💇 Staff',
      'nav.settings': '⚙️ Settings',
      'nav.storefront': '🔗 View booking page',
      'nav.signout': '↩︎ Sign out',
      // --- misc chrome ---
      'store.back': '‹ All salons',
      'legal.home': '← Home',
      'emp.badge': '· Employee',
      'common.signout': 'Sign out',
      'lang.label': 'Language',
    },
    ru: {
      'home.hero.h1': 'Найдите и запишитесь в салоны красоты и ногтевые студии рядом с вами',
      'home.hero.sub': 'Просматривайте местные салоны, барбершопы и ногтевые студии — и записывайтесь за секунды.',
      'home.search.ph': 'Поиск по названию или городу…',
      'type.all': 'Все типы',
      'type.hair': 'Парикмахерские',
      'type.barber': 'Барбершопы',
      'type.nails': 'Ногтевые студии',
      'type.beauty': 'Красота и спа',
      'home.carousel.head': '✨ Свежие образы из салонов на Glowup Book',
      'home.view.list': '☰ Список',
      'home.view.map': '📍 Карта',
      'home.how.h2': 'Запишитесь на приём в 3 шага',
      'home.how.s1.h': 'Найдите салон',
      'home.how.s1.p': 'Ищите по названию, району или типу — или смотрите на карте.',
      'home.how.s2.h': 'Запишитесь за секунды',
      'home.how.s2.p': 'Выберите услугу, мастера и время. Без звонков.',
      'home.how.s3.h': 'Получите подтверждение',
      'home.how.s3.p': 'Мгновенное письмо-подтверждение и напоминание перед визитом.',
      'home.owners.eyebrow': 'Для владельцев салонов',
      'home.owners.h2': 'Управляйте салоном в одном месте',
      'home.owners.p': 'Календарь записей, карточки клиентов, сотрудники и услуги — плюс собственная страница онлайн-записи. Начните бесплатно.',
      'home.owners.b1': '📅 Календарь (день/неделя/месяц) с онлайн-записью',
      'home.owners.b2': '👥 История клиентов, расписания сотрудников и услуги',
      'home.owners.b3': '🔗 Ваша страница на <strong>glowupbook.com/your-salon</strong>',
      'home.owners.b4': '✉️ Автоматические подтверждения и напоминания о записи',
      'home.owners.cta.demo': '▶ Попробовать демо',
      'home.owners.cta.list': 'Добавить салон бесплатно →',
      'home.owners.stat1': 'салонов уже в каталоге',
      'home.owners.stat2': 'чтобы начать',
      'home.owners.stat3': 'на настройку страницы',
      'foot.tagline': 'Салоны красоты, парикмахерские и ногтевые студии — и инструменты для управления ими.',
      'foot.customers': 'Клиентам',
      'foot.browse': 'Смотреть салоны',
      'foot.account': 'Мой аккаунт',
      'foot.owners': 'Владельцам салонов',
      'foot.list': 'Добавить салон',
      'foot.demo': 'Посмотреть демо',
      'foot.ownerlogin': 'Вход для владельцев',
      'foot.company': 'Компания',
      'foot.contact': 'Контакты',
      'foot.emplogin': 'Вход для сотрудников',
      'foot.terms': 'Условия использования',
      'foot.privacy': 'Политика конфиденциальности',
      // --- auth ---
      'auth.tagline': 'Онлайн-запись и CRM для салонов, барбершопов и ногтевых студий.',
      'auth.tab.login': 'Вход',
      'auth.tab.signup': 'Регистрация',
      'auth.name': 'Ваше имя',
      'auth.email': 'Эл. почта',
      'auth.password': 'Пароль',
      'auth.submit.login': 'Войти',
      'auth.forgot': 'Забыли пароль?',
      'auth.demo': '▶ Посмотреть демо панели',
      'auth.demo.sub': 'Без регистрации — попробуйте CRM с примерами данных.',
      // --- onboarding ---
      'onb.title': 'Настройте свой салон',
      'onb.sub': 'Создаётся панель управления и публичная страница записи.',
      'onb.name': 'Название бизнеса',
      'onb.type': 'Тип',
      'onb.type.hair': 'Парикмахерская',
      'onb.type.barber': 'Барбершоп',
      'onb.type.nails': 'Ногтевая студия',
      'onb.type.beauty': 'Красота / спа',
      'onb.currency': 'Валюта',
      'onb.link': 'Ссылка на страницу записи',
      'onb.tz': 'Часовой пояс',
      'onb.submit': 'Создать салон →',
      // --- dashboard nav ---
      'nav.calendar': '📅 Календарь',
      'nav.appointments': '📋 Записи',
      'nav.customers': '👥 Клиенты',
      'nav.services': '✂️ Услуги',
      'nav.staff': '💇 Сотрудники',
      'nav.settings': '⚙️ Настройки',
      'nav.storefront': '🔗 Открыть страницу записи',
      'nav.signout': '↩︎ Выйти',
      // --- misc chrome ---
      'store.back': '‹ Все салоны',
      'legal.home': '← На главную',
      'emp.badge': '· Сотрудник',
      'common.signout': 'Выйти',
      'lang.label': 'Язык',
    },
    ky: {
      'home.hero.h1': 'Жаныңыздагы сулуулук жана тырмак салондорун табыңыз жана жазылыңыз',
      'home.hero.sub': 'Жергиликтүү салондорду, барбершопторду жана тырмак студияларын карап, бир нече секундда жазылыңыз.',
      'home.search.ph': 'Аты же шаары боюнча издөө…',
      'type.all': 'Бардык түрлөр',
      'type.hair': 'Чач тарачтар',
      'type.barber': 'Барбершоптор',
      'type.nails': 'Тырмак студиялары',
      'type.beauty': 'Сулуулук жана спа',
      'home.carousel.head': '✨ Glowup Book салондорунан жаңы образдар',
      'home.view.list': '☰ Тизме',
      'home.view.map': '📍 Карта',
      'home.how.h2': 'Жолугушууга 3 кадам менен жазылыңыз',
      'home.how.s1.h': 'Салон табыңыз',
      'home.how.s1.p': 'Аты, району же түрү боюнча издеңиз — же картадан караңыз.',
      'home.how.s2.h': 'Бир нече секундда жазылыңыз',
      'home.how.s2.p': 'Кызматты, адисти жана убакытты тандаңыз. Чалуусуз.',
      'home.how.s3.h': 'Ырастоо алыңыз',
      'home.how.s3.p': 'Дароо ырастоо каты жана визиттен мурун эскертме.',
      'home.owners.eyebrow': 'Салон ээлери үчүн',
      'home.owners.h2': 'Салонуңузду бир жерден башкарыңыз',
      'home.owners.p': 'Жазуу календары, кардарлардын карточкалары, кызматкерлер жана кызматтар — плюс өзүңүздүн онлайн жазылуу барагыңыз. Акысыз баштаңыз.',
      'home.owners.b1': '📅 Онлайн жазылуу менен календарь (күн/жума/ай)',
      'home.owners.b2': '👥 Кардарлар тарыхы, кызматкерлердин графиги жана кызматтар',
      'home.owners.b3': '🔗 Өзүңүздүн барак: <strong>glowupbook.com/your-salon</strong>',
      'home.owners.b4': '✉️ Автоматтык ырастоолор жана эскертмелер',
      'home.owners.cta.demo': '▶ Демону сынап көрүү',
      'home.owners.cta.list': 'Салонду акысыз кошуу →',
      'home.owners.stat1': 'салон каталогдо катталган',
      'home.owners.stat2': 'баштоо үчүн',
      'home.owners.stat3': 'барак орнотууга',
      'foot.tagline': 'Сулуулук, чач жана тырмак салондорун табыңыз — жана аларды башкаруу куралдары.',
      'foot.customers': 'Кардарларга',
      'foot.browse': 'Салондорду көрүү',
      'foot.account': 'Менин аккаунтум',
      'foot.owners': 'Салон ээлерине',
      'foot.list': 'Салон кошуу',
      'foot.demo': 'Демону көрүү',
      'foot.ownerlogin': 'Ээлер үчүн кирүү',
      'foot.company': 'Компания',
      'foot.contact': 'Байланыш',
      'foot.emplogin': 'Кызматкерлер үчүн кирүү',
      'foot.terms': 'Колдонуу шарттары',
      'foot.privacy': 'Купуялык саясаты',
      // --- auth ---
      'auth.tagline': 'Салондор, барбершоптор жана тырмак студиялары үчүн онлайн жазылуу жана CRM.',
      'auth.tab.login': 'Кирүү',
      'auth.tab.signup': 'Катталуу',
      'auth.name': 'Атыңыз',
      'auth.email': 'Эл. почта',
      'auth.password': 'Сырсөз',
      'auth.submit.login': 'Кирүү',
      'auth.forgot': 'Сырсөздү унуттуңузбу?',
      'auth.demo': '▶ Панелдин демосун көрүү',
      'auth.demo.sub': 'Каттоосуз — CRM’ди үлгү маалыматтар менен сынап көрүңүз.',
      // --- onboarding ---
      'onb.title': 'Салонуңузду тууралаңыз',
      'onb.sub': 'Башкаруу панели жана коомдук жазылуу барагы түзүлөт.',
      'onb.name': 'Бизнестин аталышы',
      'onb.type': 'Түрү',
      'onb.type.hair': 'Чач тарач',
      'onb.type.barber': 'Барбершоп',
      'onb.type.nails': 'Тырмак студиясы',
      'onb.type.beauty': 'Сулуулук / спа',
      'onb.currency': 'Валюта',
      'onb.link': 'Жазылуу барагынын шилтемеси',
      'onb.tz': 'Убакыт алкагы',
      'onb.submit': 'Салон түзүү →',
      // --- dashboard nav ---
      'nav.calendar': '📅 Календарь',
      'nav.appointments': '📋 Жазылуулар',
      'nav.customers': '👥 Кардарлар',
      'nav.services': '✂️ Кызматтар',
      'nav.staff': '💇 Кызматкерлер',
      'nav.settings': '⚙️ Жөндөөлөр',
      'nav.storefront': '🔗 Жазылуу барагын ачуу',
      'nav.signout': '↩︎ Чыгуу',
      // --- misc chrome ---
      'store.back': '‹ Бардык салондор',
      'legal.home': '← Башкы бетке',
      'emp.badge': '· Кызматкер',
      'common.signout': 'Чыгуу',
      'lang.label': 'Тил',
    },
  };

  function detect() {
    try {
      const saved = localStorage.getItem('glowbook_lang');
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch (_) {}
    const nav = (navigator.language || 'en').toLowerCase();
    if (nav.startsWith('ru')) return 'ru';
    if (nav.startsWith('ky')) return 'ky';
    return 'en';
  }

  const I18N = {
    supported: SUPPORTED,
    names: NAMES,
    lang: detect(),
    // Translate a key; falls back to English, then the key itself. {var} interpolation.
    t(key, vars) {
      const d = DICT[this.lang] || DICT.en;
      let s = d[key] != null ? d[key] : (DICT.en[key] != null ? DICT.en[key] : key);
      if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
      return s;
    },
    // Fill all data-i18n* elements in `root`.
    apply(root) {
      root = root || document;
      root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.getAttribute('data-i18n')); });
      root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.setAttribute('placeholder', this.t(el.getAttribute('data-i18n-ph'))); });
      root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = this.t(el.getAttribute('data-i18n-html')); });
      document.documentElement.lang = this.lang;
    },
    // Populate + wire any <select class="lang-switch"> found in the page.
    wireSwitchers() {
      document.querySelectorAll('select.lang-switch').forEach((sel) => {
        sel.innerHTML = SUPPORTED.map((l) => `<option value="${l}"${l === this.lang ? ' selected' : ''}>${NAMES[l]}</option>`).join('');
        sel.onchange = () => this.set(sel.value);
      });
    },
    set(lang) {
      if (!SUPPORTED.includes(lang) || lang === this.lang) return;
      try { localStorage.setItem('glowbook_lang', lang); } catch (_) {}
      // Reliable full re-render for a SPA whose views are built in JS: reload,
      // and every t() call then reads the new language.
      location.reload();
    },
  };

  window.I18N = I18N;
  window.t = (k, v) => I18N.t(k, v);

  document.addEventListener('DOMContentLoaded', () => { I18N.apply(document); I18N.wireSwitchers(); });
})();
