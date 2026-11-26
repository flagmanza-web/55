/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Store, 
  Package, 
  Calculator, 
  TrendingUp, 
  Bot, 
  Plus, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  DollarSign, 
  Scale, 
  Trash2, 
  Edit3, 
  Sparkles, 
  Calendar, 
  RefreshCw, 
  FileText, 
  ArrowUpRight,
  ArrowDownRight,
  Settings,
  Send,
  Loader2,
  Printer,
  BookOpen,
  Cpu,
  Database,
  Check,
  Image as ImageIcon,
  Camera,
  Upload,
  Receipt,
  ChevronRight,
  ChevronDown,
  ArrowLeft,
  X,
  Paperclip,
  Copy,
  ListPlus,
  Tag
} from 'lucide-react';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  DEFAULT_PUBLISHED_SERVER_URL,
  fetchApiJson,
  getEffectiveApiBaseUrl,
  normalizeServerUrl,
  parseApiJsonResponse,
  resolveApiUrl,
  saveApiBaseUrl,
} from './lib/api';

// --- TYPES ---
interface Ingredient {
  id: string;
  name: string;
  unit: 'кг' | 'гр' | 'л' | 'мл' | 'шт' | 'банка';
  costPerUnit: number; // руб за единицу
  stockQty: number;
  minStock: number;
  supplier: string;
}

type RecipeItemUnit = 'кг' | 'гр' | 'шт' | 'л' | 'мл' | 'банка';
const RECIPE_ITEM_UNITS: RecipeItemUnit[] = ['кг', 'гр', 'шт', 'л', 'мл', 'банка'];

const normalizeUnit = (unit: unknown, fallback: RecipeItemUnit = 'кг'): RecipeItemUnit => {
  if (unit === 'г') return 'гр';
  if (typeof unit === 'string' && (RECIPE_ITEM_UNITS as readonly string[]).includes(unit)) {
    return unit as RecipeItemUnit;
  }
  return fallback;
};

interface RecipeItem {
  ingredientId?: string; // необязательная привязка к складу для авторасчета цены
  name: string;          // название продукта (вручную или из склада)
  quantity: number;      // вес / количество на 1 кг выхода
  unit: RecipeItemUnit;  // кг, гр, шт, л, мл, банка
  grossQty?: number;     // устаревшее поле для миграции
  netQty?: number;       // устаревшее поле для миграции
}

interface EditableRecipeItem extends RecipeItem {
  quantityInput: string;
}

interface SavedTtkProduct {
  name: string;
  unit: RecipeItemUnit;
  lastUsedAt: number;
}

const RECIPE_CATEGORIES = [
  'Выпечка',
  'Горячие блюда',
  'Супы',
  'Каши',
  'Салаты',
  'Десерты',
  'Напитки'
] as const;

type RecipeCategory = typeof RECIPE_CATEGORIES[number];

const normalizeCategory = (cat: string): RecipeCategory => {
  if (cat === 'Готовые блюда') return 'Горячие блюда';
  if (cat === 'Полуфабрикаты') return 'Супы';
  if ((RECIPE_CATEGORIES as readonly string[]).includes(cat)) {
    return cat as RecipeCategory;
  }
  return 'Горячие блюда';
};

const RECIPE_TAGS = ['постное', 'безглютеновое', 'сезонное'] as const;
type RecipeTag = typeof RECIPE_TAGS[number];

const normalizeRecipeTags = (tags: unknown): string[] => {
  if (!Array.isArray(tags)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const clean = String(raw || '').trim().toLowerCase();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
  }
  return result;
};

const getRecipeTagBadgeClass = (tag: string): string => {
  switch (tag.toLowerCase()) {
    case 'постное':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'безглютеновое':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'сезонное':
      return 'bg-orange-500/15 text-orange-300 border-orange-500/30';
    default:
      return 'bg-stone-800 text-stone-300 border-stone-700';
  }
};

interface BulkMenuDraftRow {
  id: string;
  selected: boolean;
  name: string;
  category: RecipeCategory;
  sellingPrice: number;
  tags: string[];
  matchType: 'new' | 'existing' | 'duplicate_in_list';
  existingRecipeId?: string;
}

interface Recipe {
  id: string;
  name: string;
  category: RecipeCategory;
  yieldQty: number; // базовый выход (обычно 1 кг или 1 шт)
  yieldUnit: 'кг' | 'шт' | 'л';
  prepTimeMin: number;
  items: RecipeItem[];
  steps: string[];
  sellingPrice: number; // цена продажи за базовый выход
  shelfLifeHours: number; // срок годности в часах
  tags?: string[];
  imageUrl?: string;
}

interface Expense {
  id: string;
  category: 'Ингредиенты' | 'Аренда' | 'Зарплата' | 'Коммунальные' | 'Упаковка' | 'Прочее';
  amount: number;
  date: string;
  note: string;
}

interface WasteRecord {
  id: string;
  date: string;
  itemName: string;
  quantity: number;
  unit: string;
  lossType: 'Холодная обработка (чистка)' | 'Истечение срока годности' | 'Брак производства' | 'Порча при хранении';
  totalCost: number;
  note: string;
}

const INITIAL_WASTE_RECORDS: WasteRecord[] = [
  { id: 'w-1', date: '2026-11-16', itemName: 'Картофель свежий', quantity: 5.0, unit: 'кг', lossType: 'Холодная обработка (чистка)', totalCost: 225, note: 'Очистки и глазки (потери 20%)' },
  { id: 'w-2', date: '2026-11-15', itemName: 'Киш с лососем и брокколи', quantity: 1.2, unit: 'кг', lossType: 'Истечение срока годности', totalCost: 1176, note: 'Просрочка витрины 24ч' }
];

interface WeeklyMenuRow {
  id: string;
  day: string; // 'Понедельник', etc.
  slotNumber: number; // 1 to 20
  dishName: string;
  category: string;
  weightKg: number;
  mealTime?: 'Завтрак' | 'Обед' | 'Вечер / Витрина' | 'Спецпредложение';
  portions?: number;
  notes?: string;
}

interface ChatAttachmentMeta {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'document';
  previewUrl?: string;
}

interface PendingChatAttachment extends ChatAttachmentMeta {
  dataBase64?: string;
  textContent?: string;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  attachments?: ChatAttachmentMeta[];
}

// --- INITIAL DATA ---
const DAYS_OF_WEEK = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

const INITIAL_INGREDIENTS: Ingredient[] = [
  { id: 'ing-1', name: 'Мука пшеничная в/с', unit: 'кг', costPerUnit: 65, stockQty: 45, minStock: 15, supplier: 'ООО "МилкТрейд"' },
  { id: 'ing-2', name: 'Масло сливочное 82.5%', unit: 'кг', costPerUnit: 890, stockQty: 8.5, minStock: 3, supplier: 'АО "Маслозавод №1"' },
  { id: 'ing-3', name: 'Говядина (мякоть)', unit: 'кг', costPerUnit: 780, stockQty: 12, minStock: 5, supplier: 'Фермерское хоз. "ЭкоМяс"' },
  { id: 'ing-4', name: 'Свинина (шейка)', unit: 'кг', costPerUnit: 540, stockQty: 15, minStock: 5, supplier: 'Фермерское хоз. "ЭкоМяс"' },
  { id: 'ing-5', name: 'Яйцо куриное С0', unit: 'шт', costPerUnit: 12, stockQty: 180, minStock: 60, supplier: 'Птицефабрика "Октябрьская"' },
  { id: 'ing-6', name: 'Молоко 3.2%', unit: 'л', costPerUnit: 95, stockQty: 25, minStock: 10, supplier: 'ООО "МилкТрейд"' },
  { id: 'ing-7', name: 'Картофель свежий', unit: 'кг', costPerUnit: 45, stockQty: 60, minStock: 20, supplier: 'Овощной Двор' },
  { id: 'ing-8', name: 'Лосось (филе)', unit: 'кг', costPerUnit: 1850, stockQty: 4.2, minStock: 2, supplier: 'Рыбный Мир Трейд' },
  { id: 'ing-9', name: 'Сливки 33%', unit: 'л', costPerUnit: 720, stockQty: 6, minStock: 3, supplier: 'ООО "МилкТрейд"' },
  { id: 'ing-10', name: 'Сахар белый', unit: 'кг', costPerUnit: 80, stockQty: 30, minStock: 10, supplier: 'Бакалея Юг' }
];

const INITIAL_RECIPES: Recipe[] = [
  {
    id: 'rec-1',
    name: 'Пельмени домашние (ручная лепка)',
    category: 'Горячие блюда',
    yieldQty: 1, // на 1 кг готовой продукции
    yieldUnit: 'кг',
    prepTimeMin: 90,
    sellingPrice: 750,
    shelfLifeHours: 72,
    items: [
      { ingredientId: 'ing-1', name: 'Мука пшеничная в/с', quantity: 0.500, unit: 'кг' },
      { ingredientId: 'ing-3', name: 'Говядина (мякоть)', quantity: 0.300, unit: 'кг' },
      { ingredientId: 'ing-4', name: 'Свинина (шейка)', quantity: 0.180, unit: 'кг' },
      { ingredientId: 'ing-5', name: 'Яйцо куриное С0', quantity: 1, unit: 'шт' }
    ],
    steps: [
      '1. Замесить крутое тесто из муки, воды, яйца и соли, дать отдохнуть 30 минут.',
      '2. Приготовить фарш из говядины и свинины с добавлением лука и специй.',
      '3. Раскатать тесто, вырезать кружочки, выложить фарш и слепить классические пельмени.',
      '4. Заморозить при температуре -18°C. Упаковать в фирменные пакеты по 500г.'
    ]
  },
  {
    id: 'rec-2',
    name: 'Наполеон классический с заварным кремом',
    category: 'Десерты',
    yieldQty: 1, // на 1 кг готовой продукции
    yieldUnit: 'кг',
    prepTimeMin: 180,
    sellingPrice: 1400,
    shelfLifeHours: 48,
    items: [
      { ingredientId: 'ing-1', name: 'Мука пшеничная в/с', quantity: 0.400, unit: 'кг' },
      { ingredientId: 'ing-2', name: 'Масло сливочное 82.5%', quantity: 0.350, unit: 'кг' },
      { ingredientId: 'ing-6', name: 'Молоко 3.2%', quantity: 0.500, unit: 'л' },
      { ingredientId: 'ing-5', name: 'Яйцо куриное С0', quantity: 2, unit: 'шт' },
      { ingredientId: 'ing-10', name: 'Сахар белый', quantity: 0.200, unit: 'кг' }
    ],
    steps: [
      '1. Приготовить слоеное рубленное тесто с холодным сливочным маслом.',
      '2. Выпечь тонкие коржи при 200°C до золотистого цвета.',
      '3. Сварить нежный заварной крем на молоке, желтках и масле.',
      '4. Собрать торт, промазывая коржи кремом, обсыпать крошкой и стабилизировать в холодильнике.'
    ]
  },
  {
    id: 'rec-3',
    name: 'Киш с лососем и брокколи',
    category: 'Выпечка',
    yieldQty: 1, // на 1 кг готовой продукции
    yieldUnit: 'кг',
    prepTimeMin: 60,
    sellingPrice: 980,
    shelfLifeHours: 24,
    items: [
      { ingredientId: 'ing-1', name: 'Мука пшеничная в/с', quantity: 0.280, unit: 'кг' },
      { ingredientId: 'ing-2', name: 'Масло сливочное 82.5%', quantity: 0.150, unit: 'кг' },
      { ingredientId: 'ing-8', name: 'Лосось (филе)', quantity: 0.320, unit: 'кг' },
      { ingredientId: 'ing-9', name: 'Сливки 33%', quantity: 0.200, unit: 'л' },
      { ingredientId: 'ing-5', name: 'Яйцо куриное С0', quantity: 2, unit: 'шт' }
    ],
    steps: [
      '1. Сделать песочную основу для пирога, выпечь "слепым" методом 15 минут.',
      '2. Нарезать филе лосося и соцветия брокколи.',
      '3. Залить заливкой из сливок, яиц и тертого сыра.',
      '4. Выпекать при 180°C до румяной корочки.'
    ]
  },
  {
    id: 'rec-4',
    name: 'Борщ классический с говядиной',
    category: 'Супы',
    yieldQty: 1,
    yieldUnit: 'кг',
    prepTimeMin: 90,
    sellingPrice: 520,
    shelfLifeHours: 48,
    items: [
      { ingredientId: 'ing-3', name: 'Говядина (мякоть)', quantity: 0.220, unit: 'кг' },
      { ingredientId: 'ing-7', name: 'Картофель свежий', quantity: 0.200, unit: 'кг' }
    ],
    steps: [
      '1. Сварить насыщенный говяжий бульон.',
      '2. Подготовить овощную зажарку со свеклой и томатом.',
      '3. Варить с картофелем и капустой до готовности.'
    ]
  },
  {
    id: 'rec-5',
    name: 'Каша овсяная молочная со сливочным маслом',
    category: 'Каши',
    yieldQty: 1,
    yieldUnit: 'кг',
    prepTimeMin: 25,
    sellingPrice: 380,
    shelfLifeHours: 24,
    items: [
      { ingredientId: 'ing-6', name: 'Молоко 3.2%', quantity: 0.650, unit: 'л' },
      { ingredientId: 'ing-2', name: 'Масло сливочное 82.5%', quantity: 0.060, unit: 'кг' },
      { ingredientId: 'ing-10', name: 'Сахар белый', quantity: 0.040, unit: 'кг' }
    ],
    steps: [
      '1. Довести молоко до кипения.',
      '2. Всыпать хлопья и варить на медленном огне 10–12 минут.',
      '3. Заправить сливочным маслом и сахаром.'
    ]
  },
  {
    id: 'rec-6',
    name: 'Салат картофельный с лососем и яйцом',
    category: 'Салаты',
    yieldQty: 1,
    yieldUnit: 'кг',
    prepTimeMin: 40,
    sellingPrice: 890,
    shelfLifeHours: 24,
    items: [
      { ingredientId: 'ing-7', name: 'Картофель свежий', quantity: 0.380, unit: 'кг' },
      { ingredientId: 'ing-8', name: 'Лосось (филе)', quantity: 0.220, unit: 'кг' },
      { ingredientId: 'ing-5', name: 'Яйцо куриное С0', quantity: 4, unit: 'шт' }
    ],
    steps: [
      '1. Отварить картофель и яйца, остудить и нарезать кубиком.',
      '2. Добавить нарезанное филе лосося и заправку.',
      '3. Аккуратно перемешать.'
    ]
  },
  {
    id: 'rec-7',
    name: 'Морс ягодный домашний',
    category: 'Напитки',
    yieldQty: 1,
    yieldUnit: 'кг',
    prepTimeMin: 30,
    sellingPrice: 320,
    shelfLifeHours: 48,
    items: [
      { ingredientId: 'ing-10', name: 'Сахар белый', quantity: 0.110, unit: 'кг' }
    ],
    steps: [
      '1. Отжать сок из свежих или свежемороженых ягод.',
      '2. Проварить жмых с водой и сахаром 10 минут, процедить.',
      '3. Охладить и соединить с ягодным соком.'
    ]
  }
];

const generateInitialWeeklyMenu = (): WeeklyMenuRow[] => {
  const rows: WeeklyMenuRow[] = [];
  const defaultDishes = [
    { name: 'Пельмени домашние (ручная лепка)', cat: 'Горячие блюда', weightKg: 5.0 },
    { name: 'Борщ классический с говядиной', cat: 'Супы', weightKg: 6.0 },
    { name: 'Наполеон классический с заварным кремом', cat: 'Десерты', weightKg: 3.5 },
  ];

  DAYS_OF_WEEK.forEach(day => {
    for (let i = 1; i <= 20; i++) {
      const template = defaultDishes[(i - 1) % defaultDishes.length];
      rows.push({
        id: `wm-${day}-${i}`,
        day,
        slotNumber: i,
        dishName: i <= 3 ? template.name : '',
        category: i <= 3 ? template.cat : 'Горячие блюда',
        weightKg: i <= 3 ? template.weightKg : 0,
      });
    }
  });
  return rows;
};

const INITIAL_EXPENSES: Expense[] = [
  { id: 'exp-1', category: 'Ингредиенты', amount: 35000, date: '2026-11-15', note: 'Закупка мяса и муки оптом' },
  { id: 'exp-2', category: 'Упаковка', amount: 4500, date: '2026-11-16', note: 'Фирменные коробки и стаканчики' },
  { id: 'exp-3', category: 'Коммунальные', amount: 8200, date: '2026-11-10', note: 'Электричество и вода за октябрь' }
];

export default function App() {
  // --- STATE ---
  const [activeTab, setActiveTab] = useState<'dashboard' | 'recipes' | 'weeklyMenu' | 'inventory' | 'finances' | 'waste' | 'ai'>('dashboard');
  const [selectedDay, setSelectedDay] = useState<string>('Понедельник');
  const [recipeViewMode, setRecipeViewMode] = useState<'sheet' | 'cards'>('sheet');
  const [recipeSearchQuery, setRecipeSearchQuery] = useState<string>('');
  const [recipeTagFilter, setRecipeTagFilter] = useState<string>('');
  const [recipeOnlyDraftsFilter, setRecipeOnlyDraftsFilter] = useState<boolean>(false);
  const [expandedTtkCategories, setExpandedTtkCategories] = useState<Record<string, boolean>>({});
  const [weeklyMenuSearchQuery, setWeeklyMenuSearchQuery] = useState<string>('');

  // Dish picker modal state for Weekly Menu
  const [activeMenuRowId, setActiveMenuRowId] = useState<string | null>(null);
  const [pickerCategory, setPickerCategory] = useState<RecipeCategory | null>(null);
  const [pickerSearchQuery, setPickerSearchQuery] = useState<string>('');
  
  // Safe localStorage helpers
  const safeParseStorage = <T,>(key: string, fallback: T): T => {
    try {
      const saved = localStorage.getItem(key);
      if (!saved) return fallback;
      return JSON.parse(saved) as T;
    } catch {
      return fallback;
    }
  };

  const safeSaveStorage = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage quota or private mode errors cleanly
    }
  };

  // Persistent data states
  const [ingredients, setIngredients] = useState<Ingredient[]>(() => {
    const parsed = safeParseStorage<Ingredient[]>('cp_ingredients', INITIAL_INGREDIENTS);
    if (!Array.isArray(parsed)) return INITIAL_INGREDIENTS;
    return parsed.map(ing => ({
      ...ing,
      unit: normalizeUnit(ing.unit, 'кг'),
    }));
  });

  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    const parsed = safeParseStorage<any[]>('cp_recipes', INITIAL_RECIPES);
    if (!Array.isArray(parsed)) return INITIAL_RECIPES;
    return parsed.map((r: any) => ({
      ...r,
      category: normalizeCategory(r.category || 'Горячие блюда'),
      tags: normalizeRecipeTags(r.tags),
      items: Array.isArray(r.items)
        ? r.items.map((rawItem: any): RecipeItem => {
            const matchedIng = rawItem?.ingredientId
              ? ingredients.find(i => i.id === rawItem.ingredientId) || INITIAL_INGREDIENTS.find(i => i.id === rawItem.ingredientId)
              : undefined;
            const name =
              typeof rawItem?.name === 'string' && rawItem.name.trim()
                ? rawItem.name.trim()
                : matchedIng?.name || 'Продукт';
            const unit = normalizeUnit(rawItem?.unit || matchedIng?.unit, 'кг');
            const quantity =
              typeof rawItem?.quantity === 'number'
                ? rawItem.quantity
                : typeof rawItem?.netQty === 'number'
                  ? rawItem.netQty
                  : typeof rawItem?.grossQty === 'number'
                    ? rawItem.grossQty
                    : 0;
            return {
              ...(rawItem?.ingredientId ? { ingredientId: rawItem.ingredientId } : {}),
              name,
              quantity,
              unit,
            };
          })
        : [],
    }));
  });

  const [weeklyMenuRows, setWeeklyMenuRows] = useState<WeeklyMenuRow[]>(() => {
    const parsed = safeParseStorage<any[] | null>('cp_weekly_menu_rows', null);
    if (!Array.isArray(parsed)) return generateInitialWeeklyMenu();
    return parsed.map((r: any) => ({
      ...r,
      category: normalizeCategory(r.category || 'Горячие блюда'),
      weightKg: typeof r.weightKg === 'number' ? r.weightKg : (typeof r.portions === 'number' ? r.portions : 0)
    }));
  });

  const [expenses, setExpenses] = useState<Expense[]>(() =>
    safeParseStorage<Expense[]>('cp_expenses', INITIAL_EXPENSES)
  );

  const [monthlyRevenue, setMonthlyRevenue] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('cp_monthly_revenue');
      const parsed = saved ? parseFloat(saved) : NaN;
      return Number.isFinite(parsed) ? parsed : 485000;
    } catch {
      return 485000;
    }
  });

  const [wasteRecords, setWasteRecords] = useState<WasteRecord[]>(() =>
    safeParseStorage<WasteRecord[]>('cp_waste_records', INITIAL_WASTE_RECORDS)
  );

  const [isNewWasteModalOpen, setIsNewWasteModalOpen] = useState(false);
  const [appNotice, setAppNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const showNotice = (type: 'success' | 'error', text: string) => {
    setAppNotice({ type, text });
  };

  useEffect(() => {
    if (!appNotice) return;
    const timer = window.setTimeout(() => setAppNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [appNotice]);

  // AI settings & MANDATORY LONG TERM MEMORY
  const [aiMode, setAiMode] = useState<'gemini' | 'local'>('gemini');
  const [localEndpoint, setLocalEndpoint] = useState<string>(() => {
    try {
      return localStorage.getItem('cp_local_endpoint') || 'http://localhost:11434/api/generate';
    } catch {
      return 'http://localhost:11434/api/generate';
    }
  });
  const [apiServerUrl, setApiServerUrl] = useState<string>(() => getEffectiveApiBaseUrl());
  const [isCheckingServer, setIsCheckingServer] = useState(false);

  const [aiMemoryNotes, setAiMemoryNotes] = useState<string>(() => {
    return localStorage.getItem('cp_ai_memory') || 'Домашняя кухня "САЛАТиКо". Долговременная память: рецепты ТТК рассчитаны точно на 1 кг готовой продукции. Основной упор на горячие блюда, супы, каши, авторскую выпечку, салаты, десерты и напитки. Целевой фудкост 28-32%.';
  });

  const [aiChat, setAiChat] = useState<ChatMessage[]>(() => {
    const saved = localStorage.getItem('cp_ai_chat');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) { /* ignore */ }
    }
    return [
      { 
        role: 'assistant', 
        text: 'Приветствую! Я ваш Шеф-ИИ с активной долговременной памятью. Все рецепты и граммовки в ТТК в системе рассчитаны на 1 кг (или 1 ед.) готовой продукции с возможностью мгновенного пересчета на любой общий объем. Чем помочь?',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  });

  // Loading states
  const [isParsingPhoto, setIsParsingPhoto] = useState(false);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isReceiptModalOpen, setIsReceiptModalOpen] = useState(false);
  const [isParsingReceipt, setIsParsingReceipt] = useState(false);
  const [isFinanceModalOpen, setIsFinanceModalOpen] = useState(false);
  const [isParsingFinance, setIsParsingFinance] = useState(false);

  const handleFileUploadForFinances = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingFinance(true);
    const reader = new FileReader();
    reader.onload = async () => {
      const base64String = (reader.result as string).split(',')[1];
      try {
        const data = await fetchApiJson<{ financials?: any; error?: string }>('/api/gemini/parse-financial-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64String, mimeType: file.type })
        });
        if (data.financials) {
          if (data.financials.revenue && data.financials.revenue > 0) {
            setMonthlyRevenue(data.financials.revenue);
          }
          if (data.financials.expenses && Array.isArray(data.financials.expenses)) {
            const newExpenses: Expense[] = data.financials.expenses.map((ex: any, idx: number) => ({
              id: `exp-parse-${Date.now()}-${idx}`,
              category: ex.category || 'Прочее',
              amount: parseFloat(ex.amount) || 0,
              date: ex.date || new Date().toISOString().split('T')[0],
              note: ex.note || 'Из финансового отчета (ИИ)'
            }));
            setExpenses(prev => [...newExpenses, ...prev]);
          }
          setIsFinanceModalOpen(false);
          showNotice('success', 'Финансовый отчет распознан и добавлен в журнал.');
        } else if (data.error) {
          showNotice('error', 'Ошибка распознавания отчета: ' + data.error);
        }
      } catch (err: any) {
        showNotice('error', 'Ошибка сети при распознавании отчета: ' + err.message);
      } finally {
        setIsParsingFinance(false);
      }
    };
    reader.onerror = () => {
      showNotice('error', 'Не удалось прочитать файл финансового отчета.');
      setIsParsingFinance(false);
    };
    reader.readAsDataURL(file);
  };

  // Desired yield state for TTK recalculation (default 1 kg)
  const [desiredTotalYield, setDesiredTotalYield] = useState<number>(1);

  // Save to localStorage
  useEffect(() => {
    safeSaveStorage('cp_ingredients', JSON.stringify(ingredients));
  }, [ingredients]);

  useEffect(() => {
    safeSaveStorage('cp_recipes', JSON.stringify(recipes));
  }, [recipes]);

  useEffect(() => {
    safeSaveStorage('cp_weekly_menu_rows', JSON.stringify(weeklyMenuRows));
  }, [weeklyMenuRows]);

  useEffect(() => {
    safeSaveStorage('cp_expenses', JSON.stringify(expenses));
  }, [expenses]);

  useEffect(() => {
    safeSaveStorage('cp_waste_records', JSON.stringify(wasteRecords));
  }, [wasteRecords]);

  useEffect(() => {
    safeSaveStorage('cp_monthly_revenue', monthlyRevenue.toString());
  }, [monthlyRevenue]);

  useEffect(() => {
    const sanitized = aiChat.map(msg => ({
      ...msg,
      attachments: msg.attachments?.map(({ previewUrl, ...rest }) => rest)
    }));
    safeSaveStorage('cp_ai_chat', JSON.stringify(sanitized));
  }, [aiChat]);

  useEffect(() => {
    safeSaveStorage('cp_ai_memory', aiMemoryNotes);
  }, [aiMemoryNotes]);

  useEffect(() => {
    safeSaveStorage('cp_local_endpoint', localEndpoint);
  }, [localEndpoint]);

  // Modals & Active View states
  const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
  const [recipeToDelete, setRecipeToDelete] = useState<Recipe | null>(null);
  const [isEditingRecipeItems, setIsEditingRecipeItems] = useState(false);
  const [isNewRecipeDraft, setIsNewRecipeDraft] = useState(false);
  const [editableRecipeItems, setEditableRecipeItems] = useState<EditableRecipeItem[]>([]);
  const [editableRecipeMeta, setEditableRecipeMeta] = useState<{
    name: string;
    category: RecipeCategory;
    sellingPrice: string;
    prepTimeMin: string;
    shelfLifeHours: string;
    tags: string[];
    stepsText: string;
  }>({
    name: '',
    category: 'Горячие блюда',
    sellingPrice: '600',
    prepTimeMin: '30',
    shelfLifeHours: '48',
    tags: [],
    stepsText: '',
  });
  const [customTagInput, setCustomTagInput] = useState('');
  const [draftYieldInput, setDraftYieldInput] = useState('1');
  const [isCustomYieldManual, setIsCustomYieldManual] = useState(false);
  const [isBulkPasteOpen, setIsBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [isSuggestingRecipeAi, setIsSuggestingRecipeAi] = useState(false);
  const [isBulkMenuModalOpen, setIsBulkMenuModalOpen] = useState(false);
  const [bulkMenuRawText, setBulkMenuRawText] = useState('');
  const [bulkMenuRows, setBulkMenuRows] = useState<BulkMenuDraftRow[]>([]);
  const [bulkMenuUpdateExisting, setBulkMenuUpdateExisting] = useState(true);
  const ttkProductInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocusRowRef = useRef<number | null>(null);
  const activeProductRowRef = useRef<HTMLDivElement | null>(null);
  const [activeProductDropdownIdx, setActiveProductDropdownIdx] = useState<number | null>(null);
  const [recentTtkProducts, setRecentTtkProducts] = useState<SavedTtkProduct[]>(() => {
    const parsed = safeParseStorage<SavedTtkProduct[] | null>('cp_recent_ttk_products', null);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed
        .filter(p => p && typeof p.name === 'string' && p.name.trim())
        .map((p, idx) => ({
          name: p.name.trim(),
          unit: normalizeUnit(p.unit, 'гр'),
          lastUsedAt: typeof p.lastUsedAt === 'number' ? p.lastUsedAt : Date.now() - idx,
        }));
    }
    const seen = new Set<string>();
    const seeded: SavedTtkProduct[] = [];
    let ts = Date.now();
    for (const rec of recipes) {
      for (const it of rec.items || []) {
        const cleanName = (it.name || '').trim();
        const key = cleanName.toLowerCase();
        if (!cleanName || seen.has(key)) continue;
        seen.add(key);
        seeded.push({
          name: cleanName,
          unit: normalizeUnit(it.unit, 'гр'),
          lastUsedAt: ts--,
        });
      }
    }
    return seeded;
  });
  const [isNewIngredientModalOpen, setIsNewIngredientModalOpen] = useState(false);
  const [isNewExpenseModalOpen, setIsNewExpenseModalOpen] = useState(false);

  useEffect(() => {
    safeSaveStorage('cp_recent_ttk_products', JSON.stringify(recentTtkProducts));
  }, [recentTtkProducts]);

  const recordTtkProducts = (entries: Array<{ name?: string; unit?: RecipeItemUnit }>) => {
    const valid = entries
      .map(e => ({
        name: (e.name || '').trim(),
        unit: normalizeUnit(e.unit, 'гр'),
      }))
      .filter(e => e.name.length >= 2 && e.name.toLowerCase() !== 'продукт');
    if (valid.length === 0) return;

    setRecentTtkProducts(prev => {
      const byKey = new Map<string, SavedTtkProduct>();
      for (const item of prev) {
        const key = item.name.trim().toLowerCase();
        if (key && !byKey.has(key)) {
          byKey.set(key, item);
        }
      }
      const baseTs = Date.now();
      valid.forEach((entry, i) => {
        const key = entry.name.toLowerCase();
        byKey.set(key, {
          name: entry.name,
          unit: entry.unit,
          lastUsedAt: baseTs + i + 1,
        });
      });
      return Array.from(byKey.values())
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, 500);
    });
  };

  const allTtkProductCatalog = useMemo(() => {
    const ingByKey = new Map<string, Ingredient>();
    for (const ing of ingredients) {
      const k = ing.name.trim().toLowerCase();
      if (k && !ingByKey.has(k)) ingByKey.set(k, ing);
    }

    const seen = new Set<string>();
    const recentList: Array<{
      name: string;
      unit: RecipeItemUnit;
      matchedIngredient?: Ingredient;
      isRecent: boolean;
    }> = [];
    const extraList: Array<{
      name: string;
      unit: RecipeItemUnit;
      matchedIngredient?: Ingredient;
      isRecent: boolean;
    }> = [];

    for (const saved of recentTtkProducts) {
      const key = saved.name.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      recentList.push({
        name: saved.name.trim(),
        unit: saved.unit,
        matchedIngredient: ingByKey.get(key),
        isRecent: true,
      });
    }

    for (const rec of recipes) {
      for (const it of rec.items || []) {
        const cleanName = (it.name || '').trim();
        const key = cleanName.toLowerCase();
        if (!cleanName || seen.has(key)) continue;
        seen.add(key);
        extraList.push({
          name: cleanName,
          unit: normalizeUnit(it.unit, 'гр'),
          matchedIngredient: ingByKey.get(key),
          isRecent: false,
        });
      }
    }

    for (const ing of ingredients) {
      const cleanName = ing.name.trim();
      const key = cleanName.toLowerCase();
      if (!cleanName || seen.has(key)) continue;
      seen.add(key);
      extraList.push({
        name: cleanName,
        unit: normalizeUnit(ing.unit, 'кг'),
        matchedIngredient: ing,
        isRecent: false,
      });
    }

    extraList.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    return [...recentList, ...extraList];
  }, [recentTtkProducts, recipes, ingredients]);

  useEffect(() => {
    if (activeProductDropdownIdx === null) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (activeProductRowRef.current && !activeProductRowRef.current.contains(e.target as Node)) {
        const currentRow = editableRecipeItems[activeProductDropdownIdx];
        if (currentRow && currentRow.name.trim().length >= 2) {
          recordTtkProducts([{ name: currentRow.name, unit: currentRow.unit }]);
        }
        setActiveProductDropdownIdx(null);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [activeProductDropdownIdx, editableRecipeItems]);

  useEffect(() => {
    if (pendingFocusRowRef.current !== null) {
      const targetIdx = pendingFocusRowRef.current;
      pendingFocusRowRef.current = null;
      const el = ttkProductInputRefs.current[targetIdx];
      if (el) el.focus();
    }
  }, [editableRecipeItems.length]);

  const openRecipeModal = (recipe: Recipe, startInEdit = false) => {
    const initialYield = recipe.yieldQty && recipe.yieldQty > 0 ? recipe.yieldQty : 1;
    const autoWeightKg = calculateItemsTotalWeightKg(recipe.items);
    setSelectedRecipe(recipe);
    setIsNewRecipeDraft(false);
    setDesiredTotalYield(initialYield);
    setDraftYieldInput(String(initialYield));
    setIsCustomYieldManual(autoWeightKg > 0 && Math.abs(initialYield - autoWeightKg) > 0.005);
    setIsEditingRecipeItems(startInEdit);
    setActiveProductDropdownIdx(null);
    setIsBulkPasteOpen(false);
    setBulkPasteText('');
    setCustomTagInput('');
    setEditableRecipeItems(
      recipe.items.length > 0
        ? toEditableItems(recipe.items)
        : [{ name: '', quantity: 0, quantityInput: '', unit: 'гр' }]
    );
    setEditableRecipeMeta({
      name: recipe.name,
      category: recipe.category,
      sellingPrice: String(recipe.sellingPrice || 0),
      prepTimeMin: String(recipe.prepTimeMin || 30),
      shelfLifeHours: String(recipe.shelfLifeHours || 48),
      tags: normalizeRecipeTags(recipe.tags),
      stepsText: (recipe.steps || []).join('\n'),
    });
  };

  const openNewRecipeEditor = (category: RecipeCategory = 'Горячие блюда') => {
    const draft: Recipe = {
      id: `rec-draft-${Date.now()}`,
      name: '',
      category,
      yieldQty: 1,
      yieldUnit: 'кг',
      prepTimeMin: 30,
      sellingPrice: 600,
      shelfLifeHours: 48,
      tags: [],
      items: [],
      steps: [],
    };
    setSelectedRecipe(draft);
    setIsNewRecipeDraft(true);
    setDesiredTotalYield(1);
    setDraftYieldInput('1');
    setIsCustomYieldManual(false);
    setIsEditingRecipeItems(true);
    setActiveProductDropdownIdx(null);
    setIsBulkPasteOpen(false);
    setBulkPasteText('');
    setCustomTagInput('');
    setEditableRecipeItems([{ name: '', quantity: 0, quantityInput: '', unit: 'гр' }]);
    setEditableRecipeMeta({
      name: '',
      category,
      sellingPrice: '600',
      prepTimeMin: '30',
      shelfLifeHours: '48',
      tags: [],
      stepsText: '',
    });
  };

  const handleDuplicateRecipe = (recipe: Recipe) => {
    const cloned: Recipe = {
      ...recipe,
      id: `rec-${Date.now()}`,
      name: `${recipe.name} (копия)`,
      tags: [...normalizeRecipeTags(recipe.tags)],
      items: recipe.items.map(it => ({ ...it })),
      steps: [...(recipe.steps || [])],
    };
    setRecipes(prev => [cloned, ...prev]);
    setExpandedTtkCategories(prev => ({ ...prev, [cloned.category]: true }));
    openRecipeModal(cloned, true);
    showNotice('success', `Создана копия ТТК «${cloned.name}» — можно сразу изменить состав.`);
  };

  const parseBulkRecipeLines = (rawText: string): EditableRecipeItem[] => {
    const mapTokenToUnit = (rawUnit?: string): RecipeItemUnit => {
      if (!rawUnit) return 'гр';
      const u = rawUnit.toLowerCase().replace(/\.$/, '');
      if (u === 'кг' || u === 'kg') return 'кг';
      if (u === 'гр' || u === 'г' || u === 'g') return 'гр';
      if (u === 'шт') return 'шт';
      if (u === 'л' || u === 'l') return 'л';
      if (u === 'мл' || u === 'ml') return 'мл';
      if (u.startsWith('бан') || u === 'б') return 'банка';
      return 'гр';
    };

    const rows: EditableRecipeItem[] = [];
    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.trim().replace(/^([•*—–-]|\d+[.)])\s*/, ''))
      .filter(Boolean);

    for (const line of lines) {
      let name = line;
      let qty = 0;
      let unit: RecipeItemUnit = 'гр';

      // Pattern 1: "Колбаса докторская 250 гр" / "Молоко 3.2% - 0,5 л" / "Горошек 1 банка"
      const endMatch = line.match(
        /^(.*?)(?:[\s\-—:=;\t]+)(\d+(?:[.,]\d+)?)\s*(кг|kg|гр|г|g|шт|л|l|мл|ml|банка|банки|банок|бан|б)?\.?$/i
      );
      if (endMatch && endMatch[1].trim()) {
        name = endMatch[1].replace(/[\s\-—:=;]+$/, '').trim();
        qty = parseFloat(endMatch[2].replace(',', '.')) || 0;
        unit = mapTokenToUnit(endMatch[3]);
      } else {
        // Pattern 2: "250 гр Колбаса докторская"
        const startMatch = line.match(
          /^(\d+(?:[.,]\d+)?)\s*(кг|kg|гр|г|g|шт|л|l|мл|ml|банка|банки|банок|бан|б)?\.?(?:[\s\-—:=;\t]+)(.+)$/i
        );
        if (startMatch && startMatch[3].trim()) {
          qty = parseFloat(startMatch[1].replace(',', '.')) || 0;
          unit = mapTokenToUnit(startMatch[2]);
          name = startMatch[3].trim();
        }
      }

      const matched = ingredients.find(
        ing => ing.name.trim().toLowerCase() === name.toLowerCase()
      );
      rows.push({
        ...(matched ? { ingredientId: matched.id } : {}),
        name,
        quantity: qty,
        quantityInput: qty > 0 ? String(qty) : '',
        unit,
      });
    }
    return rows;
  };

  const guessCategoryFromDishName = (rawName: string): RecipeCategory => {
    const n = rawName.toLowerCase().trim();
    if (/(чай|квас|морс|компот|сок\b|кофе|какао|лимонад|кисель|узвар|смузи|напиток)/.test(n)) {
      return 'Напитки';
    }
    if (/(борщ|суп\b|окрошк|солянк|рассольник|\bщи\b|\bуха\b|бульон|харчо|том ям|шорпа|лагман|свекольник)/.test(n)) {
      return 'Супы';
    }
    if (/(каша|перловк|\bкутя\b|кутья|овсян|пшен|манная|булгур|^греч[аи]\s*(отвар|молоч)?$)/.test(n)) {
      return 'Каши';
    }
    if (/(киш\b|пирог|хачапури|чебурек|лаваш|\bпита\b|пицц|блин|маффин|бургер|бигмак|корндог|сэндвич|булоч|слойк|пирож|беляш|самса|ватрушк)/.test(n)) {
      return 'Выпечка';
    }
    if (/(торт|наполеон|сырник|творожник|запеканка творож|тирамису|чизкейк|эклер|пирожн|десерт|фруктов|арбуз|медовик|мусс)/.test(n)) {
      return 'Десерты';
    }
    if (
      /(^салат|оливье|винегрет|винетрет|цезарь|крабов|мимоз|под шубой|греческий|витаминн|по-корейски|огурцы битые|дайкон|гнездо глухар|гранатовый браслет|боул|свежест|свекл|столичн|обжорк|подсолнух|грибная полянк|малахитов|рыжик|шпротк|тиффани|черепаш|капитан|адмирал|конференц|панночк|марио|мелодия|сказк|трио|тунец|нежност|весна|летний|южный|ялта|дачный|русский|пользу|холостяк|красное и белое|кремлевск|ореховый принц|новый краб|салатико|сахолин|сахалин|азия с|юдзу|финесс|мясной богатырь|ленивый ролл)/.test(
        n
      )
    ) {
      return 'Салаты';
    }
    return 'Горячие блюда';
  };

  const guessTagsFromDishName = (rawName: string): string[] => {
    const tags: string[] = [];
    if (/постн/i.test(rawName)) tags.push('постное');
    if (/без\s*глютен|безглютен|\bб\/г\b/i.test(rawName)) tags.push('безглютеновое');
    if (/сезон|весна|летний/i.test(rawName)) tags.push('сезонное');
    return tags;
  };

  const parseBulkMenuLines = (rawText: string): BulkMenuDraftRow[] => {
    const existingByName = new Map<string, Recipe>();
    recipes.forEach(r => existingByName.set(r.name.trim().toLowerCase(), r));

    const seenInBatch = new Set<string>();
    const rows: BulkMenuDraftRow[] = [];

    const lines = rawText
      .split(/\r?\n/)
      .map(l => l.replace(/\u00A0/g, ' ').trim())
      .filter(Boolean);

    lines.forEach((rawLine, idx) => {
      // Skip header lines like "Наименование Цена, руб."
      if (
        /^(наименование|название|блюдо|позиция|товар)\b/i.test(rawLine) &&
        /(цена|руб|стоимость)/i.test(rawLine)
      ) {
        return;
      }

      let name = rawLine;
      let price = 0;

      // 1) Tab or semicolon delimited (Excel / CSV paste)
      const sepMatch = rawLine.match(/^(.+?)[\t;]+([\d\s.,]+)\s*(?:₽|руб\.?|р\.?)?$/i);
      if (sepMatch && sepMatch[1].trim()) {
        name = sepMatch[1].trim();
        const normalizedNum = sepMatch[2].replace(/\s+/g, '').replace(',', '.');
        price = Math.max(0, Math.round((parseFloat(normalizedNum) || 0) * 100) / 100);
      } else {
        // 2) Trailing price separated by space / dash (handles "1 400,00" thousands separator)
        const trailingMatch = rawLine.match(
          /^(.+?)(?:[\s\-—:]+)((?:\d{1,3}(?:\s\d{3})+|\d+)(?:[.,]\d{1,2})?)\s*(?:₽|руб\.?|р\.?)?$/i
        );
        if (trailingMatch && trailingMatch[1].trim()) {
          name = trailingMatch[1].replace(/[\s\-—:]+$/, '').trim();
          const normalizedNum = trailingMatch[2].replace(/\s+/g, '').replace(',', '.');
          price = Math.max(0, Math.round((parseFloat(normalizedNum) || 0) * 100) / 100);
        }
      }

      name = name.replace(/^(\d+[.)]\s*|[•*—–-]\s*)/, '').trim();
      if (!name) return;

      const key = name.toLowerCase();
      const existingMatch = existingByName.get(key);
      const isDuplicateInList = seenInBatch.has(key);
      seenInBatch.add(key);

      const isJunkOrZero = price <= 0 || /^(тест|пакет)$/i.test(key);
      const matchType: BulkMenuDraftRow['matchType'] = isDuplicateInList
        ? 'duplicate_in_list'
        : existingMatch
          ? 'existing'
          : 'new';

      rows.push({
        id: `bulk-${idx}-${key.slice(0, 12)}`,
        selected: !isDuplicateInList && !isJunkOrZero,
        name,
        category: existingMatch ? existingMatch.category : guessCategoryFromDishName(name),
        sellingPrice: price,
        tags: guessTagsFromDishName(name),
        matchType,
        existingRecipeId: existingMatch?.id,
      });
    });

    return rows;
  };

  const handleBulkMenuTextChange = (text: string) => {
    setBulkMenuRawText(text);
    setBulkMenuRows(parseBulkMenuLines(text));
  };

  const handleImportBulkMenu = () => {
    const selectedRows = bulkMenuRows.filter(r => r.selected && r.name.trim());
    if (selectedRows.length === 0) {
      showNotice('error', 'Отметьте хотя бы одно блюдо для импорта.');
      return;
    }

    let addedCount = 0;
    let updatedCount = 0;
    const touchedCategories: Record<string, boolean> = {};
    const updatesById = new Map<string, BulkMenuDraftRow>();
    const newRecipesToAdd: Recipe[] = [];
    const baseTs = Date.now();

    selectedRows.forEach((row, idx) => {
      const cleanName = row.name.trim();
      if (row.matchType === 'existing' && row.existingRecipeId) {
        if (bulkMenuUpdateExisting) {
          updatesById.set(row.existingRecipeId, row);
          touchedCategories[row.category] = true;
          updatedCount++;
        }
        return;
      }

      const newRec: Recipe = {
        id: `rec-${baseTs}-${idx}`,
        name: cleanName,
        category: row.category,
        yieldQty: 1,
        yieldUnit: 'кг',
        prepTimeMin: 30,
        sellingPrice: Math.max(0, row.sellingPrice),
        shelfLifeHours: 48,
        tags: normalizeRecipeTags(row.tags),
        items: [],
        steps: [],
      };
      newRecipesToAdd.push(newRec);
      touchedCategories[row.category] = true;
      addedCount++;
    });

    if (addedCount === 0 && updatedCount === 0) {
      showNotice('error', 'Нет новых позиций для добавления (все выбранные уже есть в ТТК).');
      return;
    }

    setRecipes(prev => {
      const updatedExisting = prev.map(r => {
        const upd = updatesById.get(r.id);
        if (!upd) return r;
        const mergedTags = normalizeRecipeTags([...(r.tags || []), ...(upd.tags || [])]);
        return {
          ...r,
          sellingPrice: Math.max(0, upd.sellingPrice),
          tags: mergedTags,
        };
      });
      return [...newRecipesToAdd, ...updatedExisting];
    });

    setExpandedTtkCategories(prev => ({ ...prev, ...touchedCategories }));
    if (addedCount > 0) {
      setRecipeOnlyDraftsFilter(true);
    }
    setIsBulkMenuModalOpen(false);
    setBulkMenuRawText('');
    setBulkMenuRows([]);
    showNotice(
      'success',
      `Импортировано ТТК: +${addedCount} новых${updatedCount > 0 ? `, обновлено цен: ${updatedCount}` : ''}. Включён фильтр «Без состава» для заполнения ингредиентов.`
    );
  };

  const handleDeleteRecipe = (recipe: Recipe) => {
    setRecipes(prev => prev.filter(r => r.id !== recipe.id));
    if (selectedRecipe?.id === recipe.id) {
      setSelectedRecipe(null);
      setIsNewRecipeDraft(false);
    }
    setRecipeToDelete(null);
  };

  // AI Input & UI state
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [showAiSettingsMobile, setShowAiSettingsMobile] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingChatAttachment[]>([]);
  const [chatAttachmentError, setChatAttachmentError] = useState<string | null>(null);
  const [isDraggingChatFile, setIsDraggingChatFile] = useState(false);
  const [previewChatImage, setPreviewChatImage] = useState<{ url: string; name: string } | null>(null);
  const aiMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab === 'ai') {
      aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiChat, aiLoading, activeTab, pendingAttachments.length]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  };

  const renderFoodCostProgressBar = (fcPercent: number) => {
    const maxScale = 60;
    const clampedPct = Math.min(100, Math.max(0, (fcPercent / maxScale) * 100));
    const targetStart = (28 / maxScale) * 100; // 46.67%
    const targetWidth = ((32 - 28) / maxScale) * 100; // 6.67%
    const targetEnd = targetStart + targetWidth; // 53.33%

    let statusText = 'В норме (28–32%)';
    let textClass = 'text-emerald-300';
    let barColor = '#34d399';

    if (fcPercent < 28) {
      statusText = 'Выгодно (<28%)';
      textClass = 'text-emerald-400';
      barColor = '#10b981';
    } else if (fcPercent > 32 && fcPercent <= 38) {
      statusText = 'Выше цели (>32%)';
      textClass = 'text-amber-400';
      barColor = '#f59e0b';
    } else if (fcPercent > 38) {
      statusText = 'Высокий (>38%)';
      textClass = 'text-red-400';
      barColor = '#ef4444';
    }

    return (
      <div className="bg-stone-950 p-2.5 rounded-xl border border-stone-800/80 space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[10px]">
          <span className="text-stone-400 font-medium">Шкала фудкоста ({fcPercent}%)</span>
          <span className={`font-semibold ${textClass}`}>{statusText}</span>
        </div>
        <div
          role="progressbar"
          aria-valuenow={fcPercent}
          aria-valuemin={0}
          aria-valuemax={maxScale}
          aria-label={`Фудкост ${fcPercent}% при целевом диапазоне 28–32%`}
          className="w-full"
        >
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="w-full h-2.5 rounded-full overflow-hidden bg-stone-900 border border-stone-800 block">
            {/* Target range 28-32% */}
            <rect x={targetStart} y="0" width={targetWidth} height="10" fill="#10b981" fillOpacity="0.28" />
            {/* Actual foodcost bar */}
            <rect x="0" y="1" width={clampedPct} height="8" rx="4" fill={barColor} />
            {/* Target boundary markers 28% and 32% */}
            <line x1={targetStart} y1="0" x2={targetStart} y2="10" stroke="#34d399" strokeWidth="0.9" />
            <line x1={targetEnd} y1="0" x2={targetEnd} y2="10" stroke="#34d399" strokeWidth="0.9" />
          </svg>
        </div>
        <div className="flex items-center justify-between text-[9px] text-stone-500">
          <span>0%</span>
          <span className="text-emerald-400/90 font-medium">Цель: 28–32%</span>
          <span>60%+</span>
        </div>
      </div>
    );
  };

  const processChatFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    setChatAttachmentError(null);
    const maxBytes = 15 * 1024 * 1024;
    const textExtensions = ['.txt', '.csv', '.json', '.md', '.xml', '.tsv', '.html', '.htm', '.log'];
    const loaded: PendingChatAttachment[] = [];

    for (const file of files) {
      if (file.size > maxBytes) {
        setChatAttachmentError(`Файл "${file.name}" превышает лимит 15 МБ.`);
        continue;
      }

      const lowerName = file.name.toLowerCase();
      const isImage = file.type.startsWith('image/');
      const isPdf = file.type === 'application/pdf' || lowerName.endsWith('.pdf');
      const isTextDoc =
        file.type.startsWith('text/') ||
        file.type === 'application/json' ||
        file.type === 'application/xml' ||
        textExtensions.some(ext => lowerName.endsWith(ext));

      if (isTextDoc) {
        const textContent = await file.text();
        loaded.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType: file.type || 'text/plain',
          size: file.size,
          kind: 'document',
          textContent: textContent.slice(0, 120000),
        });
      } else if (isImage || isPdf) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
          reader.readAsDataURL(file);
        });
        const dataBase64 = dataUrl.split(',')[1] || '';
        loaded.push({
          id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          mimeType: isPdf ? 'application/pdf' : (file.type || 'image/jpeg'),
          size: file.size,
          kind: isImage ? 'image' : 'document',
          previewUrl: isImage ? dataUrl : undefined,
          dataBase64,
        });
      } else {
        setChatAttachmentError(
          `Формат файла "${file.name}" не поддерживается. Поддерживаются фото (JPG, PNG, WEBP) и документы (PDF, TXT, CSV, JSON, MD, XML).`
        );
      }
    }

    if (loaded.length > 0) {
      setPendingAttachments(prev => [...prev, ...loaded]);
    }
  };

  const handleChatFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await processChatFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleChatPaste = async (e: React.ClipboardEvent<HTMLInputElement>) => {
    const items = Array.from(e.clipboardData?.items || []);
    const pastedFiles = items
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((f): f is File => f !== null);
    if (pastedFiles.length > 0) {
      e.preventDefault();
      await processChatFiles(pastedFiles);
    }
  };

  // --- HELPER CALCULATIONS ---
  const findIngredientForItem = (item: RecipeItem): Ingredient | undefined => {
    if (item.ingredientId) {
      const byId = ingredients.find(i => i.id === item.ingredientId);
      if (byId) return byId;
    }
    const normalizedName = (item.name || '').trim().toLowerCase();
    if (!normalizedName) return undefined;
    return ingredients.find(i => i.name.trim().toLowerCase() === normalizedName);
  };

  const getRecipeItemName = (item: RecipeItem): string => {
    const manual = (item.name || '').trim();
    if (manual) return manual;
    return findIngredientForItem(item)?.name || 'Продукт';
  };

  const getRecipeItemUnit = (item: RecipeItem): RecipeItemUnit => {
    if (item.unit) {
      return normalizeUnit(item.unit, findIngredientForItem(item)?.unit || 'кг');
    }
    return normalizeUnit(findIngredientForItem(item)?.unit, 'кг');
  };

  const getRecipeItemQty = (item: RecipeItem): number => {
    if (typeof item.quantity === 'number') return item.quantity;
    if (typeof item.netQty === 'number') return item.netQty;
    if (typeof item.grossQty === 'number') return item.grossQty;
    return 0;
  };

  const formatWeightNumber = (qty: number): string => {
    const rounded = Math.round((qty + Number.EPSILON) * 1000) / 1000;
    return Number.isFinite(rounded) ? String(rounded) : '0';
  };

  const convertUnitQty = (qty: number, fromUnit: RecipeItemUnit, toUnit: Ingredient['unit']): number | null => {
    const from = normalizeUnit(fromUnit);
    const to = normalizeUnit(toUnit);
    if (from === to) return qty;
    if (from === 'гр' && to === 'кг') return qty / 1000;
    if (from === 'кг' && to === 'гр') return qty * 1000;
    if (from === 'мл' && to === 'л') return qty / 1000;
    if (from === 'л' && to === 'мл') return qty * 1000;
    return null;
  };

  const calculateRecipeItemCost = (item: RecipeItem): number | null => {
    const ing = findIngredientForItem(item);
    if (!ing) return null;
    const converted = convertUnitQty(getRecipeItemQty(item), getRecipeItemUnit(item), ing.unit);
    if (converted === null) return null;
    return ing.costPerUnit * converted;
  };

  const calculateItemsTotalWeightKg = (items: RecipeItem[]): number => {
    let totalKg = 0;
    for (const item of items) {
      const qty = getRecipeItemQty(item);
      if (qty <= 0) continue;
      const unit = getRecipeItemUnit(item);
      if (unit === 'кг' || unit === 'л') totalKg += qty;
      else if (unit === 'гр' || unit === 'мл') totalKg += qty / 1000;
    }
    return Math.round((totalKg + Number.EPSILON) * 1000) / 1000;
  };

  const toEditableItems = (items: RecipeItem[]): EditableRecipeItem[] =>
    items.map(it => {
      const qty = getRecipeItemQty(it);
      return {
        ...it,
        name: getRecipeItemName(it),
        quantity: qty,
        unit: getRecipeItemUnit(it),
        quantityInput: qty > 0 ? String(qty) : '',
      };
    });

  const calculateRecipeBatchCost = (recipe: Recipe) => {
    let totalCost = 0;
    recipe.items.forEach(item => {
      const itemCost = calculateRecipeItemCost(item);
      if (itemCost !== null) {
        totalCost += itemCost;
      }
    });
    return totalCost;
  };

  const calculateRecipeCost = (recipe: Recipe) => {
    const batchCost = calculateRecipeBatchCost(recipe);
    const yieldKg = recipe.yieldQty && recipe.yieldQty > 0 ? recipe.yieldQty : 1;
    return batchCost / yieldKg; // стоимость на 1 кг выхода
  };

  const getRecipeFoodCostPercent = (recipe: Recipe) => {
    const cost = calculateRecipeCost(recipe);
    if (!recipe.sellingPrice || recipe.sellingPrice === 0) return 0;
    return Math.round((cost / recipe.sellingPrice) * 100);
  };

  const totalExpensesMonth = expenses.reduce((sum, e) => sum + e.amount, 0);
  const lowStockCount = ingredients.filter(i => i.stockQty <= i.minStock).length;

  // Handle AI Chat with mandatory long term memory injected into context
  const handleSendAi = async (customPrompt?: string) => {
    const textToSend = customPrompt || aiInput;
    const attachmentsToSend = customPrompt ? [] : pendingAttachments;
    if ((!textToSend.trim() && attachmentsToSend.length === 0) || aiLoading) return;

    const userMsg = textToSend.trim();
    const displayMsg =
      userMsg ||
      (attachmentsToSend.length === 1
        ? `Прикреплен файл: ${attachmentsToSend[0].name}`
        : `Прикреплено файлов: ${attachmentsToSend.length}`);

    if (!customPrompt) {
      setAiInput('');
      setPendingAttachments([]);
      setChatAttachmentError(null);
    }

    const messageAttachments: ChatAttachmentMeta[] = attachmentsToSend.map(att => ({
      id: att.id,
      name: att.name,
      mimeType: att.mimeType,
      size: att.size,
      kind: att.kind,
      previewUrl: att.previewUrl,
    }));

    const newChat: ChatMessage[] = [
      ...aiChat,
      {
        role: 'user',
        text: displayMsg,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        attachments: messageAttachments.length > 0 ? messageAttachments : undefined,
      },
    ];
    setAiChat(newChat);
    setAiLoading(true);

    try {
      const context = {
        storeName: 'САЛАТиКо (Домашняя кухня каждый день)',
        mandatoryLongTermMemory: aiMemoryNotes,
        standardBasis: 'Все граммовки в ТТК рассчитаны на 1 кг готовой продукции',
        ingredientsCount: ingredients.length,
        recipesCount: recipes.length,
        recipesList: recipes.map(r => ({ name: r.name, category: r.category, costPerKg: calculateRecipeCost(r), pricePerKg: r.sellingPrice })),
        weeklyMenuTotalDishes: weeklyMenuRows.filter(r => r.dishName.trim() !== '').length
      };

      if (aiMode === 'gemini') {
        const data = await fetchApiJson<{ result?: string; error?: string }>('/api/gemini/advisor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: userMsg || 'Проанализируй прикрепленные файлы с учетом контекста магазина.',
            context,
            attachments: attachmentsToSend.map(att => ({
              name: att.name,
              mimeType: att.mimeType,
              dataBase64: att.dataBase64,
              textContent: att.textContent,
            })),
          }),
        });
        if (data.error) {
          setAiChat(prev => [...prev, { role: 'assistant', text: `Ошибка Gemini: ${data.error}`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
        } else {
          setAiChat(prev => [...prev, { role: 'assistant', text: data.result || 'Пустой ответ от ИИ.', timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
        }
      } else {
        try {
          const textDocs = attachmentsToSend
            .filter(att => att.textContent)
            .map(att => `\n--- Файл: ${att.name} ---\n${att.textContent}`)
            .join('\n');
          const imageList = attachmentsToSend
            .filter(att => att.kind === 'image' && att.dataBase64)
            .map(att => att.dataBase64 as string);
          const hasUnsupportedBinary = attachmentsToSend.some(att => att.kind === 'document' && !att.textContent);

          const localPrompt = `[Долговременная память магазина (ТТК на 1 кг)]: ${aiMemoryNotes}${textDocs ? `\n${textDocs}` : ''}${hasUnsupportedBinary ? '\n[Примечание: прикреплен PDF-документ, для полного разбора PDF используйте Gemini Cloud.]' : ''}\n\nЗапрос: ${userMsg || 'Проанализируй прикрепленные материалы.'}`;

          const localRes = await fetch(localEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'llama3',
              prompt: localPrompt,
              ...(imageList.length > 0 ? { images: imageList } : {}),
              stream: false
            })
          });

          const localData = await localRes.json();
          const answer = localData.response || localData.text || JSON.stringify(localData);
          setAiChat(prev => [...prev, { role: 'assistant', text: `[Локальный ИИ с памятью]: ${answer}`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
        } catch (localErr: any) {
          setAiChat(prev => [...prev, { role: 'assistant', text: `Не удалось подключиться к локальной ИИ по адресу ${localEndpoint}. Ошибка: ${localErr.message}`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
        }
      }
    } catch (err: any) {
      setAiChat(prev => [...prev, { role: 'assistant', text: `Ошибка связи: ${err.message || 'неизвестная ошибка'}`, timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }]);
    } finally {
      setAiLoading(false);
    }
  };

  const prepareImageForUpload = (file: File): Promise<{ base64: string; mimeType: string }> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Не удалось прочитать файл изображения.'));
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const fallbackMime = file.type && file.type.startsWith('image/') ? file.type : 'image/jpeg';
        const fallbackBase64 = dataUrl.split(',')[1] || '';

        const img = new Image();
        img.onload = () => {
          const maxDim = 1600;
          const { width, height } = img;
          const needsResize = Math.max(width, height) > maxDim || file.size > 900 * 1024;
          if (!needsResize) {
            resolve({ base64: fallbackBase64, mimeType: fallbackMime });
            return;
          }
          const scale = Math.min(1, maxDim / Math.max(width, height));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ base64: fallbackBase64, mimeType: fallbackMime });
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressedUrl = canvas.toDataURL('image/jpeg', 0.88);
          resolve({
            base64: compressedUrl.split(',')[1] || fallbackBase64,
            mimeType: 'image/jpeg',
          });
        };
        img.onerror = () => resolve({ base64: fallbackBase64, mimeType: fallbackMime });
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });

  // Handle parse recipe from photo/screenshot
  const handleFileUploadForRecipe = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsParsingPhoto(true);
    try {
      const { base64: base64String, mimeType } = await prepareImageForUpload(file);

      const data = await fetchApiJson<{ recipe?: any; error?: string }>('/api/gemini/parse-recipe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64String, mimeType })
      });
      if (data.error) {
        showNotice('error', `Ошибка распознавания: ${data.error}`);
      } else if (data.recipe) {
        const parsed = data.recipe;
        const rawItemsList = Array.isArray(parsed.items)
          ? parsed.items
          : Array.isArray(parsed.ingredients)
            ? parsed.ingredients
            : [];

        const mapParsedUnit = (rawUnit: unknown): RecipeItemUnit => {
          const u = String(rawUnit || '').trim().toLowerCase().replace(/\.$/, '');
          if (u === 'кг' || u === 'kg') return 'кг';
          if (u === 'гр' || u === 'г' || u === 'g') return 'гр';
          if (u === 'шт') return 'шт';
          if (u === 'л' || u === 'l') return 'л';
          if (u === 'мл' || u === 'ml') return 'мл';
          if (u.startsWith('бан') || u === 'б') return 'банка';
          return normalizeUnit(rawUnit, 'гр');
        };

        const parsedItems: RecipeItem[] = rawItemsList
          .map((rawIt: any): RecipeItem | null => {
            if (typeof rawIt === 'string') {
              const rows = parseBulkRecipeLines(rawIt);
              if (rows.length === 0) return null;
              const r = rows[0];
              return {
                ...(r.ingredientId ? { ingredientId: r.ingredientId } : {}),
                name: r.name,
                quantity: r.quantity,
                unit: r.unit,
              };
            }
            const name = String(rawIt?.name || rawIt?.product || rawIt?.ingredient || '').trim();
            if (!name) return null;
            const rawQty = rawIt?.quantity ?? rawIt?.qty ?? rawIt?.weight ?? rawIt?.netQty ?? rawIt?.grossQty ?? 0;
            const qtyNum = typeof rawQty === 'number'
              ? rawQty
              : parseFloat(String(rawQty).replace(',', '.')) || 0;
            const unit = mapParsedUnit(rawIt?.unit);
            const matched = ingredients.find(
              ing => ing.name.trim().toLowerCase() === name.toLowerCase()
            );
            return {
              ...(matched ? { ingredientId: matched.id } : {}),
              name,
              quantity: Math.max(0, qtyNum),
              unit,
            };
          })
          .filter((item: RecipeItem | null): item is RecipeItem => item !== null);

        const parsedSteps = Array.isArray(parsed.steps)
          ? parsed.steps.map((s: any) => String(s || '').trim()).filter(Boolean)
          : [];

        const autoParsedWeightKg = calculateItemsTotalWeightKg(parsedItems);
        const parsedYieldRaw = Number(parsed.yieldQty);
        const finalParsedYield =
          Number.isFinite(parsedYieldRaw) && parsedYieldRaw > 0
            ? Math.round((parsedYieldRaw + Number.EPSILON) * 1000) / 1000
            : autoParsedWeightKg > 0
              ? autoParsedWeightKg
              : 1;

        const newRecipe: Recipe = {
          id: `rec-${Date.now()}`,
          name: String(parsed.name || '').trim() || 'Блюдо по фото',
          category: normalizeCategory(parsed.category || 'Горячие блюда'),
          yieldQty: finalParsedYield,
          yieldUnit: 'кг',
          prepTimeMin: Number(parsed.prepTimeMin) || 40,
          sellingPrice: Number(parsed.sellingPrice) || 600,
          shelfLifeHours: Number(parsed.shelfLifeHours) || 48,
          items: parsedItems,
          steps: parsedSteps.length > 0
            ? parsedSteps
            : ['1. Подготовить ингредиенты.', '2. Приготовить согласно техпроцессу.']
        };

        setRecipes(prev => [newRecipe, ...prev]);
        recordTtkProducts(parsedItems);
        setExpandedTtkCategories(prev => ({ ...prev, [newRecipe.category]: true }));
        setIsPhotoModalOpen(false);
        openRecipeModal(newRecipe, true);
        if (parsedItems.length > 0) {
          showNotice('success', `Распознана ТТК «${newRecipe.name}» (${parsedItems.length} поз.) — проверьте и нажмите «Сохранить ТТК»!`);
        } else {
          showNotice('success', `Блюдо «${newRecipe.name}» создано, но состав на фото не найден — введите или вставьте продукты списком.`);
        }
      }
    } catch (err: any) {
      showNotice('error', `Ошибка: ${err.message || 'не удалось распознать изображение'}`);
    } finally {
      setIsParsingPhoto(false);
    }
  };

  // Handle parse receipt items from photo/invoice
  const handleFileUploadForReceipt = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingReceipt(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64String = (reader.result as string).split(',')[1];
          const mimeType = file.type;

          const data = await fetchApiJson<{ items?: any[]; error?: string }>('/api/gemini/parse-receipt-items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64String, mimeType })
          });
          if (data.error) {
            showNotice('error', `Ошибка распознавания чека: ${data.error}`);
          } else if (data.items && Array.isArray(data.items)) {
            const parsedItems = data.items;
            let addedCount = 0;
            let updatedCount = 0;

            const updatedIngredients = [...ingredients];

            parsedItems.forEach((pi: any) => {
              const existingIndex = updatedIngredients.findIndex(
                ing => ing.name.toLowerCase().includes((pi.name || '').toLowerCase()) || 
                       (pi.name || '').toLowerCase().includes(ing.name.toLowerCase())
              );

              if (existingIndex >= 0) {
                updatedIngredients[existingIndex] = {
                  ...updatedIngredients[existingIndex],
                  costPerUnit: pi.costPerUnit || updatedIngredients[existingIndex].costPerUnit,
                  stockQty: updatedIngredients[existingIndex].stockQty + (pi.stockQty || 1),
                  supplier: pi.supplier || updatedIngredients[existingIndex].supplier
                };
                updatedCount++;
              } else {
                updatedIngredients.push({
                  id: `ing-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                  name: pi.name || 'Товар из чека',
                  unit: normalizeUnit(pi.unit, 'кг'),
                  costPerUnit: pi.costPerUnit || 100,
                  stockQty: pi.stockQty || 1,
                  minStock: 5,
                  supplier: pi.supplier || 'Поставщик по чеку'
                });
                addedCount++;
              }
            });

            setIngredients(updatedIngredients);
            setIsReceiptModalOpen(false);
            showNotice('success', `Чек обработан: новых ${addedCount}, обновлено ${updatedCount}.`);
          }
        } catch (innerErr: any) {
          showNotice('error', `Ошибка: ${innerErr.message || 'не удалось обработать чек'}`);
        } finally {
          setIsParsingReceipt(false);
        }
      };
      reader.onerror = () => {
        showNotice('error', 'Не удалось прочитать файл чека.');
        setIsParsingReceipt(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      showNotice('error', `Ошибка: ${err.message}`);
      setIsParsingReceipt(false);
    }
  };

  return (
    <div className={`${activeTab === 'ai' ? 'h-[100dvh] overflow-hidden' : 'min-h-screen'} bg-stone-950 text-stone-100 flex flex-col font-sans selection:bg-amber-500 selection:text-stone-950`}>
      
      {/* HEADER BAR */}
      <header className="bg-stone-900 border-b border-stone-800 sticky top-0 z-30 px-4 py-2.5 sm:py-3 flex items-center justify-between shadow-md shrink-0">
        <div className="flex items-center space-x-2.5 sm:space-x-3 min-w-0">
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl overflow-hidden bg-white shadow-lg border border-stone-700/70 shrink-0">
            <img
              src="/assets/aistudio/file_00000000f5dc822f85a82f2582820461_31c1506b.jpg"
              alt="САЛАТиКо"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="min-w-0">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-white flex items-center gap-2">
              САЛАТиКо <span className="text-[10px] sm:text-xs uppercase px-1.5 sm:px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-md font-semibold border border-emerald-500/30">PRO</span>
            </h1>
            <p className="hidden sm:block text-xs text-stone-400 truncate">Домашняя кухня каждый день • ТТК, меню, склад и ИИ</p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <PWAInstallButton />
          {lowStockCount > 0 && (
            <button 
              onClick={() => setActiveTab('inventory')}
              className="flex items-center space-x-1.5 bg-red-950/80 border border-red-800/60 text-red-300 px-2.5 py-1.5 rounded-lg text-xs font-medium"
            >
              <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
              <span>Остаток: {lowStockCount}</span>
            </button>
          )}
          <div className="hidden sm:flex items-center space-x-2 bg-stone-800 px-3 py-1.5 rounded-lg border border-stone-700 text-xs text-stone-300">
            <span className={`w-2 h-2 rounded-full ${aiMode === 'gemini' ? 'bg-emerald-500' : 'bg-blue-500'} inline-block`}></span>
            <span>ИИ: <strong>{aiMode === 'gemini' ? 'Gemini Cloud' : 'Локальный'}</strong></span>
          </div>
        </div>
      </header>

      <OfflineIndicator />

      {/* NON-BLOCKING IN-APP NOTIFICATION TOAST */}
      {appNotice && (
        <div className="fixed top-16 right-4 left-4 sm:left-auto sm:max-w-md z-50">
          <div
            role="status"
            className={`rounded-2xl px-4 py-3 border shadow-2xl flex items-center justify-between gap-3 text-xs sm:text-sm ${
              appNotice.type === 'success'
                ? 'bg-emerald-950/95 border-emerald-700/70 text-emerald-100'
                : 'bg-red-950/95 border-red-700/70 text-red-100'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {appNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
              )}
              <span className="break-words">{appNotice.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setAppNotice(null)}
              className="text-stone-400 hover:text-white shrink-0"
              aria-label="Закрыть уведомление"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* MAIN CONTENT AREA */}
      <main className={activeTab === 'ai' ? 'flex-1 min-h-0 max-w-7xl w-full mx-auto p-2.5 sm:p-6 flex flex-col' : 'flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 pb-24'}>
        
        {/* TAB 1: DASHBOARD (CLEAN & UNCLUTTERED) */}
        {activeTab === 'dashboard' && (() => {
          const todayDay = DAYS_OF_WEEK[(new Date().getDay() + 6) % 7];
          const todayMenuItems = weeklyMenuRows.filter(r => r.day === todayDay && r.dishName.trim() !== '');
          const totalWeeklyDishes = weeklyMenuRows.filter(r => r.dishName.trim() !== '').length;
          const totalTodayKg = todayMenuItems.reduce((sum, r) => sum + (r.weightKg || 0), 0);
          const netProfit = monthlyRevenue - totalExpensesMonth;

          return (
            <div className="space-y-4 sm:space-y-6">
              {/* Top Quick Actions */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg sm:text-xl font-bold text-white">Обзор магазина</h2>
                  <p className="text-xs text-stone-400">Сегодня: {todayDay} • Быстрый доступ к основным задачам</p>
                </div>
                <div className="grid grid-cols-3 sm:flex gap-2">
                  <button
                    onClick={() => setIsReceiptModalOpen(true)}
                    className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-3 py-2.5 sm:py-2 rounded-xl font-semibold text-xs transition flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/15"
                  >
                    <Receipt className="w-4 h-4 shrink-0" />
                    <span className="truncate">Чек (ИИ)</span>
                  </button>
                  <button
                    onClick={() => setIsPhotoModalOpen(true)}
                    className="bg-stone-900 hover:bg-stone-800 text-stone-200 border border-stone-700 px-3 py-2.5 sm:py-2 rounded-xl font-semibold text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <Camera className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate">ТТК по фото</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('ai')}
                    className="bg-stone-900 hover:bg-stone-800 text-stone-200 border border-stone-700 px-3 py-2.5 sm:py-2 rounded-xl font-semibold text-xs transition flex items-center justify-center gap-1.5"
                  >
                    <Bot className="w-4 h-4 text-amber-400 shrink-0" />
                    <span className="truncate">Шеф-ИИ</span>
                  </button>
                </div>
              </div>

              {/* Compact 2x2 Clickable KPI Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                <button
                  onClick={() => {
                    setSelectedDay(todayDay);
                    setActiveTab('weeklyMenu');
                  }}
                  className="text-left bg-stone-900/90 hover:bg-stone-900 border border-stone-800 hover:border-amber-500/40 rounded-2xl p-3.5 sm:p-4 transition"
                >
                  <div className="flex items-center justify-between text-stone-400 mb-1.5">
                    <span className="text-[11px] font-medium">Меню недели</span>
                    <Calendar className="w-4 h-4 text-amber-400 shrink-0" />
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-white">{totalWeeklyDishes} блюд</div>
                  <div className="text-[11px] text-stone-400 mt-0.5">Сегодня: {totalTodayKg.toFixed(1)} кг</div>
                </button>

                <button
                  onClick={() => setActiveTab('recipes')}
                  className="text-left bg-stone-900/90 hover:bg-stone-900 border border-stone-800 hover:border-emerald-500/40 rounded-2xl p-3.5 sm:p-4 transition"
                >
                  <div className="flex items-center justify-between text-stone-400 mb-1.5">
                    <span className="text-[11px] font-medium">База ТТК</span>
                    <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-white">{recipes.length} карт</div>
                  <div className="text-[11px] text-emerald-400 mt-0.5">Расчет на 1 кг</div>
                </button>

                <button
                  onClick={() => setActiveTab('inventory')}
                  className="text-left bg-stone-900/90 hover:bg-stone-900 border border-stone-800 hover:border-blue-500/40 rounded-2xl p-3.5 sm:p-4 transition"
                >
                  <div className="flex items-center justify-between text-stone-400 mb-1.5">
                    <span className="text-[11px] font-medium">Склад</span>
                    <Package className="w-4 h-4 text-blue-400 shrink-0" />
                  </div>
                  <div className="text-lg sm:text-2xl font-bold text-white">{ingredients.length} поз.</div>
                  <div className={`text-[11px] mt-0.5 ${lowStockCount > 0 ? 'text-red-400 font-medium' : 'text-stone-400'}`}>
                    {lowStockCount > 0 ? `Мало: ${lowStockCount} поз.` : 'Остатки в норме'}
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('finances')}
                  className="text-left bg-stone-900/90 hover:bg-stone-900 border border-stone-800 hover:border-purple-500/40 rounded-2xl p-3.5 sm:p-4 transition"
                >
                  <div className="flex items-center justify-between text-stone-400 mb-1.5">
                    <span className="text-[11px] font-medium">Прибыль / мес</span>
                    <TrendingUp className="w-4 h-4 text-purple-400 shrink-0" />
                  </div>
                  <div className={`text-lg sm:text-2xl font-bold ${netProfit >= 0 ? 'text-white' : 'text-red-400'}`}>
                    {netProfit.toLocaleString()} ₽
                  </div>
                  <div className="text-[11px] text-stone-400 mt-0.5">Расходы: {totalExpensesMonth.toLocaleString()} ₽</div>
                </button>
              </div>

              {/* Actionable Low Stock Alert (only when needed) */}
              {lowStockCount > 0 && (
                <button
                  onClick={() => setActiveTab('inventory')}
                  className="w-full text-left bg-red-950/35 hover:bg-red-950/50 border border-red-900/50 rounded-2xl px-4 py-3 flex items-center justify-between gap-3 transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                    <span className="text-xs sm:text-sm text-red-200 truncate">
                      Заканчивается <strong className="text-red-300">{lowStockCount}</strong> позиций на складе — пора пополнить запасы
                    </span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-red-400 shrink-0" />
                </button>
              )}

              {/* Today's Menu & Compact AI Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
                <div className="lg:col-span-2 bg-stone-900 border border-stone-800 rounded-2xl p-4 sm:p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-white text-sm sm:text-base flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-amber-500" />
                      <span>План на сегодня ({todayDay})</span>
                    </h3>
                    <button
                      onClick={() => {
                        setSelectedDay(todayDay);
                        setActiveTab('weeklyMenu');
                      }}
                      className="text-xs text-amber-400 hover:underline flex items-center gap-0.5"
                    >
                      <span>Всё меню</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {todayMenuItems.length > 0 ? (
                    <div className="divide-y divide-stone-800/80">
                      {todayMenuItems.slice(0, 6).map(item => (
                        <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xs font-mono text-stone-500 w-5 shrink-0">{item.slotNumber}.</span>
                            <span className="text-sm text-stone-100 truncate">{item.dishName}</span>
                          </div>
                          <span className="text-xs font-semibold text-amber-400 shrink-0 tabular-nums">
                            {item.weightKg || 0} кг
                          </span>
                        </div>
                      ))}
                      {todayMenuItems.length > 6 && (
                        <button
                          onClick={() => {
                            setSelectedDay(todayDay);
                            setActiveTab('weeklyMenu');
                          }}
                          className="pt-2.5 w-full text-center text-xs text-stone-400 hover:text-amber-400 transition"
                        >
                          Показать еще {todayMenuItems.length - 6} блюд...
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="py-6 text-center space-y-2">
                      <p className="text-xs text-stone-400">На {todayDay.toLowerCase()} блюда ещё не выбраны.</p>
                      <button
                        onClick={() => {
                          setSelectedDay(todayDay);
                          setActiveTab('weeklyMenu');
                        }}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 hover:text-amber-300 bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-xl"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Заполнить меню</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Compact Chef-AI Card */}
                <div className="bg-stone-900 border border-stone-800 rounded-2xl p-4 sm:p-5 flex flex-col justify-between gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-amber-500/15 text-amber-400 rounded-xl">
                          <Bot className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="font-semibold text-white text-sm">Шеф-ИИ</h3>
                          <p className="text-[11px] text-stone-400">
                            {aiMode === 'gemini' ? 'Gemini Cloud' : 'Локальный ИИ'} • память активна
                          </p>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-stone-400 leading-relaxed">
                      Поможет рассчитать себестоимость, разобрать фото накладной, PDF-документ или обновить ТТК на 1 кг.
                    </p>
                  </div>

                  <button
                    onClick={() => setActiveTab('ai')}
                    className="w-full bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold py-2.5 rounded-xl text-xs transition flex items-center justify-center gap-2 shadow-md shadow-amber-500/15"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Открыть чат с ИИ</span>
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* TAB 2: WEEKLY MENU */}
        {activeTab === 'weeklyMenu' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-amber-500" />
                  Недельное меню (20 строк)
                </h2>
                <p className="text-xs text-stone-400 mt-0.5">Нажмите на любую строку, чтобы выбрать категорию и нужное блюдо или найти по названию</p>
              </div>
              <button 
                onClick={() => {
                  const updated = weeklyMenuRows.map(row => {
                    if (row.day === selectedDay && !row.dishName && recipes.length > 0) {
                      const sampleRecipe = recipes[Math.floor(Math.random() * recipes.length)];
                      return { 
                        ...row, 
                        dishName: sampleRecipe.name, 
                        category: sampleRecipe.category, 
                        weightKg: 3.0
                      };
                    }
                    return row;
                  });
                  setWeeklyMenuRows(updated);
                }}
                className="bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-500/30 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Заполнить день блюдами из ТТК</span>
              </button>
            </div>

            {/* Day Selector Tabs */}
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
              {DAYS_OF_WEEK.map(day => {
                const count = weeklyMenuRows.filter(r => r.day === day && r.dishName.trim() !== '').length;
                const isSelected = selectedDay === day;
                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDay(day)}
                    className={`px-4 py-3 rounded-xl font-semibold text-xs transition whitespace-nowrap flex items-center gap-2 border ${
                      isSelected 
                        ? 'bg-amber-500 text-stone-950 border-amber-400 shadow-lg shadow-amber-500/20' 
                        : 'bg-stone-900 text-stone-300 border-stone-800 hover:bg-stone-800'
                    }`}
                  >
                    <span>{day}</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      isSelected ? 'bg-stone-950 text-amber-400' : 'bg-stone-800 text-stone-400'
                    }`}>
                      {count}/20
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search Dish by Name in Weekly Menu */}
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={weeklyMenuSearchQuery}
                onChange={e => setWeeklyMenuSearchQuery(e.target.value)}
                placeholder="Поиск блюда в меню на этот день по названию..."
                className="w-full bg-stone-900 border border-stone-800 rounded-xl pl-10 pr-9 py-2.5 text-xs text-stone-100 outline-none focus:border-amber-500 transition"
              />
              {weeklyMenuSearchQuery && (
                <button
                  onClick={() => setWeeklyMenuSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-white"
                  title="Очистить поиск"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* 20 Rows Table: Dish Name (full length) + Weight (kg) */}
            <div className="bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 bg-stone-950 border-b border-stone-800 flex flex-col sm:flex-row justify-between sm:items-center gap-1">
                <h3 className="font-bold text-white text-base flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                  Меню: {selectedDay} (20 строк)
                </h3>
                <span className="text-xs text-stone-400">Нажмите на строку → выберите категорию → выберите блюдо</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-stone-950/80 text-stone-400 uppercase tracking-wider border-b border-stone-800">
                    <tr>
                      <th className="p-3 w-12 text-center">№</th>
                      <th className="p-3 w-full min-w-[260px] sm:min-w-[480px]">Название блюда</th>
                      <th className="p-3 w-36 text-center whitespace-nowrap">Вес (кг)</th>
                      <th className="p-3 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800 text-stone-200">
                    {weeklyMenuRows
                      .filter(r => r.day === selectedDay)
                      .filter(r => !weeklyMenuSearchQuery.trim() || r.dishName.toLowerCase().includes(weeklyMenuSearchQuery.toLowerCase()))
                      .sort((a, b) => a.slotNumber - b.slotNumber)
                      .map(row => (
                        <tr
                          key={row.id}
                          onClick={() => {
                            setActiveMenuRowId(row.id);
                            setPickerCategory(null);
                            setPickerSearchQuery('');
                          }}
                          className="hover:bg-stone-800/50 transition cursor-pointer group"
                        >
                          <td className="p-3 text-center font-mono text-stone-400 align-middle">{row.slotNumber}</td>
                          <td className="p-3 align-middle">
                            <div className="w-full min-w-[240px] sm:min-w-[460px] bg-stone-950/80 group-hover:border-amber-500/50 border border-stone-800 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3 transition">
                              <span className={`text-sm leading-snug whitespace-normal break-words ${row.dishName ? 'text-stone-100 font-medium' : 'text-stone-500 italic'}`}>
                                {row.dishName || 'Нажмите на строку, чтобы выбрать категорию и блюдо...'}
                              </span>
                              <ChevronRight className="w-4 h-4 text-stone-500 group-hover:text-amber-400 flex-shrink-0 transition" />
                            </div>
                          </td>
                          <td className="p-3 text-center align-middle" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1.5">
                              <input
                                type="number"
                                step="0.1"
                                min="0"
                                value={row.weightKg || ''}
                                placeholder="0"
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setWeeklyMenuRows(prev => prev.map(item => item.id === row.id ? { ...item, weightKg: val } : item));
                                }}
                                className="w-20 bg-stone-950 border border-stone-700/80 rounded-xl px-2.5 py-2 text-amber-400 font-bold text-sm text-center outline-none focus:border-amber-500"
                              />
                              <span className="text-stone-400 text-xs font-medium">кг</span>
                            </div>
                          </td>
                          <td className="p-3 text-center align-middle" onClick={e => e.stopPropagation()}>
                            {row.dishName && (
                              <button
                                onClick={() => {
                                  setWeeklyMenuRows(prev => prev.map(item => item.id === row.id ? { ...item, dishName: '', category: 'Горячие блюда', weightKg: 0 } : item));
                                }}
                                className="text-stone-500 hover:text-red-400 transition p-1.5 rounded-lg hover:bg-stone-800"
                                title="Очистить строку"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: RECIPES / TTK (ON 1 KG BASIS) */}
        {activeTab === 'recipes' && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-stone-900 p-5 rounded-2xl border border-stone-800 shadow-sm">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-amber-500" />
                  Технологические карты (ТТК) — Журнал рецептур
                </h2>
                <p className="text-xs text-stone-400 mt-0.5">Стандартный производственный журнал ТТК (расчет на 1 кг базы с раскладкой ингредиентов)</p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="bg-stone-950 p-1 rounded-xl border border-stone-800 flex">
                  <button
                    onClick={() => setRecipeViewMode('sheet')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${recipeViewMode === 'sheet' ? 'bg-amber-500 text-stone-950 shadow-sm' : 'text-stone-400 hover:text-white'}`}
                  >
                    <span>📋 Таблица ТТК</span>
                  </button>
                  <button
                    onClick={() => setRecipeViewMode('cards')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${recipeViewMode === 'cards' ? 'bg-amber-500 text-stone-950 shadow-sm' : 'text-stone-400 hover:text-white'}`}
                  >
                    <span>🃏 Карточки</span>
                  </button>
                </div>
                <button 
                  onClick={() => {
                    setIsBulkMenuModalOpen(true);
                  }}
                  className="bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2"
                >
                  <ListPlus className="w-4 h-4" />
                  <span>Импорт списка меню</span>
                </button>
                <button 
                  onClick={() => setIsPhotoModalOpen(true)}
                  className="bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-500/30 px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  <span>По фото</span>
                </button>
                <button 
                  onClick={() => openNewRecipeEditor()}
                  className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Создать ТТК</span>
                </button>
              </div>
            </div>

            {/* Search bar, Tag filter & Expand/Collapse controls for TTK */}
            <div className="space-y-2.5">
              <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={recipeSearchQuery}
                    onChange={e => setRecipeSearchQuery(e.target.value)}
                    placeholder="Поиск блюда в ТТК по названию или тегу..."
                    className="w-full bg-stone-900 border border-stone-800 rounded-xl pl-10 pr-9 py-2.5 text-xs text-stone-100 outline-none focus:border-amber-500 transition"
                  />
                  {recipeSearchQuery && (
                    <button
                      onClick={() => setRecipeSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-white"
                      title="Очистить поиск"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {!recipeSearchQuery.trim() && !recipeTagFilter && !recipeOnlyDraftsFilter && (
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const allOpen: Record<string, boolean> = {};
                        RECIPE_CATEGORIES.forEach(c => {
                          allOpen[c] = true;
                        });
                        setExpandedTtkCategories(allOpen);
                      }}
                      className="flex-1 sm:flex-initial bg-stone-900 hover:bg-stone-800 text-stone-300 border border-stone-800 px-3 py-2 rounded-xl text-xs font-medium transition"
                    >
                      Развернуть все
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedTtkCategories({})}
                      className="flex-1 sm:flex-initial bg-stone-900 hover:bg-stone-800 text-stone-400 hover:text-stone-200 border border-stone-800 px-3 py-2 rounded-xl text-xs font-medium transition"
                    >
                      Свернуть все
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-stone-400 flex items-center gap-1 mr-1">
                  <Tag className="w-3.5 h-3.5 text-amber-500" />
                  Теги:
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setRecipeTagFilter('');
                    setRecipeOnlyDraftsFilter(false);
                  }}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                    recipeTagFilter === '' && !recipeOnlyDraftsFilter
                      ? 'bg-amber-500 text-stone-950 border-amber-400 font-semibold'
                      : 'bg-stone-900 text-stone-300 border-stone-800 hover:border-stone-700'
                  }`}
                >
                  Все ({recipes.length})
                </button>
                {RECIPE_TAGS.map(tag => {
                  const isActive = recipeTagFilter === tag;
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setRecipeTagFilter(isActive ? '' : tag)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ${
                        isActive
                          ? getRecipeTagBadgeClass(tag) + ' ring-1 ring-white/20 font-semibold'
                          : 'bg-stone-900 text-stone-300 border-stone-800 hover:border-stone-700'
                      }`}
                    >
                      {tag}
                    </button>
                  );
                })}
                {(() => {
                  const draftsCount = recipes.filter(r => r.items.length === 0).length;
                  if (draftsCount === 0 && !recipeOnlyDraftsFilter) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => setRecipeOnlyDraftsFilter(prev => !prev)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition ml-auto ${
                        recipeOnlyDraftsFilter
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 font-semibold'
                          : 'bg-stone-900 text-amber-400/90 border-stone-800 hover:border-amber-500/30'
                      }`}
                    >
                      Без состава ({draftsCount})
                    </button>
                  );
                })()}
              </div>
            </div>

            {/* COLLAPSIBLE CATEGORY SECTIONS (GROUPS) */}
            {(() => {
              const query = recipeSearchQuery.trim().toLowerCase();
              const matchesFilters = (r: Recipe) => {
                const tags = normalizeRecipeTags(r.tags);
                const matchesTag = !recipeTagFilter || tags.includes(recipeTagFilter);
                const matchesDrafts = !recipeOnlyDraftsFilter || r.items.length === 0;
                const matchesQuery =
                  !query ||
                  r.name.toLowerCase().includes(query) ||
                  tags.some(t => t.includes(query));
                return matchesTag && matchesDrafts && matchesQuery;
              };
              const isFiltering = Boolean(query || recipeTagFilter || recipeOnlyDraftsFilter);
              const categoriesToRender = RECIPE_CATEGORIES.filter(cat => {
                if (!isFiltering) return true;
                return recipes.some(r => r.category === cat && matchesFilters(r));
              });

              if (categoriesToRender.length === 0) {
                return (
                  <div className="bg-stone-900 border border-stone-800 rounded-2xl p-8 text-center text-xs text-stone-400">
                    {recipeOnlyDraftsFilter
                      ? 'Все блюда уже имеют заполненный состав продуктов.'
                      : recipeTagFilter
                        ? `Блюда с тегом «${recipeTagFilter}»${query ? ` по запросу «${recipeSearchQuery}»` : ''} не найдены.`
                        : `По запросу «${recipeSearchQuery}» в базе ТТК ничего не найдено.`}
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {categoriesToRender.map(cat => {
                    const catRecipes = recipes.filter(
                      r => r.category === cat && matchesFilters(r)
                    );
                    const isExpanded = isFiltering ? true : Boolean(expandedTtkCategories[cat]);

                    return (
                      <div key={cat} className="bg-stone-900/60 border border-stone-800 rounded-2xl overflow-hidden shadow-sm">
                        {/* Collapsible Group Header */}
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTtkCategories(prev => ({
                              ...prev,
                              [cat]: !prev[cat],
                            }))
                          }
                          aria-expanded={isExpanded}
                          className="w-full flex items-center justify-between gap-3 bg-stone-950/90 hover:bg-stone-900 px-4 sm:px-5 py-3.5 text-left transition"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {isExpanded ? (
                              <ChevronDown className="w-4 h-4 text-amber-400 shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-stone-400 shrink-0" />
                            )}
                            <span
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                catRecipes.length > 0 ? 'bg-amber-500 shadow-sm shadow-amber-500/50' : 'bg-stone-600'
                              }`}
                            ></span>
                            <h3 className="text-white font-bold text-sm tracking-wide truncate">{cat}</h3>
                          </div>
                          <span
                            className={`text-xs font-mono shrink-0 px-2.5 py-1 rounded-lg border ${
                              catRecipes.length > 0
                                ? 'bg-stone-900 border-stone-700 text-amber-400'
                                : 'bg-stone-900/60 border-stone-800 text-stone-500'
                            }`}
                          >
                            {catRecipes.length} ТТК
                          </span>
                        </button>

                        {/* Expanded Content */}
                        {isExpanded && (
                          <div className="p-3 sm:p-4 border-t border-stone-800">
                            {catRecipes.length === 0 ? (
                              <div className="py-6 text-center space-y-2.5">
                                <p className="text-xs text-stone-400">В категории «{cat}» пока нет технологических карт.</p>
                                <button
                                  type="button"
                                  onClick={() => openNewRecipeEditor(cat)}
                                  className="inline-flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 px-3.5 py-2 rounded-xl text-xs font-semibold transition"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Добавить ТТК в «{cat}»</span>
                                </button>
                              </div>
                            ) : recipeViewMode === 'sheet' ? (
                              <div className="space-y-4">
                                {catRecipes.map(recipe => {
                                  const cost = calculateRecipeCost(recipe);
                                  const fc = getRecipeFoodCostPercent(recipe);
                                  return (
                                    <div key={recipe.id} className="bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden shadow-sm">
                                      <div className="overflow-x-auto">
                                        <table className="w-full text-left text-xs border-collapse">
                                          <thead className="bg-stone-950/80 text-stone-400 uppercase tracking-wider border-b border-stone-800">
                                            <tr>
                                              <th className="p-3.5 border-r border-stone-800 w-1/4">Блюдо / ТТК</th>
                                              <th className="p-3.5 border-r border-stone-800 w-2/5">
                                                Раскладка продуктов (выход {formatWeightNumber(recipe.yieldQty || 1)} {recipe.yieldUnit})
                                              </th>
                                              <th className="p-3.5 border-r border-stone-800 w-1/5">Вес</th>
                                              <th className="p-3.5 text-center w-36">Действия</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-stone-800 text-stone-200">
                                            <tr className="align-top">
                                              <td className="p-4 border-r border-stone-800 bg-stone-950/40">
                                                <div className="font-bold text-white text-base mb-1.5">{recipe.name}</div>
                                                <div className="mb-2.5 flex flex-wrap gap-1.5">
                                                  <span className="text-[11px] px-2.5 py-0.5 bg-amber-500/10 text-amber-400 rounded-md border border-amber-500/20 font-semibold inline-block">
                                                    {recipe.category}
                                                  </span>
                                                  <span className="text-[11px] px-2 py-0.5 bg-stone-800 text-stone-200 rounded-md border border-stone-700 font-mono inline-block">
                                                    Выход: {formatWeightNumber(recipe.yieldQty || 1)} {recipe.yieldUnit}
                                                  </span>
                                                  {normalizeRecipeTags(recipe.tags).map(tag => (
                                                    <span
                                                      key={tag}
                                                      className={`text-[10px] px-2 py-0.5 rounded-md border font-medium inline-block ${getRecipeTagBadgeClass(tag)}`}
                                                    >
                                                      #{tag}
                                                    </span>
                                                  ))}
                                                </div>
                                                <div className="text-[11px] text-stone-400 space-y-1 bg-stone-900 p-2.5 rounded-xl border border-stone-800 mb-2">
                                                  <div>Себест/кг: <strong className="text-stone-200">{Math.round(cost)} ₽</strong></div>
                                                  {(recipe.yieldQty || 1) !== 1 && (
                                                    <div>За закладку ({formatWeightNumber(recipe.yieldQty)} кг): <strong className="text-stone-300">{Math.round(calculateRecipeBatchCost(recipe))} ₽</strong></div>
                                                  )}
                                                  <div>Цена/кг: <strong className="text-amber-400">{recipe.sellingPrice} ₽</strong></div>
                                                  <div>Фудкост: <strong className={fc > 32 ? 'text-red-400' : 'text-emerald-400'}>{fc}%</strong></div>
                                                </div>
                                                {renderFoodCostProgressBar(fc)}
                                              </td>
                                              <td className="p-0 border-r border-stone-800">
                                                <table className="w-full text-xs">
                                                  <tbody className="divide-y divide-stone-800/60">
                                                    {recipe.items.length === 0 ? (
                                                      <tr>
                                                        <td className="p-3.5 text-amber-400/90 italic">
                                                          Состав ещё не заполнен — нажмите «Заполнить / Изменить»
                                                        </td>
                                                      </tr>
                                                    ) : (
                                                      recipe.items.map((it, idx) => (
                                                        <tr key={idx} className="hover:bg-stone-800/20">
                                                          <td className="p-3.5 text-stone-200 font-medium">{getRecipeItemName(it)}</td>
                                                        </tr>
                                                      ))
                                                    )}
                                                  </tbody>
                                                </table>
                                              </td>
                                              <td className="p-0 border-r border-stone-800">
                                                <table className="w-full text-xs">
                                                  <tbody className="divide-y divide-stone-800/60">
                                                    {recipe.items.length === 0 ? (
                                                      <tr>
                                                        <td className="p-3.5 text-stone-500 font-mono">—</td>
                                                      </tr>
                                                    ) : (
                                                      recipe.items.map((it, idx) => (
                                                        <tr key={idx} className="hover:bg-stone-800/20">
                                                          <td className="p-3.5 text-stone-300 font-mono">
                                                            <span className="text-amber-400 font-semibold">{formatWeightNumber(getRecipeItemQty(it))}</span> {getRecipeItemUnit(it)}
                                                          </td>
                                                        </tr>
                                                      ))
                                                    )}
                                                  </tbody>
                                                </table>
                                              </td>
                                              <td className="p-4 text-center align-middle">
                                                <div className="flex flex-col gap-2 items-center justify-center">
                                                  <button
                                                    onClick={() => openRecipeModal(recipe, false)}
                                                    className="w-full bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-semibold transition text-center shadow-sm"
                                                  >
                                                    Открыть ТТК
                                                  </button>
                                                  <button
                                                    onClick={() => openRecipeModal(recipe, true)}
                                                    className="w-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm"
                                                  >
                                                    <Edit3 className="w-3.5 h-3.5" />
                                                    <span>Заполнить / Изменить</span>
                                                  </button>
                                                  <button
                                                    onClick={() => handleDuplicateRecipe(recipe)}
                                                    className="w-full bg-stone-800 hover:bg-stone-700 text-stone-300 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm"
                                                  >
                                                    <Copy className="w-3.5 h-3.5" />
                                                    <span>Копия</span>
                                                  </button>
                                                  <button
                                                    onClick={() => {
                                                      setActiveTab('ai');
                                                      handleSendAi(`Проанализируй ТТК "${recipe.name}" (расчет на 1 кг): себестоимость ${Math.round(cost)} руб, цена продажи ${recipe.sellingPrice} руб (фудкост ${fc}%). Дай рекомендации.`);
                                                    }}
                                                    className="w-full bg-stone-800 hover:bg-stone-700 text-amber-400 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm"
                                                  >
                                                    <Sparkles className="w-3.5 h-3.5" />
                                                    <span>ИИ Анализ</span>
                                                  </button>
                                                  <button
                                                    onClick={() => setRecipeToDelete(recipe)}
                                                    className="w-full bg-red-950/40 hover:bg-red-950/70 text-red-400 border border-red-900/40 px-3 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 shadow-sm"
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                    <span>Удалить</span>
                                                  </button>
                                                </div>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {catRecipes.map(recipe => {
                                  const cost = calculateRecipeCost(recipe);
                                  const fcPercent = getRecipeFoodCostPercent(recipe);

                                  return (
                                    <div key={recipe.id} className="bg-stone-900 border border-stone-800 hover:border-stone-700 rounded-2xl overflow-hidden flex flex-col justify-between transition shadow-sm">
                                      <div className="p-5 pb-0 flex items-center justify-between gap-2">
                                        <span className="text-[11px] font-semibold px-2.5 py-0.5 bg-amber-500/10 text-amber-400 rounded-md border border-amber-500/20">
                                          {recipe.category}
                                        </span>
                                        <span className={`text-[11px] font-mono ${recipe.items.length === 0 ? 'text-amber-400' : 'text-stone-400'}`}>
                                          {recipe.items.length === 0 ? 'Без состава' : `${recipe.items.length} прод.`}
                                        </span>
                                      </div>

                                      <div className="p-5">
                                        <h3 className="font-bold text-white text-base mb-2">{recipe.name}</h3>
                                        {normalizeRecipeTags(recipe.tags).length > 0 && (
                                          <div className="flex flex-wrap gap-1.5 mb-2.5">
                                            {normalizeRecipeTags(recipe.tags).map(tag => (
                                              <span
                                                key={tag}
                                                className={`text-[10px] px-2 py-0.5 rounded-md border font-medium ${getRecipeTagBadgeClass(tag)}`}
                                              >
                                                #{tag}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                        <div className="text-xs text-stone-400 space-y-1 mb-4">
                                          <div>Выход ТТК: <strong className="text-amber-400">{formatWeightNumber(recipe.yieldQty || 1)} {recipe.yieldUnit}</strong></div>
                                          <div>Время приготовления: <strong>{recipe.prepTimeMin} мин</strong></div>
                                          <div>Срок годности: <strong>{recipe.shelfLifeHours} ч</strong></div>
                                        </div>

                                        <div className="pt-4 border-t border-stone-800 space-y-3">
                                          <div className="grid grid-cols-3 gap-2 text-center bg-stone-950 p-2.5 rounded-xl border border-stone-800/80">
                                            <div>
                                              <div className="text-[10px] text-stone-400 uppercase">Себест. / 1 кг</div>
                                              <div className="text-xs font-bold text-stone-200">{Math.round(cost)} ₽</div>
                                            </div>
                                            <div>
                                              <div className="text-[10px] text-stone-400 uppercase">Цена / 1 кг</div>
                                              <div className="text-xs font-bold text-amber-400">{recipe.sellingPrice} ₽</div>
                                            </div>
                                            <div>
                                              <div className="text-[10px] text-stone-400 uppercase">Фудкост</div>
                                              <div className={`text-xs font-bold ${fcPercent > 32 ? (fcPercent > 38 ? 'text-red-400' : 'text-amber-400') : 'text-emerald-400'}`}>
                                                {fcPercent}%
                                              </div>
                                            </div>
                                          </div>

                                          {renderFoodCostProgressBar(fcPercent)}

                                          <div className="flex gap-2">
                                            <button 
                                              onClick={() => openRecipeModal(recipe, false)}
                                              className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-200 py-2 rounded-xl text-xs font-semibold transition text-center"
                                            >
                                              Открыть
                                            </button>
                                            <button 
                                              onClick={() => openRecipeModal(recipe, true)}
                                              className="bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2.5 py-2 rounded-xl transition"
                                              title="Редактировать ТТК"
                                            >
                                              <Edit3 className="w-4 h-4" />
                                            </button>
                                            <button 
                                              onClick={() => handleDuplicateRecipe(recipe)}
                                              className="bg-stone-800 hover:bg-stone-700 text-stone-300 px-2.5 py-2 rounded-xl transition"
                                              title="Дублировать ТТК"
                                            >
                                              <Copy className="w-4 h-4" />
                                            </button>
                                            <button 
                                              onClick={() => {
                                                setActiveTab('ai');
                                                handleSendAi(`Проанализируй ТТК "${recipe.name}" (расчет на 1 кг): себестоимость ${Math.round(cost)} руб, цена продажи ${recipe.sellingPrice} руб (фудкост ${fcPercent}%). Дай рекомендации.`);
                                              }}
                                              className="bg-stone-800 hover:bg-stone-700 text-amber-400 p-2 rounded-xl transition"
                                              title="Анализ рецепта с ИИ"
                                            >
                                              <Sparkles className="w-4 h-4" />
                                            </button>
                                            <button 
                                              onClick={() => setRecipeToDelete(recipe)}
                                              className="bg-red-950/40 hover:bg-red-950/70 text-red-400 border border-red-900/40 p-2 rounded-xl transition"
                                              title="Удалить блюдо из ТТК"
                                              aria-label={`Удалить ${recipe.name}`}
                                            >
                                              <Trash2 className="w-4 h-4" />
                                            </button>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {/* TAB 4: INVENTORY */}
        {activeTab === 'inventory' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Package className="w-5 h-5 text-amber-500" />
                  Склад и Ингредиенты (Регулировка цен и остатков)
                </h2>
                <p className="text-xs text-stone-400 mt-0.5">Редактируйте цены и остатки товаров прямо в таблице или загружайте чеки через ИИ</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsReceiptModalOpen(true)}
                  className="bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-500/30 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2"
                >
                  <Receipt className="w-4 h-4" />
                  <span>Загрузить по чеку (ИИ)</span>
                </button>
                <button 
                  onClick={() => setIsNewIngredientModalOpen(true)}
                  className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Добавить товар</span>
                </button>
              </div>
            </div>

            {/* Editable Ingredients Table */}
            <div className="bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-950 text-stone-400 uppercase tracking-wider border-b border-stone-800">
                    <tr>
                      <th className="p-4">Наименование</th>
                      <th className="p-4 w-24">Ед. изм.</th>
                      <th className="p-4 w-36">Цена за ед. (₽)</th>
                      <th className="p-4 w-36">Остаток</th>
                      <th className="p-4 w-28">Мин. ост.</th>
                      <th className="p-4">Поставщик</th>
                      <th className="p-4 text-right w-28">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800 text-stone-200">
                    {ingredients.map(ing => {
                      const isLow = ing.stockQty <= ing.minStock;
                      return (
                        <tr key={ing.id} className="hover:bg-stone-800/40 transition">
                          <td className="p-4 font-medium text-white">{ing.name}</td>
                          <td className="p-4 text-stone-400">{ing.unit}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="1"
                                value={ing.costPerUnit}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setIngredients(prev => prev.map(item => item.id === ing.id ? { ...item, costPerUnit: val } : item));
                                }}
                                className="w-24 bg-stone-950 border border-stone-700 rounded-lg px-2.5 py-1.5 text-amber-400 font-bold outline-none focus:border-amber-500"
                              />
                              <span className="text-stone-400">₽</span>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                step="0.1"
                                value={ing.stockQty}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  setIngredients(prev => prev.map(item => item.id === ing.id ? { ...item, stockQty: val } : item));
                                }}
                                className={`w-24 bg-stone-950 border rounded-lg px-2.5 py-1.5 font-bold outline-none ${
                                  isLow ? 'border-red-600 text-red-400' : 'border-stone-700 text-stone-100'
                                }`}
                              />
                              <span className="text-stone-400">{ing.unit}</span>
                            </div>
                          </td>
                          <td className="p-4 text-stone-400">{ing.minStock} {ing.unit}</td>
                          <td className="p-4 text-stone-300">{ing.supplier}</td>
                          <td className="p-4 text-right">
                            <button
                              onClick={() => {
                                setIngredients(prev => prev.filter(item => item.id !== ing.id));
                              }}
                              className="text-stone-500 hover:text-red-400 p-1.5 rounded-lg transition"
                              title="Удалить товар"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: FINANCES */}
        {activeTab === 'finances' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-amber-500" />
                  Финансы и P&L Аналитика
                </h2>
                <p className="text-xs text-stone-400 mt-0.5">Ручной ввод, учет расходов и загрузка данных со скриншотов отчетов через ИИ</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => setIsFinanceModalOpen(true)}
                  className="bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-500/30 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2"
                >
                  <Receipt className="w-4 h-4" />
                  <span>Загрузить по скриншоту (ИИ)</span>
                </button>
                <button 
                  onClick={() => setIsNewExpenseModalOpen(true)}
                  className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Добавить расход</span>
                </button>
              </div>
            </div>

            {/* Financial Overview Cards with Manual Revenue Adjustment */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-1">Выручка за месяц (ручной ввод / ИИ)</div>
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="number"
                    step="1000"
                    value={monthlyRevenue}
                    onChange={e => setMonthlyRevenue(parseFloat(e.target.value) || 0)}
                    className="w-36 bg-stone-950 border border-stone-700 rounded-xl px-3 py-1.5 text-emerald-400 font-bold text-lg outline-none focus:border-amber-500"
                  />
                  <span className="text-emerald-400 font-bold">₽</span>
                </div>
                <div className="text-xs text-stone-400 mt-2">Регулируйте сумму выручки вручную или из скриншота</div>
              </div>
              <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-1">Расходы за месяц</div>
                <div className="text-2xl font-bold text-red-400 mt-1">{totalExpensesMonth.toLocaleString()} ₽</div>
                <div className="text-xs text-stone-400 mt-2">Аренда, закупки, ФОТ, прочее</div>
              </div>
              <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-1">Чистая прибыль (оценка)</div>
                <div className="text-2xl font-bold text-amber-400 mt-1">{(monthlyRevenue * 0.42 - totalExpensesMonth).toLocaleString()} ₽</div>
                <div className="text-xs text-stone-400 mt-2">Рентабельность ~28-40%</div>
              </div>
            </div>

            {/* Expenses List */}
            <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
              <h3 className="font-semibold text-white mb-4">Журнал расходов (Ручной ввод + Распознанные)</h3>
              <div className="space-y-3">
                {expenses.map(exp => (
                  <div key={exp.id} className="bg-stone-800/60 border border-stone-700/50 p-3.5 rounded-xl flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-stone-100 text-sm">{exp.category}</span>
                        <span className="text-xs text-stone-400">{exp.date}</span>
                      </div>
                      <p className="text-xs text-stone-300 mt-0.5">{exp.note}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="font-bold text-red-400 text-sm">-{exp.amount.toLocaleString()} ₽</div>
                      <button
                        onClick={() => setExpenses(prev => prev.filter(e => e.id !== exp.id))}
                        className="text-stone-500 hover:text-red-400 p-1 rounded transition"
                        title="Удалить расход"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5.5: WASTE & LOSSES LOG */}
        {activeTab === 'waste' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Журнал учета потерь и списаний (Акты проработки)
                </h2>
                <p className="text-xs text-stone-400 mt-0.5">Учет технологических потерь (чистка, уварка), брака и просрочки для точного расчета фудкоста</p>
              </div>
              <button 
                onClick={() => setIsNewWasteModalOpen(true)}
                className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
              >
                <Plus className="w-4 h-4" />
                <span>Добавить акт списания</span>
              </button>
            </div>

            {/* Waste Summary Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-1">Общие потери за месяц</div>
                <div className="text-2xl font-bold text-red-400">
                  {wasteRecords.reduce((sum, w) => sum + w.totalCost, 0).toLocaleString()} ₽
                </div>
                <div className="text-xs text-stone-400 mt-1">Влияние на фудкост: ~3.2%</div>
              </div>
              <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-1">Основной источник потерь</div>
                <div className="text-lg font-bold text-amber-400 mt-1">Холодная обработка (чистка)</div>
                <div className="text-xs text-stone-400 mt-1">Очистки овощей, обрезки мяса</div>
              </div>
              <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5">
                <div className="text-xs text-stone-400 uppercase tracking-wider mb-1">Всего актов списания</div>
                <div className="text-2xl font-bold text-stone-100 mt-1">{wasteRecords.length} шт.</div>
                <div className="text-xs text-stone-400 mt-1">Зарегистрировано в системе</div>
              </div>
            </div>

            {/* Waste Records Table */}
            <div className="bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 bg-stone-950 border-b border-stone-800 font-semibold text-white text-sm">
                Реестр актов потерь и списаний сырья
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-stone-950/60 text-stone-400 uppercase tracking-wider border-b border-stone-800">
                    <tr>
                      <th className="p-3.5">Дата</th>
                      <th className="p-3.5">Товар / Блюдо</th>
                      <th className="p-3.5">Количество</th>
                      <th className="p-3.5">Тип потерь</th>
                      <th className="p-3.5">Сумма (₽)</th>
                      <th className="p-3.5">Примечание</th>
                      <th className="p-3.5 text-right">Действие</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-800 text-stone-200">
                    {wasteRecords.map(w => (
                      <tr key={w.id} className="hover:bg-stone-800/40 transition">
                        <td className="p-3.5 text-stone-400">{w.date}</td>
                        <td className="p-3.5 font-medium text-white">{w.itemName}</td>
                        <td className="p-3.5 font-mono">{w.quantity} {w.unit}</td>
                        <td className="p-3.5">
                          <span className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded-lg text-[11px] font-semibold border border-amber-500/20">
                            {w.lossType}
                          </span>
                        </td>
                        <td className="p-3.5 font-bold text-red-400">-{w.totalCost} ₽</td>
                        <td className="p-3.5 text-stone-400">{w.note}</td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => setWasteRecords(prev => prev.filter(item => item.id !== w.id))}
                            className="text-stone-500 hover:text-red-400 p-1.5 rounded-lg transition"
                            title="Удалить запись"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: AI ADVISOR WITH MANDATORY LONG TERM MEMORY & LOCAL AI */}
        {activeTab === 'ai' && (
          <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
            
            {/* Left Col: AI Settings & Mandatory Long-Term Memory (collapsible toggle on mobile, always visible on desktop) */}
            <div className={`${showAiSettingsMobile ? 'flex' : 'hidden'} lg:flex flex-col justify-between bg-stone-900 border border-stone-800 rounded-2xl p-4 sm:p-5 space-y-4 min-h-0 overflow-y-auto`}>
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-stone-800">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-5 h-5 text-amber-500 shrink-0" />
                    <h3 className="font-bold text-white text-sm">Настройки ИИ и Долгая Память</h3>
                  </div>
                  <button
                    onClick={() => setShowAiSettingsMobile(false)}
                    className="lg:hidden flex items-center gap-1 bg-amber-500 text-stone-950 px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>В чат</span>
                  </button>
                </div>

                {/* Model Selector: Cloud vs Local */}
                <div>
                  <label className="block text-stone-400 text-xs mb-2">Модель / Режим ИИ</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setAiMode('gemini')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition flex items-center justify-center gap-1.5 ${
                        aiMode === 'gemini' 
                          ? 'bg-amber-500 text-stone-950 border-amber-500' 
                          : 'bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Gemini Cloud</span>
                    </button>
                    <button
                      onClick={() => setAiMode('local')}
                      className={`py-2.5 px-3 rounded-xl text-xs font-semibold border transition flex items-center justify-center gap-1.5 ${
                        aiMode === 'local' 
                          ? 'bg-blue-600 text-white border-blue-500' 
                          : 'bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-700'
                      }`}
                    >
                      <Database className="w-3.5 h-3.5" />
                      <span>Локальный ИИ</span>
                    </button>
                  </div>
                </div>

                {aiMode === 'gemini' && (
                  <div className="space-y-2">
                    <label className="block text-stone-400 text-xs">Адрес сервера API</label>
                    <input
                      type="url"
                      value={apiServerUrl}
                      onChange={e => setApiServerUrl(e.target.value)}
                      placeholder={DEFAULT_PUBLISHED_SERVER_URL}
                      className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-xs text-stone-200 outline-none focus:border-amber-500"
                    />
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        type="button"
                        onClick={() => {
                          const cleaned = normalizeServerUrl(apiServerUrl);
                          if (cleaned && !/^https?:\/\//i.test(cleaned)) {
                            showNotice('error', 'Укажите корректный URL (с http:// или https://) или оставьте поле пустым.');
                            return;
                          }
                          setApiServerUrl(cleaned);
                          saveApiBaseUrl(cleaned);
                          showNotice(
                            'success',
                            cleaned
                              ? `Адрес сервера API сохранён: ${cleaned}`
                              : 'Сохранён авто-режим (в APK используется Cloud Run).'
                          );
                        }}
                        className="text-[10px] bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 px-2.5 py-1 rounded-lg border border-emerald-500/30 font-semibold"
                      >
                        Сохранить адрес
                      </button>
                      <button
                        type="button"
                        disabled={isCheckingServer}
                        onClick={async () => {
                          setIsCheckingServer(true);
                          try {
                            const cleaned = normalizeServerUrl(apiServerUrl);
                            if (cleaned && !/^https?:\/\//i.test(cleaned)) {
                              showNotice('error', 'Укажите корректный URL (с http:// или https://).');
                              return;
                            }
                            const healthUrl = cleaned ? resolveApiUrl('/api/health', cleaned) : resolveApiUrl('/api/health');
                            const res = await fetch(healthUrl);
                            const info = await parseApiJsonResponse<{ status?: string; geminiConfigured?: boolean }>(res);
                            if (info.status === 'ok' && info.geminiConfigured) {
                              showNotice('success', 'Связь с сервером API установлена, Gemini подключён.');
                            } else if (info.status === 'ok') {
                              showNotice('error', 'Сервер доступен, но GEMINI_API_KEY на сервере не настроен.');
                            } else {
                              showNotice('error', 'Неожиданный ответ от /api/health.');
                            }
                          } catch (err: any) {
                            showNotice('error', err?.message || 'Не удалось связаться с сервером API.');
                          } finally {
                            setIsCheckingServer(false);
                          }
                        }}
                        className="text-[10px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 px-2.5 py-1 rounded-lg border border-amber-500/30 font-semibold disabled:opacity-50"
                      >
                        {isCheckingServer ? 'Проверка...' : 'Проверить связь'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setApiServerUrl(DEFAULT_PUBLISHED_SERVER_URL);
                          saveApiBaseUrl(DEFAULT_PUBLISHED_SERVER_URL);
                          showNotice('success', 'Установлен удалённый сервер Cloud Run по умолчанию.');
                        }}
                        className="text-[10px] bg-stone-800 hover:bg-stone-700 text-stone-300 px-2 py-1 rounded-lg border border-stone-700"
                      >
                        Cloud Run (APK)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setApiServerUrl('');
                          saveApiBaseUrl('');
                          showNotice('success', 'Включён авто-выбор сервера API.');
                        }}
                        className="text-[10px] bg-stone-800 hover:bg-stone-700 text-stone-300 px-2 py-1 rounded-lg border border-stone-700"
                      >
                        Авто
                      </button>
                    </div>
                    <p className="text-[10px] text-stone-500">
                      Для Android APK по умолчанию: {DEFAULT_PUBLISHED_SERVER_URL}
                    </p>
                  </div>
                )}

                {aiMode === 'local' && (
                  <div className="space-y-2">
                    <label className="block text-stone-400 text-xs mb-1">URL локального API (Ollama / Телефон / LM Studio)</label>
                    <input
                      type="text"
                      value={localEndpoint}
                      onChange={e => setLocalEndpoint(e.target.value)}
                      placeholder="http://localhost:11434/api/generate"
                      className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-xs text-stone-200 outline-none focus:border-blue-500"
                    />
                    <div className="flex gap-1.5 flex-wrap">
                      <button
                        onClick={() => setLocalEndpoint('http://localhost:11434/api/generate')}
                        className="text-[10px] bg-stone-800 hover:bg-stone-700 text-stone-300 px-2 py-1 rounded-lg border border-stone-700"
                      >
                        Ollama (Local)
                      </button>
                      <button
                        onClick={() => setLocalEndpoint('http://10.0.2.2:11434/api/generate')}
                        className="text-[10px] bg-stone-800 hover:bg-stone-700 text-stone-300 px-2 py-1 rounded-lg border border-stone-700"
                      >
                        Ollama (Android Emulator)
                      </button>
                    </div>
                    <p className="text-[10px] text-stone-500 mt-1">Поддерживает локальные модели, загруженные на телефон или ПК (Ollama, LM Studio).</p>
                  </div>
                )}

                {/* Mandatory Long Term Memory Notes */}
                <div>
                  <label className="block text-stone-400 text-xs mb-1">🔒 Долговременная память ИИ (Сохраняется навсегда)</label>
                  <textarea
                    rows={6}
                    value={aiMemoryNotes}
                    onChange={e => setAiMemoryNotes(e.target.value)}
                    className="w-full bg-stone-950 border border-stone-700 rounded-xl p-3 text-xs text-stone-200 outline-none focus:border-amber-500 leading-relaxed resize-y"
                    placeholder="Здесь хранится долговременная память магазина: рецепты на 1 кг, правила, ценовая политика..."
                  />
                  <p className="text-[10px] text-emerald-400 mt-1">✓ Память автоматически передается во все запросы ИИ во всех сессиях.</p>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={() => {
                    setAiChat([{
                      role: 'assistant',
                      text: 'Память диалога очищена. Долговременная память магазина сохранена.',
                      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    }]);
                    setShowAiSettingsMobile(false);
                  }}
                  className="w-full bg-stone-800 hover:bg-stone-700 text-stone-300 py-2.5 rounded-xl text-xs font-semibold transition"
                >
                  Очистить историю диалога
                </button>
                <button
                  onClick={() => setShowAiSettingsMobile(false)}
                  className="lg:hidden w-full bg-amber-500 hover:bg-amber-400 text-stone-950 py-2.5 rounded-xl text-xs font-bold transition"
                >
                  Готово — открыть чат с Шеф-ИИ
                </button>
              </div>
            </div>

            {/* Right 2 Cols: Chat Window */}
            <div
              onDragOver={e => {
                e.preventDefault();
                setIsDraggingChatFile(true);
              }}
              onDragLeave={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                  setIsDraggingChatFile(false);
                }
              }}
              onDrop={async e => {
                e.preventDefault();
                setIsDraggingChatFile(false);
                if (e.dataTransfer.files?.length) {
                  await processChatFiles(e.dataTransfer.files);
                }
              }}
              className={`${showAiSettingsMobile ? 'hidden lg:flex' : 'flex'} lg:col-span-2 flex-col h-full min-h-0 bg-stone-900 border ${isDraggingChatFile ? 'border-amber-400 ring-2 ring-amber-500/30' : 'border-stone-800'} rounded-2xl shadow-xl overflow-hidden relative transition`}
            >
              {isDraggingChatFile && (
                <div className="absolute inset-0 z-20 bg-stone-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center pointer-events-none">
                  <div className="bg-amber-500/20 border border-amber-500/40 text-amber-400 p-4 rounded-2xl mb-3">
                    <Upload className="w-8 h-8" />
                  </div>
                  <p className="text-sm font-bold text-white">Отпустите файлы, чтобы прикрепить к чату</p>
                  <p className="text-xs text-stone-400 mt-1">Фото (JPG, PNG, WEBP) и документы (PDF, TXT, CSV, JSON, MD)</p>
                </div>
              )}

              {/* Chat Header */}
              <div className="shrink-0 px-3.5 py-3 sm:p-4 bg-stone-950 border-b border-stone-800 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="bg-amber-500/20 text-amber-400 p-2 rounded-xl shrink-0">
                    <Bot className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-white text-sm truncate">Шеф-ИИ • Память активна</h3>
                    <p className="text-[11px] sm:text-xs text-stone-400 truncate flex items-center gap-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${aiMode === 'gemini' ? 'bg-emerald-500' : 'bg-blue-500'}`}></span>
                      <span className="truncate">{aiMode === 'gemini' ? 'Google Gemini Cloud' : `Локальный (${localEndpoint})`}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setShowAiSettingsMobile(true)}
                    className="lg:hidden flex items-center gap-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-2.5 py-2 rounded-xl text-xs font-medium transition"
                    title="Настройки ИИ и долговременная память"
                  >
                    <Settings className="w-4 h-4 text-amber-400" />
                    <span>Память / ИИ</span>
                  </button>
                  <button
                    onClick={() => {
                      setAiChat([{
                        role: 'assistant',
                        text: 'Память диалога очищена. Долговременная память магазина сохранена.',
                        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      }]);
                      setPendingAttachments([]);
                      setChatAttachmentError(null);
                    }}
                    className="p-2 bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 border border-stone-700 rounded-xl transition"
                    title="Очистить историю чата"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Chat messages */}
              <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4">
                {aiChat.map((msg, index) => (
                  <div key={index} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`max-w-[90%] sm:max-w-2xl rounded-2xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-sm leading-relaxed whitespace-pre-wrap break-words space-y-2 ${
                      msg.role === 'user' 
                        ? 'bg-amber-500 text-stone-950 font-medium rounded-br-none' 
                        : 'bg-stone-800 text-stone-200 border border-stone-700/80 rounded-bl-none shadow-sm'
                    }`}>
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {msg.attachments.map(att => (
                            att.kind === 'image' ? (
                              att.previewUrl ? (
                                <button
                                  key={att.id}
                                  type="button"
                                  onClick={() => setPreviewChatImage({ url: att.previewUrl!, name: att.name })}
                                  className="block rounded-xl overflow-hidden border border-black/15 hover:opacity-90 transition text-left"
                                >
                                  <img
                                    src={att.previewUrl}
                                    alt={att.name}
                                    className="max-h-44 max-w-[220px] object-cover"
                                  />
                                </button>
                              ) : (
                                <div
                                  key={att.id}
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs border ${
                                    msg.role === 'user'
                                      ? 'bg-amber-600/30 border-stone-950/20 text-stone-950'
                                      : 'bg-stone-900 border-stone-700 text-stone-200'
                                  }`}
                                >
                                  <ImageIcon className="w-4 h-4 shrink-0" />
                                  <span className="truncate max-w-[160px]">{att.name}</span>
                                </div>
                              )
                            ) : (
                              <div
                                key={att.id}
                                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs border ${
                                  msg.role === 'user'
                                    ? 'bg-amber-600/30 border-stone-950/20 text-stone-950'
                                    : 'bg-stone-900 border-stone-700 text-stone-200'
                                }`}
                              >
                                <FileText className="w-4 h-4 shrink-0" />
                                <div className="min-w-0">
                                  <div className="truncate max-w-[160px] font-semibold">{att.name}</div>
                                  <div className="text-[10px] opacity-75">{formatFileSize(att.size)}</div>
                                </div>
                              </div>
                            )
                          ))}
                        </div>
                      )}
                      <div>{msg.text}</div>
                    </div>
                    <span className="text-[10px] text-stone-500 mt-1 px-1">{msg.timestamp}</span>
                  </div>
                ))}
                {aiLoading && (
                  <div className="flex justify-start">
                    <div className="bg-stone-800 text-stone-300 px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-2xl rounded-bl-none text-xs sm:text-sm flex items-center gap-2 border border-stone-700">
                      <Loader2 className="w-4 h-4 animate-spin text-amber-500 shrink-0" />
                      <span>Шеф-ИИ думает с учетом долговременной памяти...</span>
                    </div>
                  </div>
                )}
                <div ref={aiMessagesEndRef} />
              </div>

              {/* Presets */}
              <div className="shrink-0 px-3 py-2 bg-stone-950/70 border-t border-stone-800 flex gap-2 overflow-x-auto">
                <button 
                  onClick={() => handleSendAi('Проанализируй ТТК на 1 кг по каждому блюду с точки зрения фудкоста.')}
                  disabled={aiLoading}
                  className="shrink-0 text-xs bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-300 px-3 py-1.5 rounded-xl whitespace-nowrap border border-stone-700 transition"
                >
                  📊 Анализ ТТК на 1 кг
                </button>
                <button 
                  onClick={() => handleSendAi('Какие горячие блюда и супы из нашей базы лучше продвигать на витрине в эти выходные?')}
                  disabled={aiLoading}
                  className="shrink-0 text-xs bg-stone-800 hover:bg-stone-700 disabled:opacity-50 text-stone-300 px-3 py-1.5 rounded-xl whitespace-nowrap border border-stone-700 transition"
                >
                  🍲 Идеи для витрины выходных
                </button>
              </div>

              {/* Pending Attachments & Validation Error */}
              {(pendingAttachments.length > 0 || chatAttachmentError) && (
                <div className="shrink-0 px-3 py-2 bg-stone-950/90 border-t border-stone-800 space-y-2">
                  {chatAttachmentError && (
                    <div className="flex items-center justify-between gap-2 text-xs text-red-300 bg-red-950/60 border border-red-800/60 px-3 py-1.5 rounded-xl">
                      <span>{chatAttachmentError}</span>
                      <button
                        type="button"
                        onClick={() => setChatAttachmentError(null)}
                        className="text-red-400 hover:text-red-200 shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                  {pendingAttachments.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-0.5">
                      {pendingAttachments.map(att => (
                        <div
                          key={att.id}
                          className="shrink-0 flex items-center gap-2 bg-stone-900 border border-stone-700 rounded-xl p-1.5 pr-2 max-w-[220px]"
                        >
                          {att.kind === 'image' && att.previewUrl ? (
                            <img
                              src={att.previewUrl}
                              alt={att.name}
                              className="w-9 h-9 rounded-lg object-cover shrink-0 border border-stone-700"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-lg bg-amber-500/15 text-amber-400 flex items-center justify-center shrink-0">
                              <FileText className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="text-xs text-stone-200 font-medium truncate">{att.name}</div>
                            <div className="text-[10px] text-stone-500">{formatFileSize(att.size)}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setPendingAttachments(prev => prev.filter(p => p.id !== att.id))}
                            aria-label={`Удалить ${att.name}`}
                            className="p-1 text-stone-400 hover:text-white rounded-lg hover:bg-stone-800 shrink-0"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Input bar */}
              <div className="shrink-0 p-2.5 sm:p-4 bg-stone-950 border-t border-stone-800 flex items-center gap-2">
                <input
                  ref={chatFileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.txt,.csv,.json,.md,.xml,.tsv"
                  onChange={handleChatFileSelect}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => chatFileInputRef.current?.click()}
                  disabled={aiLoading}
                  aria-label="Прикрепить фото или документ"
                  title="Прикрепить фото или документ (JPG, PNG, PDF, TXT, CSV)"
                  className="shrink-0 h-11 w-11 sm:w-auto sm:px-3.5 bg-stone-900 hover:bg-stone-800 disabled:opacity-50 text-stone-300 hover:text-amber-400 border border-stone-700 rounded-xl flex items-center justify-center gap-1.5 transition"
                >
                  <Paperclip className="w-4 h-4" />
                  <span className="hidden sm:inline text-xs font-medium">Файл</span>
                </button>
                <input
                  type="text"
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onPaste={handleChatPaste}
                  onKeyDown={e => e.key === 'Enter' && handleSendAi()}
                  placeholder="Вопрос или прикрепите фото / документ..."
                  className="min-w-0 flex-1 bg-stone-900 border border-stone-700 text-stone-100 rounded-xl px-3.5 py-2.5 sm:px-4 sm:py-3 text-base sm:text-sm outline-none focus:border-amber-500 transition"
                />
                <button
                  onClick={() => handleSendAi()}
                  disabled={aiLoading || (!aiInput.trim() && pendingAttachments.length === 0)}
                  aria-label="Отправить сообщение"
                  className="shrink-0 h-11 sm:h-auto sm:py-3 px-4 sm:px-5 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 rounded-xl font-semibold flex items-center justify-center transition shadow-lg shadow-amber-500/20"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>

          </div>
        )}

        {/* LIGHTBOX FOR CHAT ATTACHED IMAGE */}
        {previewChatImage && (
          <div
            onClick={() => setPreviewChatImage(null)}
            className="fixed inset-0 bg-stone-950/90 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          >
            <div
              onClick={e => e.stopPropagation()}
              className="relative max-w-3xl w-full bg-stone-900 border border-stone-800 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
                <span className="text-xs sm:text-sm font-medium text-stone-200 truncate">{previewChatImage.name}</span>
                <button
                  onClick={() => setPreviewChatImage(null)}
                  className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-3 flex items-center justify-center bg-stone-950 max-h-[80dvh] overflow-auto">
                <img src={previewChatImage.url} alt={previewChatImage.name} className="max-w-full max-h-[72dvh] object-contain rounded-lg" />
              </div>
            </div>
          </div>
        )}

      </main>

      {/* MOBILE BOTTOM NAVIGATION BAR */}
      <nav aria-label="Основная навигация" className="shrink-0 bg-stone-900 border-t border-stone-800 sticky bottom-0 z-30 px-1 sm:px-3 py-1.5 sm:py-2 flex justify-between sm:justify-around items-center gap-0.5 overflow-x-auto">
        {[
          { id: 'dashboard', label: 'Главная', icon: Store },
          { id: 'weeklyMenu', label: 'Меню', icon: Calendar },
          { id: 'recipes', label: 'ТТК 1 кг', icon: BookOpen },
          { id: 'inventory', label: 'Склад', icon: Package },
          { id: 'finances', label: 'Финансы', icon: TrendingUp },
          { id: 'waste', label: 'Списания', icon: AlertTriangle },
          { id: 'ai', label: 'Шеф ИИ', icon: Bot },
        ].map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex flex-col items-center py-1.5 px-2 sm:px-3 rounded-xl transition shrink-0 ${
                isActive ? 'text-amber-400 bg-amber-500/10' : 'text-stone-400 hover:text-stone-200'
              }`}
            >
              <Icon className="w-4 h-4 sm:w-5 sm:h-5 mb-0.5 sm:mb-1" />
              <span className="text-[10px] font-medium whitespace-nowrap">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* BULK MENU IMPORT MODAL */}
      {isBulkMenuModalOpen && (
        <div className="fixed inset-0 bg-stone-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="px-4 py-3.5 sm:px-5 sm:py-4 bg-stone-950 border-b border-stone-800 flex justify-between items-center gap-3">
              <div>
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <ListPlus className="w-5 h-5 text-emerald-400" />
                  <span>Массовый импорт меню в ТТК</span>
                </h3>
                <p className="text-[11px] text-stone-400 mt-0.5">
                  Вставьте список из Excel, 1С, кассы или заметок (формат: «Название Цена»). Категория и теги определятся автоматически.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsBulkMenuModalOpen(false)}
                className="text-stone-400 hover:text-white p-1.5 rounded-lg bg-stone-800"
                aria-label="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="font-semibold text-stone-200">
                    1. Вставьте список блюд и цен:
                  </label>
                  {bulkMenuRawText && (
                    <button
                      type="button"
                      onClick={() => handleBulkMenuTextChange('')}
                      className="text-[11px] text-stone-400 hover:text-white"
                    >
                      Очистить текст
                    </button>
                  )}
                </div>
                <textarea
                  rows={6}
                  value={bulkMenuRawText}
                  onChange={e => handleBulkMenuTextChange(e.target.value)}
                  placeholder={`Наименование Цена, руб.\nАдмирал 1 400,00\nАзия с говядиной 870,00\nБорщ 170,00\nЗапеканка постная картофельно-овощная 790,00\nМорс брусничный 99,00`}
                  className="w-full bg-stone-950 border border-stone-700 focus:border-emerald-500 rounded-xl p-3 text-stone-100 text-xs font-mono outline-none resize-y"
                />
              </div>

              {bulkMenuRows.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 bg-stone-950 p-3 rounded-xl border border-stone-800">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="px-2 py-1 rounded-md bg-stone-900 border border-stone-700 text-stone-200">
                        Распознано: <strong>{bulkMenuRows.length}</strong>
                      </span>
                      <span className="px-2 py-1 rounded-md bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
                        К импорту: <strong>{bulkMenuRows.filter(r => r.selected).length}</strong>
                      </span>
                      <span className="px-2 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        Новых: <strong>{bulkMenuRows.filter(r => r.selected && r.matchType === 'new').length}</strong>
                      </span>
                      {bulkMenuRows.some(r => r.matchType === 'existing') && (
                        <span className="px-2 py-1 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-300">
                          Совпадений с базой: <strong>{bulkMenuRows.filter(r => r.matchType === 'existing').length}</strong>
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setBulkMenuRows(prev =>
                            prev.map(r => ({ ...r, selected: r.matchType !== 'duplicate_in_list' }))
                          )
                        }
                        className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[11px]"
                      >
                        Выбрать все
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setBulkMenuRows(prev => prev.map(r => ({ ...r, selected: false })))
                        }
                        className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-400 text-[11px]"
                      >
                        Снять все
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setBulkMenuRows(prev =>
                            prev.map(r =>
                              r.sellingPrice <= 0 || /^(тест|пакет)$/i.test(r.name.trim())
                                ? { ...r, selected: false }
                                : r
                            )
                          )
                        }
                        className="px-2.5 py-1 rounded-lg bg-stone-800 hover:bg-stone-700 text-amber-300 text-[11px]"
                      >
                        Убрать 0 ₽ / тест
                      </button>
                    </div>
                  </div>

                  {bulkMenuRows.some(r => r.matchType === 'existing') && (
                    <label className="flex items-center gap-2 text-xs text-stone-300 bg-stone-950/70 px-3 py-2 rounded-xl border border-stone-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={bulkMenuUpdateExisting}
                        onChange={e => setBulkMenuUpdateExisting(e.target.checked)}
                        className="accent-amber-500"
                      />
                      <span>
                        Для уже существующих ТТК — обновить цену продажи из прайса (сохраняя текущий состав и шаги)
                      </span>
                    </label>
                  )}

                  <div className="border border-stone-800 rounded-xl overflow-hidden bg-stone-950 max-h-[38vh] overflow-y-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-stone-900 text-stone-400 text-[10px] uppercase sticky top-0 z-10 border-b border-stone-800">
                        <tr>
                          <th className="p-2.5 w-8 text-center">✓</th>
                          <th className="p-2.5">Название блюда</th>
                          <th className="p-2.5 w-36">Категория</th>
                          <th className="p-2.5 w-24">Цена (₽)</th>
                          <th className="p-2.5 w-28 text-right">Статус</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-800/70">
                        {bulkMenuRows.map((row, idx) => (
                          <tr
                            key={row.id}
                            className={row.selected ? 'bg-stone-950 hover:bg-stone-900/60' : 'bg-stone-950/30 opacity-50'}
                          >
                            <td className="p-2 text-center">
                              <input
                                type="checkbox"
                                checked={row.selected}
                                onChange={e =>
                                  setBulkMenuRows(prev =>
                                    prev.map((r, i) => (i === idx ? { ...r, selected: e.target.checked } : r))
                                  )
                                }
                                className="accent-emerald-500"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text"
                                value={row.name}
                                onChange={e =>
                                  setBulkMenuRows(prev =>
                                    prev.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r))
                                  )
                                }
                                className="w-full bg-stone-900 border border-stone-800 focus:border-amber-500 rounded-lg px-2 py-1 text-xs text-stone-100 outline-none"
                              />
                              {row.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {row.tags.map(t => (
                                    <span key={t} className={`text-[9px] px-1.5 py-0.5 rounded border ${getRecipeTagBadgeClass(t)}`}>
                                      #{t}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td className="p-2">
                              <select
                                value={row.category}
                                onChange={e =>
                                  setBulkMenuRows(prev =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, category: e.target.value as RecipeCategory } : r
                                    )
                                  )
                                }
                                className="w-full bg-stone-900 border border-stone-800 focus:border-amber-500 rounded-lg px-1.5 py-1 text-[11px] text-stone-200 outline-none"
                              >
                                {RECIPE_CATEGORIES.map(cat => (
                                  <option key={cat} value={cat}>{cat}</option>
                                ))}
                              </select>
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                min="0"
                                step="1"
                                value={row.sellingPrice}
                                onChange={e =>
                                  setBulkMenuRows(prev =>
                                    prev.map((r, i) =>
                                      i === idx ? { ...r, sellingPrice: parseFloat(e.target.value) || 0 } : r
                                    )
                                  )
                                }
                                className="w-full bg-stone-900 border border-stone-800 focus:border-amber-500 rounded-lg px-2 py-1 text-xs text-amber-400 font-semibold text-right outline-none"
                              />
                            </td>
                            <td className="p-2 text-right whitespace-nowrap">
                              {row.matchType === 'duplicate_in_list' ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-stone-800 text-stone-400 border border-stone-700">
                                  Дубль
                                </span>
                              ) : row.matchType === 'existing' ? (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-300 border border-sky-500/30">
                                  Уже в ТТК
                                </span>
                              ) : (
                                <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                                  Новое
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-stone-950 border-t border-stone-800 flex flex-wrap justify-between items-center gap-2">
              <span className="text-[11px] text-stone-400">
                После импорта состав каждой ТТК можно заполнить вручную, списком или через ИИ.
              </span>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setIsBulkMenuModalOpen(false)}
                  className="bg-stone-800 hover:bg-stone-700 text-stone-300 px-4 py-2 rounded-xl text-xs font-semibold transition"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  disabled={bulkMenuRows.filter(r => r.selected).length === 0}
                  onClick={handleImportBulkMenu}
                  className="bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-stone-950 px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Импортировать в ТТК ({bulkMenuRows.filter(r => r.selected).length})</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PHOTO PARSE MODAL */}
      {isPhotoModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Camera className="w-5 h-5 text-amber-500" />
                Добавление рецепта по фото / скриншоту
              </h3>
              <button onClick={() => setIsPhotoModalOpen(false)} className="text-stone-400 hover:text-white">✕</button>
            </div>
            <p className="text-xs text-stone-300 leading-relaxed">
              Загрузите скриншот ТТК, фото страницы рецепта из книги или снимок блюда. ИИ (Gemini Vision) распознает название, категорию, состав продуктов с весом и шаги приготовления (на 1 кг).
            </p>

            <div className="border-2 border-dashed border-stone-700 hover:border-amber-500/50 rounded-2xl p-6 text-center transition bg-stone-950 relative">
              {isParsingPhoto ? (
                <div className="flex flex-col items-center justify-center py-6 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                  <span className="text-xs text-stone-300">ИИ распознает рецепт с изображения...</span>
                </div>
              ) : (
                <label className="cursor-pointer flex flex-col items-center justify-center space-y-2">
                  <Upload className="w-8 h-8 text-amber-500" />
                  <span className="text-xs font-semibold text-stone-200">Нажмите для выбора файла фото/скриншота</span>
                  <span className="text-[10px] text-stone-500">PNG, JPG, WEBP до 10МБ</span>
                  <input type="file" accept="image/*" onChange={handleFileUploadForRecipe} className="hidden" />
                </label>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button 
                onClick={() => setIsPhotoModalOpen(false)} 
                className="bg-stone-800 text-stone-300 px-4 py-2 rounded-xl text-xs"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT PARSE MODAL */}
      {isReceiptModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-500" />
                Загрузка товаров по чеку / накладной
              </h3>
              <button onClick={() => setIsReceiptModalOpen(false)} className="text-stone-400 hover:text-white">✕</button>
            </div>
            <p className="text-xs text-stone-300 leading-relaxed">
              Загрузите фото чека или товарной накладной от поставщика. ИИ (Gemini Vision) автоматически распознает наименования, цены, количество и обновит остатки на складе.
            </p>

            <div className="border-2 border-dashed border-stone-700 hover:border-amber-500/50 rounded-2xl p-6 text-center transition bg-stone-950 relative">
              {isParsingReceipt ? (
                <div className="flex flex-col items-center justify-center py-6 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                  <span className="text-xs text-stone-300">ИИ распознает чек и обновляет склад...</span>
                </div>
              ) : (
                <label className="cursor-pointer flex flex-col items-center justify-center space-y-2">
                  <Upload className="w-8 h-8 text-amber-500" />
                  <span className="text-xs font-semibold text-stone-200">Нажмите для выбора фото чека / накладной</span>
                  <span className="text-[10px] text-stone-500">PNG, JPG, WEBP до 10МБ</span>
                  <input type="file" accept="image/*" onChange={handleFileUploadForReceipt} className="hidden" />
                </label>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button 
                onClick={() => setIsReceiptModalOpen(false)} 
                className="bg-stone-800 text-stone-300 px-4 py-2 rounded-xl text-xs"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* FINANCE REPORT PARSE MODAL */}
      {isFinanceModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Receipt className="w-5 h-5 text-amber-500" />
                Загрузка финансов по скриншоту / отчету
              </h3>
              <button onClick={() => setIsFinanceModalOpen(false)} className="text-stone-400 hover:text-white">✕</button>
            </div>
            <p className="text-xs text-stone-300 leading-relaxed">
              Загрузите скриншот финансового отчета, выписки или таблицы. ИИ (Gemini Vision) распознает выручку и расходы, автоматически добавив их в журнал.
            </p>

            <div className="border-2 border-dashed border-stone-700 hover:border-amber-500/50 rounded-2xl p-6 text-center transition bg-stone-950 relative">
              {isParsingFinance ? (
                <div className="flex flex-col items-center justify-center py-6 space-y-2">
                  <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                  <span className="text-xs text-stone-300">ИИ анализирует финансовый отчет...</span>
                </div>
              ) : (
                <label className="cursor-pointer flex flex-col items-center justify-center space-y-2">
                  <Upload className="w-8 h-8 text-amber-500" />
                  <span className="text-xs font-semibold text-stone-200">Нажмите для выбора файла скриншота</span>
                  <span className="text-[10px] text-stone-500">PNG, JPG, WEBP до 10МБ</span>
                  <input type="file" accept="image/*" onChange={handleFileUploadForFinances} className="hidden" />
                </label>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button 
                onClick={() => setIsFinanceModalOpen(false)} 
                className="bg-stone-800 text-stone-300 px-4 py-2 rounded-xl text-xs"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {/* UNIFIED TTK VIEW / CREATE / EDIT MODAL (NO PHOTOS, FAST INPUT) */}
      {selectedRecipe && (() => {
        const cleanDraftItems: RecipeItem[] = editableRecipeItems
          .filter(it => {
            const parsedQty = parseFloat((it.quantityInput || '').replace(',', '.')) || 0;
            return it.name.trim() !== '' || parsedQty > 0;
          })
          .map(it => {
            const parsedQty = Math.max(0, parseFloat((it.quantityInput || '').replace(',', '.')) || 0);
            const trimmedName = it.name.trim() || 'Продукт';
            const matched = ingredients.find(
              ing => ing.name.trim().toLowerCase() === trimmedName.toLowerCase()
            );
            return {
              ...(matched ? { ingredientId: matched.id } : {}),
              name: trimmedName,
              quantity: parsedQty,
              unit: it.unit,
            };
          });

        const autoSumWeightKg = calculateItemsTotalWeightKg(cleanDraftItems);
        const parsedManualYieldRaw = parseFloat(draftYieldInput.replace(',', '.'));
        const effectiveEditYield = isCustomYieldManual
          ? (Number.isFinite(parsedManualYieldRaw) && parsedManualYieldRaw > 0
              ? Math.round((parsedManualYieldRaw + Number.EPSILON) * 1000) / 1000
              : autoSumWeightKg > 0
                ? autoSumWeightKg
                : 1)
          : (autoSumWeightKg > 0
              ? autoSumWeightKg
              : (Number.isFinite(parsedManualYieldRaw) && parsedManualYieldRaw > 0
                  ? Math.round((parsedManualYieldRaw + Number.EPSILON) * 1000) / 1000
                  : 1));

        const baseYield = isEditingRecipeItems
          ? effectiveEditYield
          : (selectedRecipe.yieldQty > 0 ? selectedRecipe.yieldQty : 1);
        const scaleMult = desiredTotalYield > 0 ? desiredTotalYield / baseYield : 1;

        const liveRecipeForCost: Recipe = isEditingRecipeItems
          ? {
              ...selectedRecipe,
              name: editableRecipeMeta.name.trim() || 'Новое блюдо',
              category: editableRecipeMeta.category,
              yieldQty: effectiveEditYield,
              sellingPrice: parseFloat(editableRecipeMeta.sellingPrice.replace(',', '.')) || 0,
              items: cleanDraftItems,
            }
          : selectedRecipe;

        const batchCost = calculateRecipeBatchCost(liveRecipeForCost);
        const costPerKg = calculateRecipeCost(liveRecipeForCost);
        const fc = getRecipeFoodCostPercent(liveRecipeForCost);
        const scaledCost = isEditingRecipeItems ? batchCost : costPerKg * desiredTotalYield;
        const scaledPrice = isEditingRecipeItems
          ? liveRecipeForCost.sellingPrice * effectiveEditYield
          : liveRecipeForCost.sellingPrice * desiredTotalYield;

        const handleSaveFullRecipe = () => {
          const finalName = editableRecipeMeta.name.trim();
          if (!finalName) {
            showNotice('error', 'Укажите название блюда перед сохранением.');
            return;
          }
          const finalPrice = Math.max(0, parseFloat(editableRecipeMeta.sellingPrice.replace(',', '.')) || 0);
          const finalPrep = Math.max(1, parseInt(editableRecipeMeta.prepTimeMin, 10) || 30);
          const finalShelf = Math.max(1, parseInt(editableRecipeMeta.shelfLifeHours, 10) || 48);
          const finalSteps = editableRecipeMeta.stepsText
            .split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean);

          const savedRecipe: Recipe = {
            id: isNewRecipeDraft ? `rec-${Date.now()}` : selectedRecipe.id,
            name: finalName,
            category: editableRecipeMeta.category,
            yieldQty: effectiveEditYield,
            yieldUnit: 'кг',
            prepTimeMin: finalPrep,
            sellingPrice: finalPrice,
            shelfLifeHours: finalShelf,
            tags: normalizeRecipeTags(editableRecipeMeta.tags),
            items: cleanDraftItems,
            steps: finalSteps.length > 0 ? finalSteps : ['Подготовить продукты и приготовить согласно техпроцессу.'],
          };

          if (isNewRecipeDraft) {
            setRecipes(prev => [savedRecipe, ...prev]);
          } else {
            setRecipes(prev => prev.map(r => (r.id === savedRecipe.id ? savedRecipe : r)));
          }
          recordTtkProducts(cleanDraftItems);
          setActiveProductDropdownIdx(null);
          setExpandedTtkCategories(prev => ({ ...prev, [savedRecipe.category]: true }));
          setSelectedRecipe(savedRecipe);
          setDesiredTotalYield(savedRecipe.yieldQty);
          setDraftYieldInput(String(savedRecipe.yieldQty));
          setIsNewRecipeDraft(false);
          setIsEditingRecipeItems(false);
          setIsBulkPasteOpen(false);
          showNotice(
            'success',
            isNewRecipeDraft
              ? `ТТК «${savedRecipe.name}» создана (выход ${formatWeightNumber(savedRecipe.yieldQty)} кг)!`
              : `ТТК «${savedRecipe.name}» сохранена (выход ${formatWeightNumber(savedRecipe.yieldQty)} кг)!`
          );
        };

        const handleApplyBulkPaste = () => {
          const parsedRows = parseBulkRecipeLines(bulkPasteText);
          if (parsedRows.length === 0) {
            showNotice('error', 'Вставьте хотя бы одну строку, например: Картофель 300 гр');
            return;
          }
          recordTtkProducts(parsedRows);
          setEditableRecipeItems(prev => {
            const nonEmptyExisting = prev.filter(
              it => it.name.trim() !== '' || (parseFloat((it.quantityInput || '').replace(',', '.')) || 0) > 0
            );
            return [...nonEmptyExisting, ...parsedRows];
          });
          setBulkPasteText('');
          setIsBulkPasteOpen(false);
          showNotice('success', `Добавлено строк: ${parsedRows.length}`);
        };

        const handleSuggestRecipeWithAi = async () => {
          const dishName = editableRecipeMeta.name.trim();
          if (!dishName) {
            showNotice('error', 'Сначала укажите название блюда.');
            return;
          }
          setIsSuggestingRecipeAi(true);
          try {
            const data = await fetchApiJson<{ suggestion?: any; error?: string }>('/api/gemini/suggest-recipe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: dishName,
                category: editableRecipeMeta.category,
                sellingPrice: parseFloat(editableRecipeMeta.sellingPrice.replace(',', '.')) || 0,
                warehouseNames: ingredients.map(i => i.name),
              }),
            });
            if (data.error) {
              showNotice('error', `Ошибка ИИ: ${data.error}`);
              return;
            }
            const s = data.suggestion;
            if (!s) {
              showNotice('error', 'Не удалось получить черновик состава от ИИ.');
              return;
            }
            const rawItems = Array.isArray(s.items) ? s.items : [];
            const mappedRows: EditableRecipeItem[] = rawItems
              .map((it: any): EditableRecipeItem | null => {
                const name = String(it?.name || '').trim();
                if (!name) return null;
                const qty = Number(it?.quantity) || 0;
                const u = String(it?.unit || 'гр').trim().toLowerCase();
                const unit: RecipeItemUnit =
                  u === 'г' || u === 'гр'
                    ? 'гр'
                    : u.startsWith('бан')
                      ? 'банка'
                      : normalizeUnit(u, 'гр');
                const matched = ingredients.find(
                  ing => ing.name.trim().toLowerCase() === name.toLowerCase()
                );
                return {
                  ...(matched ? { ingredientId: matched.id } : {}),
                  name,
                  quantity: qty,
                  quantityInput: qty > 0 ? String(qty) : '',
                  unit,
                };
              })
              .filter((r: EditableRecipeItem | null): r is EditableRecipeItem => r !== null);

            if (mappedRows.length > 0) {
              setEditableRecipeItems(mappedRows);
              setIsCustomYieldManual(false);
              const aiSumKg = calculateItemsTotalWeightKg(mappedRows);
              setDraftYieldInput(String(aiSumKg > 0 ? aiSumKg : 1));
            }
            const suggestedTags = normalizeRecipeTags(s.tags);
            const suggestedSteps = Array.isArray(s.steps)
              ? s.steps.map((st: any) => String(st || '').trim()).filter(Boolean)
              : [];
            setEditableRecipeMeta(prev => ({
              ...prev,
              prepTimeMin: s.prepTimeMin ? String(Math.round(Number(s.prepTimeMin))) : prev.prepTimeMin,
              shelfLifeHours: s.shelfLifeHours ? String(Math.round(Number(s.shelfLifeHours))) : prev.shelfLifeHours,
              tags: normalizeRecipeTags([...prev.tags, ...suggestedTags]),
              stepsText: suggestedSteps.length > 0 ? suggestedSteps.join('\n') : prev.stepsText,
            }));
            showNotice('success', `Шеф-ИИ подобрал состав (${mappedRows.length} поз.) — проверьте граммовки и нажмите «Сохранить ТТК».`);
          } catch (err: any) {
            showNotice('error', err?.message || 'Ошибка при подборе состава через ИИ');
          } finally {
            setIsSuggestingRecipeAi(false);
          }
        };

        return (
          <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-2 sm:p-4">
            <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
              {/* Modal Header */}
              <div className="px-4 py-3.5 sm:px-5 sm:py-4 bg-stone-950 border-b border-stone-800 flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] px-2.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-md font-semibold">
                      {isEditingRecipeItems ? editableRecipeMeta.category : selectedRecipe.category}
                    </span>
                    <span className="text-[11px] text-stone-400 font-mono">
                      Выход: {formatWeightNumber(baseYield)} {selectedRecipe.yieldUnit || 'кг'}
                    </span>
                    {(isEditingRecipeItems ? editableRecipeMeta.tags : normalizeRecipeTags(selectedRecipe.tags)).map(tag => (
                      <span
                        key={tag}
                        className={`text-[10px] px-2 py-0.5 rounded-md border font-medium ${getRecipeTagBadgeClass(tag)}`}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-white mt-1 truncate">
                    {isNewRecipeDraft
                      ? (editableRecipeMeta.name.trim() || 'Новая технологическая карта (ТТК)')
                      : (isEditingRecipeItems ? editableRecipeMeta.name || selectedRecipe.name : selectedRecipe.name)}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {!isNewRecipeDraft && !isEditingRecipeItems && (
                    <button
                      type="button"
                      onClick={() => handleDuplicateRecipe(selectedRecipe)}
                      className="text-stone-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-xs font-medium flex items-center gap-1 transition"
                      title="Создать копию ТТК"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Копия</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedRecipe(null);
                      setIsNewRecipeDraft(false);
                      setIsEditingRecipeItems(false);
                    }}
                    className="text-stone-400 hover:text-white p-1.5 rounded-lg bg-stone-800"
                    aria-label="Закрыть"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Scrollable Body */}
              <div className="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1 text-xs sm:text-sm">
                {/* Editable Dish Metadata when Editing or Creating */}
                {isEditingRecipeItems && (
                  <div className="bg-stone-950 p-3.5 rounded-xl border border-stone-800 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] text-stone-400 mb-1">Название блюда *</label>
                        <input
                          type="text"
                          autoFocus={isNewRecipeDraft}
                          value={editableRecipeMeta.name}
                          onChange={e => setEditableRecipeMeta(prev => ({ ...prev, name: e.target.value }))}
                          placeholder="Например: Салат Оливье"
                          className="w-full bg-stone-900 border border-stone-700 focus:border-amber-500 rounded-lg px-3 py-2 text-stone-100 text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-400 mb-1">Категория</label>
                        <select
                          value={editableRecipeMeta.category}
                          onChange={e =>
                            setEditableRecipeMeta(prev => ({
                              ...prev,
                              category: e.target.value as RecipeCategory,
                            }))
                          }
                          className="w-full bg-stone-900 border border-stone-700 focus:border-amber-500 rounded-lg px-2.5 py-2 text-stone-100 text-xs outline-none"
                        >
                          {RECIPE_CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2.5">
                      <div>
                        <label className="block text-[10px] text-stone-400 mb-1">Цена/1 кг (₽)</label>
                        <input
                          type="text"
                          inputMode="decimal"
                          value={editableRecipeMeta.sellingPrice}
                          onChange={e => setEditableRecipeMeta(prev => ({ ...prev, sellingPrice: e.target.value }))}
                          placeholder="700"
                          className="w-full bg-stone-900 border border-stone-700 focus:border-amber-500 rounded-lg px-2.5 py-2 text-amber-400 font-semibold text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-400 mb-1">Время (мин)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editableRecipeMeta.prepTimeMin}
                          onChange={e => setEditableRecipeMeta(prev => ({ ...prev, prepTimeMin: e.target.value }))}
                          placeholder="30"
                          className="w-full bg-stone-900 border border-stone-700 focus:border-amber-500 rounded-lg px-2.5 py-2 text-stone-100 text-xs outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-stone-400 mb-1">Срок годн. (ч)</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={editableRecipeMeta.shelfLifeHours}
                          onChange={e => setEditableRecipeMeta(prev => ({ ...prev, shelfLifeHours: e.target.value }))}
                          placeholder="48"
                          className="w-full bg-stone-900 border border-stone-700 focus:border-amber-500 rounded-lg px-2.5 py-2 text-stone-100 text-xs outline-none"
                        />
                      </div>
                    </div>

                    {/* Dish Tags Field */}
                    <div className="pt-1 border-t border-stone-800/80 space-y-2">
                      <label className="block text-[10px] text-stone-400 flex items-center gap-1">
                        <Tag className="w-3 h-3 text-amber-400" />
                        <span>Теги блюда</span>
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {RECIPE_TAGS.map(tag => {
                          const isSelected = editableRecipeMeta.tags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              onClick={() =>
                                setEditableRecipeMeta(prev => ({
                                  ...prev,
                                  tags: prev.tags.includes(tag)
                                    ? prev.tags.filter(t => t !== tag)
                                    : [...prev.tags, tag],
                                }))
                              }
                              aria-pressed={isSelected}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition flex items-center gap-1.5 ${
                                isSelected
                                  ? getRecipeTagBadgeClass(tag) + ' ring-1 ring-white/20 font-semibold'
                                  : 'bg-stone-900 text-stone-400 border-stone-700 hover:text-stone-200 hover:border-stone-600'
                              }`}
                            >
                              {isSelected && <Check className="w-3 h-3" />}
                              <span>{tag}</span>
                            </button>
                          );
                        })}
                        {editableRecipeMeta.tags
                          .filter(t => !(RECIPE_TAGS as readonly string[]).includes(t))
                          .map(customTag => (
                            <button
                              key={customTag}
                              type="button"
                              onClick={() =>
                                setEditableRecipeMeta(prev => ({
                                  ...prev,
                                  tags: prev.tags.filter(t => t !== customTag),
                                }))
                              }
                              title="Убрать тег"
                              className="px-2.5 py-1.5 rounded-lg text-xs font-medium border bg-stone-800 text-stone-200 border-stone-600 hover:border-red-500/50 transition flex items-center gap-1"
                            >
                              <span>#{customTag}</span>
                              <X className="w-3 h-3 text-stone-400" />
                            </button>
                          ))}
                      </div>
                      <div className="flex gap-1.5">
                        <input
                          type="text"
                          value={customTagInput}
                          onChange={e => setCustomTagInput(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              const clean = customTagInput.trim().toLowerCase().replace(/^#/, '');
                              if (!clean) return;
                              setEditableRecipeMeta(prev => ({
                                ...prev,
                                tags: prev.tags.includes(clean) ? prev.tags : [...prev.tags, clean],
                              }));
                              setCustomTagInput('');
                            }
                          }}
                          placeholder="Свой тег (например: халяль, хит)..."
                          className="flex-1 bg-stone-900 border border-stone-700 focus:border-amber-500 rounded-lg px-2.5 py-1.5 text-stone-200 text-xs outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const clean = customTagInput.trim().toLowerCase().replace(/^#/, '');
                            if (!clean) return;
                            setEditableRecipeMeta(prev => ({
                              ...prev,
                              tags: prev.tags.includes(clean) ? prev.tags : [...prev.tags, clean],
                            }));
                            setCustomTagInput('');
                          }}
                          className="bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 px-3 py-1.5 rounded-lg text-xs font-medium transition shrink-0"
                        >
                          Добавить
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Desired Total Yield Recalculation Input (only in View mode) */}
                {!isEditingRecipeItems && (
                  <div className="bg-stone-950 p-3.5 rounded-xl border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                    <div>
                      <div className="font-semibold text-white text-xs sm:text-sm flex items-center gap-1.5">
                        <Calculator className="w-4 h-4 text-amber-500" />
                        <span>Пересчет на партию (выход ТТК: {formatWeightNumber(baseYield)} кг)</span>
                      </div>
                      <div className="text-stone-400 text-[11px] mt-0.5">Введите нужный вес готовой продукции для пересчета:</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        step="0.1"
                        min="0.1"
                        value={desiredTotalYield}
                        onChange={e => setDesiredTotalYield(parseFloat(e.target.value) || 0)}
                        className="w-24 bg-stone-900 border border-stone-700 text-amber-400 font-bold rounded-xl px-3 py-1.5 text-sm text-center outline-none focus:border-amber-500"
                      />
                      <span className="text-stone-300 font-semibold text-xs">кг</span>
                    </div>
                  </div>
                )}

                {/* Financial Summary */}
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="bg-stone-950 p-2.5 rounded-xl border border-stone-800 text-center">
                    <div className="text-[10px] text-stone-400 uppercase">
                      {isEditingRecipeItems
                        ? `Себест. (${formatWeightNumber(baseYield)} кг)`
                        : `Себест. (${formatWeightNumber(desiredTotalYield || 0)} кг)`}
                    </div>
                    <div className="text-sm sm:text-base font-bold text-stone-100">{Math.round(scaledCost)} ₽</div>
                    <div className="text-[10px] text-stone-500">{Math.round(costPerKg)} ₽/кг</div>
                  </div>
                  <div className="bg-stone-950 p-2.5 rounded-xl border border-stone-800 text-center">
                    <div className="text-[10px] text-stone-400 uppercase">
                      {isEditingRecipeItems
                        ? `Выручка (${formatWeightNumber(baseYield)} кг)`
                        : `Цена (${formatWeightNumber(desiredTotalYield || 0)} кг)`}
                    </div>
                    <div className="text-sm sm:text-base font-bold text-amber-400">{Math.round(scaledPrice)} ₽</div>
                    <div className="text-[10px] text-stone-500">{Math.round(liveRecipeForCost.sellingPrice)} ₽/кг</div>
                  </div>
                  <div className="bg-stone-950 p-2.5 rounded-xl border border-stone-800 text-center">
                    <div className="text-[10px] text-stone-400 uppercase">Фудкост / Маржа</div>
                    <div className={`text-sm sm:text-base font-bold ${fc > 32 ? (fc > 38 ? 'text-red-400' : 'text-amber-400') : 'text-emerald-400'}`}>
                      {fc}% ({Math.round(scaledPrice - scaledCost)} ₽)
                    </div>
                  </div>
                </div>

                {renderFoodCostProgressBar(fc)}

                {/* Products Section */}
                <div>
                  <div className="flex flex-wrap justify-between items-center gap-2 mb-2.5">
                    <h4 className="font-semibold text-white text-xs sm:text-sm">
                      {isEditingRecipeItems
                        ? `Продукты закладки (выход: ${formatWeightNumber(effectiveEditYield)} кг):`
                        : `Раскладка продуктов (на ${formatWeightNumber(desiredTotalYield || 0)} кг):`}
                    </h4>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isEditingRecipeItems && (
                        <>
                          <button
                            type="button"
                            disabled={isSuggestingRecipeAi}
                            onClick={handleSuggestRecipeWithAi}
                            className="px-2.5 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5 border bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border-amber-500/30 disabled:opacity-50"
                          >
                            {isSuggestingRecipeAi ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            <span>{isSuggestingRecipeAi ? 'Подбор ИИ...' : 'Подобрать состав (ИИ)'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsBulkPasteOpen(prev => !prev)}
                            className={`px-2.5 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5 border ${
                              isBulkPasteOpen
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-stone-800 hover:bg-stone-700 text-stone-200 border-stone-700'
                            }`}
                          >
                            <ListPlus className="w-3.5 h-3.5" />
                            <span>Вставить списком</span>
                          </button>
                        </>
                      )}
                      {!isEditingRecipeItems && (
                        <button
                          type="button"
                          onClick={() => openRecipeModal(selectedRecipe, true)}
                          className="bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Редактировать ТТК</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {isEditingRecipeItems ? (
                    <div className="space-y-2.5 bg-stone-950 p-3 rounded-xl border border-stone-800">
                      {/* Actual Dish Yield Bar (auto-summed from gram weights, with optional manual override) */}
                      <div className="bg-stone-900/90 border border-stone-800 rounded-xl p-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-medium text-stone-300 flex items-center gap-1.5">
                            <Scale className="w-3.5 h-3.5 text-amber-400" />
                            <span>Выход готового блюда:</span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              inputMode="decimal"
                              value={
                                isCustomYieldManual
                                  ? draftYieldInput
                                  : (autoSumWeightKg > 0 ? String(autoSumWeightKg) : draftYieldInput)
                              }
                              onChange={e => {
                                setIsCustomYieldManual(true);
                                setDraftYieldInput(e.target.value);
                              }}
                              placeholder="1"
                              className="w-20 bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg px-2 py-1 text-xs font-bold text-amber-400 text-center outline-none"
                            />
                            <span className="text-xs text-stone-300 font-medium">кг</span>
                          </div>
                        </div>
                        {isCustomYieldManual ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[10px] text-stone-400">
                              Задан вручную (сумма: {formatWeightNumber(autoSumWeightKg)} кг)
                            </span>
                            {autoSumWeightKg > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setIsCustomYieldManual(false);
                                  setDraftYieldInput(String(autoSumWeightKg));
                                }}
                                className="text-[10px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-lg font-semibold transition"
                              >
                                Из граммовок ({formatWeightNumber(autoSumWeightKg)} кг)
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-1 rounded-lg">
                            Считается автоматически по сумме граммовок ({formatWeightNumber(effectiveEditYield)} кг)
                          </span>
                        )}
                      </div>

                      {/* Optional Bulk Text Paste Helper */}
                      {isBulkPasteOpen && (
                        <div className="bg-stone-900 border border-amber-500/30 rounded-xl p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-amber-300">
                              Быстрая вставка продуктов списком (по 1 строке)
                            </span>
                            <button
                              type="button"
                              onClick={() => setIsBulkPasteOpen(false)}
                              className="text-stone-400 hover:text-white text-xs"
                            >
                              ✕
                            </button>
                          </div>
                          <textarea
                            rows={4}
                            value={bulkPasteText}
                            onChange={e => setBulkPasteText(e.target.value)}
                            placeholder={'Картофель отварной 300 гр\nКолбаса докторская 250 гр\nГорошек зелёный 1 банка\nЯйцо куриное 4 шт\nМайонез 0.15 кг'}
                            className="w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg p-2.5 text-xs text-stone-100 outline-none resize-y"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={handleApplyBulkPaste}
                              className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold px-3 py-1.5 rounded-lg text-xs transition"
                            >
                              Добавить из списка
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Desktop Column Header */}
                      <div className="hidden sm:grid sm:grid-cols-[24px_1fr_92px_92px_32px] gap-2 px-2 text-[10px] text-stone-400 uppercase tracking-wider">
                        <span>#</span>
                        <span>Продукт</span>
                        <span className="text-center">Вес</span>
                        <span>Ед. изм.</span>
                        <span></span>
                      </div>

                      <div className={`space-y-1.5 ${activeProductDropdownIdx !== null ? 'pb-40' : ''}`}>
                        {editableRecipeItems.map((item, idx) => {
                          const isDropdownOpen = activeProductDropdownIdx === idx;
                          const queryLower = item.name.trim().toLowerCase();
                          const recentTop3 = !queryLower ? allTtkProductCatalog.slice(0, 3) : [];
                          const restCatalog = !queryLower
                            ? allTtkProductCatalog.slice(3)
                            : allTtkProductCatalog.filter(opt =>
                                opt.name.toLowerCase().includes(queryLower)
                              );

                          const handlePickTtkProduct = (opt: (typeof allTtkProductCatalog)[number]) => {
                            setEditableRecipeItems(prev =>
                              prev.map((it, i) =>
                                i === idx
                                  ? {
                                      ...it,
                                      name: opt.name,
                                      ingredientId: opt.matchedIngredient?.id,
                                      ...(!it.quantityInput.trim() && it.quantity === 0
                                        ? { unit: opt.unit }
                                        : {}),
                                    }
                                  : it
                              )
                            );
                            recordTtkProducts([{ name: opt.name, unit: opt.unit }]);
                            setActiveProductDropdownIdx(null);
                          };

                          return (
                            <div
                              key={idx}
                              className="bg-stone-900 p-2 rounded-xl border border-stone-800 grid grid-cols-[1fr_auto] sm:grid-cols-[24px_1fr_92px_92px_32px] gap-1.5 sm:gap-2 items-center"
                            >
                              <span className="hidden sm:inline text-[11px] font-mono text-stone-500 text-center">
                                {idx + 1}
                              </span>
                              <div
                                ref={el => {
                                  if (isDropdownOpen) {
                                    activeProductRowRef.current = el;
                                  }
                                }}
                                className="relative col-span-2 sm:col-span-1"
                              >
                                <input
                                  ref={el => {
                                    ttkProductInputRefs.current[idx] = el;
                                  }}
                                  type="text"
                                  autoComplete="off"
                                  value={item.name}
                                  placeholder={`Продукт ${idx + 1} (напр. Горошек)`}
                                  onFocus={() => setActiveProductDropdownIdx(idx)}
                                  onClick={() => setActiveProductDropdownIdx(idx)}
                                  onKeyDown={e => {
                                    if (e.key === 'Escape') {
                                      setActiveProductDropdownIdx(null);
                                    }
                                  }}
                                  onChange={e => {
                                    const val = e.target.value;
                                    const matched = ingredients.find(
                                      ing => ing.name.trim().toLowerCase() === val.trim().toLowerCase()
                                    );
                                    setEditableRecipeItems(prev =>
                                      prev.map((it, i) =>
                                        i === idx
                                          ? {
                                              ...it,
                                              name: val,
                                              ingredientId: matched?.id,
                                              ...(matched && !it.name.trim() ? { unit: matched.unit } : {}),
                                            }
                                          : it
                                      )
                                    );
                                    if (activeProductDropdownIdx !== idx) {
                                      setActiveProductDropdownIdx(idx);
                                    }
                                  }}
                                  className="w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg pl-2.5 pr-7 py-1.5 text-stone-100 text-xs outline-none"
                                />
                                <button
                                  type="button"
                                  tabIndex={-1}
                                  onClick={() =>
                                    setActiveProductDropdownIdx(prev => (prev === idx ? null : idx))
                                  }
                                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-amber-400 p-0.5 transition"
                                  aria-label="Список продуктов"
                                >
                                  <ChevronDown
                                    className={`w-3.5 h-3.5 transition-transform ${
                                      isDropdownOpen ? 'rotate-180 text-amber-400' : ''
                                    }`}
                                  />
                                </button>

                                {isDropdownOpen && (
                                  <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-stone-900 border border-amber-500/40 rounded-xl shadow-2xl overflow-hidden">
                                    <div className="max-h-[156px] overflow-y-auto overscroll-contain divide-y divide-stone-800/70">
                                      {!queryLower ? (
                                        <>
                                          {recentTop3.length > 0 && (
                                            <div>
                                              <div className="sticky top-0 bg-stone-950/95 backdrop-blur-sm px-2.5 py-1 text-[10px] font-semibold text-amber-400 uppercase tracking-wider flex items-center gap-1 border-b border-stone-800">
                                                <Clock className="w-3 h-3" />
                                                <span>Последние 3 продукта</span>
                                              </div>
                                              {recentTop3.map(opt => (
                                                <button
                                                  key={`recent-${opt.name.toLowerCase()}`}
                                                  type="button"
                                                  onClick={() => handlePickTtkProduct(opt)}
                                                  className="w-full text-left px-2.5 py-2 hover:bg-stone-800 active:bg-stone-700 transition flex items-center justify-between gap-2 text-xs"
                                                >
                                                  <span className="font-medium text-stone-100 truncate">
                                                    {opt.name}
                                                  </span>
                                                  <span className="text-[10px] text-amber-300 shrink-0 font-mono">
                                                    {opt.matchedIngredient
                                                      ? `${opt.matchedIngredient.costPerUnit} ₽/${opt.matchedIngredient.unit}`
                                                      : opt.unit}
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          )}

                                          {restCatalog.length > 0 && (
                                            <div>
                                              <div className="sticky top-0 bg-stone-950/95 backdrop-blur-sm px-2.5 py-1 text-[10px] font-semibold text-stone-400 uppercase tracking-wider border-b border-stone-800">
                                                Все продукты (листайте ниже)
                                              </div>
                                              {restCatalog.map(opt => (
                                                <button
                                                  key={`all-${opt.name.toLowerCase()}`}
                                                  type="button"
                                                  onClick={() => handlePickTtkProduct(opt)}
                                                  className="w-full text-left px-2.5 py-2 hover:bg-stone-800 active:bg-stone-700 transition flex items-center justify-between gap-2 text-xs"
                                                >
                                                  <span className="text-stone-200 truncate">{opt.name}</span>
                                                  <span className="text-[10px] text-stone-400 shrink-0 font-mono">
                                                    {opt.matchedIngredient
                                                      ? `${opt.matchedIngredient.costPerUnit} ₽/${opt.matchedIngredient.unit}`
                                                      : opt.unit}
                                                  </span>
                                                </button>
                                              ))}
                                            </div>
                                          )}
                                        </>
                                      ) : restCatalog.length > 0 ? (
                                        <div>
                                          <div className="sticky top-0 bg-stone-950/95 backdrop-blur-sm px-2.5 py-1 text-[10px] font-semibold text-amber-400 uppercase tracking-wider border-b border-stone-800">
                                            Найдено: {restCatalog.length}
                                          </div>
                                          {restCatalog.map(opt => (
                                            <button
                                              key={`match-${opt.name.toLowerCase()}`}
                                              type="button"
                                              onClick={() => handlePickTtkProduct(opt)}
                                              className="w-full text-left px-2.5 py-2 hover:bg-stone-800 active:bg-stone-700 transition flex items-center justify-between gap-2 text-xs"
                                            >
                                              <span className="text-stone-100 truncate">{opt.name}</span>
                                              <span className="text-[10px] text-stone-400 shrink-0 font-mono">
                                                {opt.matchedIngredient
                                                  ? `${opt.matchedIngredient.costPerUnit} ₽/${opt.matchedIngredient.unit}`
                                                  : opt.unit}
                                              </span>
                                            </button>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="px-3 py-2.5 text-[11px] text-stone-400">
                                          Новый продукт «<span className="text-stone-200 font-medium">{item.name.trim()}</span>» — сохранится автоматически.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 sm:contents">
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="Вес"
                                  value={item.quantityInput}
                                  onFocus={() => {
                                    if (item.name.trim().length >= 2) {
                                      recordTtkProducts([{ name: item.name, unit: item.unit }]);
                                    }
                                    setActiveProductDropdownIdx(null);
                                  }}
                                  onKeyDown={e => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      if (item.name.trim().length >= 2) {
                                        recordTtkProducts([{ name: item.name, unit: item.unit }]);
                                      }
                                      const nextIdx = editableRecipeItems.length;
                                      pendingFocusRowRef.current = nextIdx;
                                      setEditableRecipeItems(prev => [
                                        ...prev,
                                        { name: '', quantity: 0, quantityInput: '', unit: item.unit || 'гр' },
                                      ]);
                                    }
                                  }}
                                  onChange={e => {
                                    const raw = e.target.value;
                                    const parsed = parseFloat(raw.replace(',', '.')) || 0;
                                    setEditableRecipeItems(prev =>
                                      prev.map((it, i) =>
                                        i === idx ? { ...it, quantityInput: raw, quantity: parsed } : it
                                      )
                                    );
                                  }}
                                  className="flex-1 sm:flex-initial w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg px-2 py-1.5 text-xs text-stone-100 text-center outline-none"
                                />
                                <select
                                  value={item.unit}
                                  onChange={e => {
                                    const unit = e.target.value as RecipeItemUnit;
                                    if (item.name.trim().length >= 2) {
                                      recordTtkProducts([{ name: item.name, unit }]);
                                    }
                                    setEditableRecipeItems(prev =>
                                      prev.map((it, i) => (i === idx ? { ...it, unit } : it))
                                    );
                                  }}
                                  className="w-24 sm:w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg px-2 py-1.5 text-xs text-stone-100 outline-none"
                                >
                                  {RECIPE_ITEM_UNITS.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                  ))}
                                </select>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveProductDropdownIdx(null);
                                  setEditableRecipeItems(prev => {
                                    const next = prev.filter((_, i) => i !== idx);
                                    return next.length > 0
                                      ? next
                                      : [{ name: '', quantity: 0, quantityInput: '', unit: 'гр' }];
                                  });
                                }}
                                className="text-stone-500 hover:text-red-400 p-1.5 rounded-lg hover:bg-stone-800 transition justify-self-end sm:justify-self-center"
                                title="Удалить строку"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            const filled = editableRecipeItems.filter(it => it.name.trim().length >= 2);
                            if (filled.length > 0) recordTtkProducts(filled);
                            const nextIdx = editableRecipeItems.length;
                            pendingFocusRowRef.current = nextIdx;
                            setEditableRecipeItems(prev => [
                              ...prev,
                              { name: '', quantity: 0, quantityInput: '', unit: 'гр' }
                            ]);
                          }}
                          className="flex-1 bg-stone-900 hover:bg-stone-800 text-amber-400 border border-stone-700/80 py-2 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Добавить строку</span>
                        </button>
                      </div>
                      <p className="text-[10px] text-stone-500">
                        Совет: все введённые продукты сохраняются автоматически — при следующем добавлении сначала показываются 3 последних, остальные ниже в списке.
                      </p>
                    </div>
                  ) : (
                    <div className="border border-stone-800 rounded-xl overflow-hidden">
                      {selectedRecipe.items.length === 0 ? (
                        <div className="p-5 text-center text-xs text-stone-400 space-y-2 bg-stone-950">
                          <p>Список продуктов пока пуст.</p>
                          <button
                            type="button"
                            onClick={() => openRecipeModal(selectedRecipe, true)}
                            className="text-amber-400 hover:underline font-semibold"
                          >
                            + Заполнить продукты
                          </button>
                        </div>
                      ) : (
                        <table className="w-full text-left text-xs">
                          <thead className="bg-stone-950 text-stone-400 border-b border-stone-800">
                            <tr>
                              <th className="p-3">Продукт</th>
                              <th className="p-3">Вес (на {desiredTotalYield} кг)</th>
                              <th className="p-3 text-right">Стоимость</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-800 text-stone-200">
                            {selectedRecipe.items.map((it, idx) => {
                              const qty = getRecipeItemQty(it) * scaleMult;
                              const unit = getRecipeItemUnit(it);
                              const baseCost = calculateRecipeItemCost(it);
                              return (
                                <tr key={idx}>
                                  <td className="p-3 font-medium text-white">{getRecipeItemName(it)}</td>
                                  <td className="p-3 text-stone-300 font-mono">{formatWeightNumber(qty)} {unit}</td>
                                  <td className="p-3 text-right font-bold text-amber-400">
                                    {baseCost !== null ? `${Math.round(baseCost * scaleMult)} ₽` : <span className="text-stone-500 font-normal">—</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>

                {/* Steps */}
                <div>
                  <h4 className="font-semibold text-white text-xs sm:text-sm mb-2">Технология приготовления:</h4>
                  {isEditingRecipeItems ? (
                    <textarea
                      rows={3}
                      value={editableRecipeMeta.stepsText}
                      onChange={e => setEditableRecipeMeta(prev => ({ ...prev, stepsText: e.target.value }))}
                      placeholder={'1. Подготовить и нарезать ингредиенты.\n2. Заправить и перемешать.\n3. Охладить и упаковать.'}
                      className="w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-xl p-3 text-xs text-stone-200 outline-none resize-y"
                    />
                  ) : (
                    <ol className="space-y-1.5 text-stone-300 list-decimal list-inside bg-stone-950 p-3.5 rounded-xl border border-stone-800 text-xs sm:text-sm">
                      {selectedRecipe.steps.map((step, idx) => (
                        <li key={idx} className="leading-relaxed">{step}</li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>

              {/* Sticky Footer */}
              <div className="p-3.5 sm:p-4 bg-stone-950 border-t border-stone-800 flex flex-wrap items-center justify-between gap-2">
                {!isNewRecipeDraft ? (
                  <button
                    type="button"
                    onClick={() => setRecipeToDelete(selectedRecipe)}
                    className="bg-red-950/50 hover:bg-red-950/80 text-red-400 border border-red-900/50 px-3 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span className="hidden sm:inline">Удалить ТТК</span>
                  </button>
                ) : (
                  <span className="text-[11px] text-stone-500">Новая ТТК (на 1 кг)</span>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  {isEditingRecipeItems ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          if (isNewRecipeDraft) {
                            setSelectedRecipe(null);
                            setIsNewRecipeDraft(false);
                            setIsEditingRecipeItems(false);
                          } else {
                            openRecipeModal(selectedRecipe, false);
                          }
                        }}
                        className="bg-stone-800 hover:bg-stone-700 text-stone-300 px-3.5 py-2 rounded-xl font-semibold text-xs transition"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveFullRecipe}
                        className="bg-emerald-500 hover:bg-emerald-400 text-stone-950 px-4 py-2 rounded-xl font-bold text-xs transition flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                        <span>{isNewRecipeDraft ? 'Создать и сохранить' : 'Сохранить ТТК'}</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="bg-stone-800 hover:bg-stone-700 text-stone-200 px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-1.5"
                      >
                        <Printer className="w-4 h-4" />
                        <span>Печать</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedRecipe(null)}
                        className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-4 py-2 rounded-xl font-semibold text-xs transition"
                      >
                        Закрыть
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* DELETE RECIPE CONFIRMATION MODAL */}
      {recipeToDelete && (
        <div
          onClick={() => setRecipeToDelete(null)}
          className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-stone-900 border border-stone-800 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/15 text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-white">Удалить блюдо из ТТК?</h3>
                <p className="text-xs text-stone-300 mt-1 leading-relaxed break-words">
                  Технологическая карта «<strong className="text-white">{recipeToDelete.name}</strong>» ({recipeToDelete.category}) будет удалена из базы.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRecipeToDelete(null)}
                className="bg-stone-800 hover:bg-stone-700 text-stone-300 px-4 py-2 rounded-xl text-xs font-semibold transition"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => handleDeleteRecipe(recipeToDelete)}
                className="bg-red-600 hover:bg-red-500 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Удалить</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NEW INGREDIENT MODAL */}
      {isNewIngredientModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Новый ингредиент</h3>
            <form onSubmit={e => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const newIng: Ingredient = {
                id: `ing-${Date.now()}`,
                name: formData.get('name') as string,
                unit: formData.get('unit') as any,
                costPerUnit: parseFloat(formData.get('cost') as string) || 0,
                stockQty: parseFloat(formData.get('stock') as string) || 0,
                minStock: parseFloat(formData.get('minStock') as string) || 5,
                supplier: formData.get('supplier') as string || 'Основной поставщик'
              };
              setIngredients(prev => [...prev, newIng]);
              setIsNewIngredientModalOpen(false);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-stone-400 mb-1">Наименование</label>
                <input required name="name" placeholder="Например: Сыр Моцарелла" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none focus:border-amber-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">Ед. измерения</label>
                  <select name="unit" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none">
                    <option value="кг">кг</option>
                    <option value="гр">гр</option>
                    <option value="л">л</option>
                    <option value="мл">мл</option>
                    <option value="шт">шт</option>
                    <option value="банка">банка</option>
                  </select>
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">Цена за ед. (₽)</label>
                  <input required name="cost" type="number" placeholder="450" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">Текущий остаток</label>
                  <input required name="stock" type="number" step="0.1" placeholder="10" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">Мин. остаток</label>
                  <input required name="minStock" type="number" step="0.1" placeholder="3" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-stone-400 mb-1">Поставщик</label>
                <input name="supplier" placeholder="ООО ПродуктТорг" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsNewIngredientModalOpen(false)} className="bg-stone-800 text-stone-300 px-4 py-2 rounded-xl">Отмена</button>
                <button type="submit" className="bg-amber-500 text-stone-950 font-semibold px-5 py-2 rounded-xl">Добавить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW EXPENSE MODAL */}
      {isNewExpenseModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Учет расхода бизнеса</h3>
            <form onSubmit={e => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const newExp: Expense = {
                id: `exp-${Date.now()}`,
                category: formData.get('category') as any,
                amount: parseFloat(formData.get('amount') as string) || 0,
                date: new Date().toISOString().slice(0, 10),
                note: formData.get('note') as string
              };
              setExpenses(prev => [newExp, ...prev]);
              setIsNewExpenseModalOpen(false);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-stone-400 mb-1">Категория</label>
                <select name="category" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none">
                  <option value="Ингредиенты">Ингредиенты</option>
                  <option value="Аренда">Аренда</option>
                  <option value="Зарплата">Зарплата</option>
                  <option value="Коммунальные">Коммунальные</option>
                  <option value="Упаковка">Упаковка</option>
                  <option value="Прочее">Прочее</option>
                </select>
              </div>
              <div>
                <label className="block text-stone-400 mb-1">Сумма (₽)</label>
                <input required name="amount" type="number" placeholder="5000" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
              </div>
              <div>
                <label className="block text-stone-400 mb-1">Примечание</label>
                <input required name="note" placeholder="Закупка моющих средств и перчаток" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsNewExpenseModalOpen(false)} className="bg-stone-800 text-stone-300 px-4 py-2 rounded-xl">Отмена</button>
                <button type="submit" className="bg-amber-500 text-stone-950 font-semibold px-5 py-2 rounded-xl">Сохранить</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* NEW WASTE RECORD MODAL */}
      {isNewWasteModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Создание акта потерь / списания</h3>
            <form onSubmit={e => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const newRec: WasteRecord = {
                id: `w-${Date.now()}`,
                date: formData.get('date') as string || new Date().toISOString().split('T')[0],
                itemName: formData.get('itemName') as string,
                quantity: parseFloat(formData.get('quantity') as string) || 1,
                unit: formData.get('unit') as string || 'кг',
                lossType: formData.get('lossType') as any,
                totalCost: parseFloat(formData.get('totalCost') as string) || 100,
                note: formData.get('note') as string || ''
              };
              setWasteRecords(prev => [newRec, ...prev]);
              setIsNewWasteModalOpen(false);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-stone-400 mb-1">Наименование сырья / блюда</label>
                <input required name="itemName" placeholder="Например: Говядина (обрезки)" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">Количество</label>
                  <input required name="quantity" type="number" step="0.1" defaultValue="1" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">Ед. изм.</label>
                  <select name="unit" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none">
                    <option value="кг">кг</option>
                    <option value="гр">гр</option>
                    <option value="л">л</option>
                    <option value="мл">мл</option>
                    <option value="шт">шт</option>
                    <option value="банка">банка</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">Тип потерь</label>
                  <select name="lossType" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none">
                    <option value="Холодная обработка (чистка)">Холодная обработка (чистка)</option>
                    <option value="Истечение срока годности">Истечение срока годности</option>
                    <option value="Брак производства">Брак производства</option>
                    <option value="Порча при хранении">Порча при хранении</option>
                  </select>
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">Сумма ущерба (₽)</label>
                  <input required name="totalCost" type="number" placeholder="350" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
                </div>
              </div>
              <div>
                <label className="block text-stone-400 mb-1">Дата</label>
                <input required name="date" type="date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
              </div>
              <div>
                <label className="block text-stone-400 mb-1">Примечание / Причина</label>
                <input name="note" placeholder="Например: Процент отходов по акту проработки" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsNewWasteModalOpen(false)} className="bg-stone-800 text-stone-300 px-4 py-2 rounded-xl">Отмена</button>
                <button type="submit" className="bg-amber-500 text-stone-950 font-semibold px-5 py-2 rounded-xl">Сохранить акт</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* WEEKLY MENU DISH PICKER MODAL (CATEGORY -> DISHES + SEARCH) */}
      {activeMenuRowId && (() => {
        const activeRow = weeklyMenuRows.find(r => r.id === activeMenuRowId);
        if (!activeRow) return null;

        const searchLower = pickerSearchQuery.trim().toLowerCase();
        const searchMatches = searchLower
          ? recipes.filter(r => r.name.toLowerCase().includes(searchLower))
          : [];
        const categoryDishes = pickerCategory
          ? recipes.filter(r => r.category === pickerCategory)
          : [];

        const handleSelectDish = (dishName: string, category: string) => {
          setWeeklyMenuRows(prev =>
            prev.map(item =>
              item.id === activeMenuRowId
                ? {
                    ...item,
                    dishName,
                    category,
                    weightKg: item.weightKg > 0 ? item.weightKg : 1
                  }
                : item
            )
          );
          setActiveMenuRowId(null);
          setPickerCategory(null);
          setPickerSearchQuery('');
        };

        return (
          <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-xl w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="p-4 sm:p-5 bg-stone-950 border-b border-stone-800 flex justify-between items-center">
                <div>
                  <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">
                    {activeRow.day} · Строка №{activeRow.slotNumber}
                  </span>
                  <h3 className="text-base sm:text-lg font-bold text-white mt-0.5">
                    {searchLower
                      ? 'Поиск блюда по названию'
                      : pickerCategory
                        ? `Категория: ${pickerCategory}`
                        : 'Выберите категорию блюда'}
                  </h3>
                </div>
                <button
                  onClick={() => {
                    setActiveMenuRowId(null);
                    setPickerCategory(null);
                    setPickerSearchQuery('');
                  }}
                  className="text-stone-400 hover:text-white p-1.5 rounded-lg bg-stone-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search Input */}
              <div className="p-4 border-b border-stone-800 bg-stone-950/60">
                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    autoFocus
                    value={pickerSearchQuery}
                    onChange={e => setPickerSearchQuery(e.target.value)}
                    placeholder="Поиск блюда по названию..."
                    className="w-full bg-stone-900 border border-stone-700 rounded-xl pl-10 pr-9 py-2.5 text-sm text-stone-100 outline-none focus:border-amber-500 transition"
                  />
                  {pickerSearchQuery && (
                    <button
                      onClick={() => setPickerSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Body */}
              <div className="p-4 overflow-y-auto flex-1 space-y-2.5">
                {searchLower ? (
                  <>
                    {searchMatches.length > 0 ? (
                      searchMatches.map(rec => (
                        <button
                          key={rec.id}
                          onClick={() => handleSelectDish(rec.name, rec.category)}
                          className="w-full text-left bg-stone-950 hover:bg-stone-800 border border-stone-800 hover:border-amber-500/50 rounded-xl p-3.5 transition flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-white text-sm break-words">{rec.name}</div>
                            <span className="text-[11px] text-amber-400 font-medium">{rec.category}</span>
                          </div>
                          <span className="text-xs font-bold text-stone-300 flex-shrink-0">{rec.sellingPrice} ₽/кг</span>
                        </button>
                      ))
                    ) : (
                      <div className="text-center py-6 space-y-3">
                        <p className="text-xs text-stone-400">Блюдо с таким названием не найдено в базе ТТК.</p>
                        <button
                          onClick={() => handleSelectDish(pickerSearchQuery.trim(), pickerCategory || 'Горячие блюда')}
                          className="bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold px-4 py-2 rounded-xl text-xs transition inline-flex items-center gap-1.5"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Добавить вручную «{pickerSearchQuery.trim()}»</span>
                        </button>
                      </div>
                    )}
                  </>
                ) : pickerCategory === null ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {RECIPE_CATEGORIES.map(cat => {
                      const catCount = recipes.filter(r => r.category === cat).length;
                      return (
                        <button
                          key={cat}
                          onClick={() => setPickerCategory(cat)}
                          className="bg-stone-950 hover:bg-stone-800 border border-stone-800 hover:border-amber-500/50 rounded-xl p-4 text-left transition flex items-center justify-between group"
                        >
                          <div>
                            <div className="font-bold text-white text-sm group-hover:text-amber-400 transition">{cat}</div>
                            <div className="text-[11px] text-stone-400 mt-0.5">{catCount} блюд в ТТК</div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-stone-500 group-hover:text-amber-400 transition" />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <button
                      onClick={() => setPickerCategory(null)}
                      className="text-xs text-amber-400 hover:text-amber-300 font-semibold flex items-center gap-1.5 py-1"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      <span>Назад к категориям</span>
                    </button>

                    {categoryDishes.length > 0 ? (
                      <div className="space-y-2">
                        {categoryDishes.map(rec => (
                          <button
                            key={rec.id}
                            onClick={() => handleSelectDish(rec.name, rec.category)}
                            className="w-full text-left bg-stone-950 hover:bg-stone-800 border border-stone-800 hover:border-amber-500/50 rounded-xl p-3.5 transition flex items-center justify-between gap-3"
                          >
                            <div className="font-semibold text-white text-sm break-words">{rec.name}</div>
                            <span className="text-xs font-bold text-amber-400 flex-shrink-0">{rec.sellingPrice} ₽/кг</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 bg-stone-950 rounded-xl border border-stone-800 space-y-2">
                        <p className="text-xs text-stone-400">В категории «{pickerCategory}» пока нет блюд в ТТК.</p>
                        <button
                          onClick={() => {
                            const cat = pickerCategory || 'Горячие блюда';
                            setActiveMenuRowId(null);
                            setPickerCategory(null);
                            setActiveTab('recipes');
                            openNewRecipeEditor(cat);
                          }}
                          className="text-xs text-amber-400 hover:underline font-semibold"
                        >
                          + Создать новое блюдо в ТТК
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
