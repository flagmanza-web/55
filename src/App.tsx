/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
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
  Paperclip
} from 'lucide-react';
import { PWAInstallButton } from './components/PWAInstallButton';
import { OfflineIndicator } from './components/OfflineIndicator';
import {
  DEFAULT_PUBLISHED_SERVER_URL,
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
  unit: 'кг' | 'г' | 'л' | 'мл' | 'шт';
  costPerUnit: number; // руб за единицу
  stockQty: number;
  minStock: number;
  supplier: string;
}

type RecipeItemUnit = 'кг' | 'г' | 'шт' | 'л' | 'мл';
const RECIPE_ITEM_UNITS: RecipeItemUnit[] = ['кг', 'г', 'шт', 'л', 'мл'];

interface RecipeItem {
  ingredientId?: string; // необязательная привязка к складу для авторасчета цены
  name: string;          // название продукта (вручную или из склада)
  quantity: number;      // вес / количество на 1 кг выхода
  unit: RecipeItemUnit;  // кг, г, шт, л, мл
  grossQty?: number;     // устаревшее поле для миграции
  netQty?: number;       // устаревшее поле для миграции
}

interface EditableRecipeItem extends RecipeItem {
  quantityInput: string;
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
    imageUrl: '/src/assets/images/pelmeni_dumplings_1794987230090.jpg',
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
    imageUrl: '/src/assets/images/napoleon_cake_1794987229773.jpg',
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
    imageUrl: '/src/assets/images/quiche_salmon_1794987230129.jpg',
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
  const [expandedTtkCategories, setExpandedTtkCategories] = useState<Record<string, boolean>>({});
  const [defaultNewRecipeCategory, setDefaultNewRecipeCategory] = useState<RecipeCategory>('Горячие блюда');
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
  const [ingredients, setIngredients] = useState<Ingredient[]>(() =>
    safeParseStorage<Ingredient[]>('cp_ingredients', INITIAL_INGREDIENTS)
  );

  const [recipes, setRecipes] = useState<Recipe[]>(() => {
    const parsed = safeParseStorage<any[]>('cp_recipes', INITIAL_RECIPES);
    if (!Array.isArray(parsed)) return INITIAL_RECIPES;
    return parsed.map((r: any) => ({
      ...r,
      category: normalizeCategory(r.category || 'Горячие блюда'),
      imageUrl: typeof r.imageUrl === 'string' && r.imageUrl.startsWith('blob:') ? undefined : r.imageUrl,
      items: Array.isArray(r.items)
        ? r.items.map((rawItem: any): RecipeItem => {
            const matchedIng = rawItem?.ingredientId
              ? ingredients.find(i => i.id === rawItem.ingredientId) || INITIAL_INGREDIENTS.find(i => i.id === rawItem.ingredientId)
              : undefined;
            const name =
              typeof rawItem?.name === 'string' && rawItem.name.trim()
                ? rawItem.name.trim()
                : matchedIng?.name || 'Продукт';
            const candidateUnit = rawItem?.unit || matchedIng?.unit || 'кг';
            const unit: RecipeItemUnit = (RECIPE_ITEM_UNITS as readonly string[]).includes(candidateUnit)
              ? (candidateUnit as RecipeItemUnit)
              : 'кг';
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
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
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
        const res = await fetch(resolveApiUrl('/api/gemini/parse-financial-report'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: base64String, mimeType: file.type })
        });
        const data = await parseApiJsonResponse<{ financials?: any; error?: string }>(res);
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
  const [editableRecipeItems, setEditableRecipeItems] = useState<EditableRecipeItem[]>([]);
  const [isNewRecipeModalOpen, setIsNewRecipeModalOpen] = useState(false);
  const [isNewIngredientModalOpen, setIsNewIngredientModalOpen] = useState(false);
  const [isNewExpenseModalOpen, setIsNewExpenseModalOpen] = useState(false);

  const handleDeleteRecipe = (recipe: Recipe) => {
    setRecipes(prev => prev.filter(r => r.id !== recipe.id));
    if (selectedRecipe?.id === recipe.id) {
      setSelectedRecipe(null);
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
    if (item.unit && (RECIPE_ITEM_UNITS as readonly string[]).includes(item.unit)) {
      return item.unit;
    }
    return findIngredientForItem(item)?.unit || 'кг';
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
    if (fromUnit === toUnit) return qty;
    if (fromUnit === 'г' && toUnit === 'кг') return qty / 1000;
    if (fromUnit === 'кг' && toUnit === 'г') return qty * 1000;
    if (fromUnit === 'мл' && toUnit === 'л') return qty / 1000;
    if (fromUnit === 'л' && toUnit === 'мл') return qty * 1000;
    return null;
  };

  const calculateRecipeItemCost = (item: RecipeItem): number | null => {
    const ing = findIngredientForItem(item);
    if (!ing) return null;
    const converted = convertUnitQty(getRecipeItemQty(item), getRecipeItemUnit(item), ing.unit);
    if (converted === null) return null;
    return ing.costPerUnit * converted;
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

  const calculateRecipeCost = (recipe: Recipe) => {
    let totalCost = 0;
    recipe.items.forEach(item => {
      const itemCost = calculateRecipeItemCost(item);
      if (itemCost !== null) {
        totalCost += itemCost;
      }
    });
    return totalCost; // стоимость на 1 кг выхода
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
        const res = await fetch(resolveApiUrl('/api/gemini/advisor'), {
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

        const data = await parseApiJsonResponse<{ result?: string; error?: string }>(res);
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

  // Generate recipe photo handler
  const handleGenerateRecipePhoto = async (recipe: Recipe) => {
    setIsGeneratingImage(true);
    try {
      await new Promise(r => setTimeout(r, 1500));
      const sampleImages = [
        '/src/assets/images/pelmeni_dumplings_1794987230090.jpg',
        '/src/assets/images/napoleon_cake_1794987229773.jpg',
        '/src/assets/images/quiche_salmon_1794987230129.jpg'
      ];
      const randomImg = sampleImages[Math.floor(Math.random() * sampleImages.length)];
      
      const updatedRecipes = recipes.map(r => r.id === recipe.id ? { ...r, imageUrl: randomImg } : r);
      setRecipes(updatedRecipes);
      setSelectedRecipe({ ...recipe, imageUrl: randomImg });
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  // Handle parse recipe from photo/screenshot
  const handleFileUploadForRecipe = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsParsingPhoto(true);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const dataUrl = reader.result as string;
          const base64String = dataUrl.split(',')[1];
          const mimeType = file.type;

          const response = await fetch(resolveApiUrl('/api/gemini/parse-recipe'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64String, mimeType })
          });

          const data = await parseApiJsonResponse<{ recipe?: any; error?: string }>(response);
          if (data.error) {
            showNotice('error', `Ошибка распознавания: ${data.error}`);
          } else if (data.recipe) {
            const parsed = data.recipe;
            const newRecipe: Recipe = {
              id: `rec-${Date.now()}`,
              name: parsed.name || 'Блюдо по фото',
              category: normalizeCategory(parsed.category || 'Горячие блюда'),
              yieldQty: 1, // стандарт на 1 кг
              yieldUnit: 'кг',
              prepTimeMin: parsed.prepTimeMin || 40,
              sellingPrice: parsed.sellingPrice || 600,
              shelfLifeHours: parsed.shelfLifeHours || 48,
              imageUrl: dataUrl.length < 250000 ? dataUrl : undefined,
              items: [
                {
                  ingredientId: ingredients[0]?.id,
                  name: ingredients[0]?.name || 'Мука пшеничная в/с',
                  quantity: 0.45,
                  unit: ingredients[0]?.unit || 'кг',
                },
                {
                  ingredientId: ingredients[1]?.id,
                  name: ingredients[1]?.name || 'Масло сливочное 82.5%',
                  quantity: 0.2,
                  unit: ingredients[1]?.unit || 'кг',
                }
              ],
              steps: parsed.steps || ['1. Подготовить ингредиенты по фото.', '2. Приготовить согласно техпроцессу.']
            };

            setRecipes(prev => [newRecipe, ...prev]);
            setExpandedTtkCategories(prev => ({ ...prev, [newRecipe.category]: true }));
            setIsPhotoModalOpen(false);
            showNotice('success', `Рецепт «${newRecipe.name}» добавлен в ТТК (на 1 кг)!`);
          }
        } catch (innerErr: any) {
          showNotice('error', `Ошибка: ${innerErr.message || 'не удалось обработать ответ'}`);
        } finally {
          setIsParsingPhoto(false);
        }
      };
      reader.onerror = () => {
        showNotice('error', 'Не удалось прочитать файл изображения.');
        setIsParsingPhoto(false);
      };
      reader.readAsDataURL(file);
    } catch (err: any) {
      console.error(err);
      showNotice('error', `Ошибка: ${err.message}`);
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

          const response = await fetch(resolveApiUrl('/api/gemini/parse-receipt-items'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageBase64: base64String, mimeType })
          });

          const data = await parseApiJsonResponse<{ items?: any[]; error?: string }>(response);
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
                  unit: pi.unit || 'кг',
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
      console.error(err);
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
                  onClick={() => setIsPhotoModalOpen(true)}
                  className="bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-500/30 px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2"
                >
                  <Camera className="w-4 h-4" />
                  <span>По фото</span>
                </button>
                <button 
                  onClick={() => setIsNewRecipeModalOpen(true)}
                  className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
                >
                  <Plus className="w-4 h-4" />
                  <span>Создать ТТК</span>
                </button>
              </div>
            </div>

            {/* Search bar & Expand/Collapse controls for TTK */}
            <div className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={recipeSearchQuery}
                  onChange={e => setRecipeSearchQuery(e.target.value)}
                  placeholder="Поиск блюда в ТТК по названию..."
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

              {!recipeSearchQuery.trim() && (
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

            {/* COLLAPSIBLE CATEGORY SECTIONS (GROUPS) */}
            {(() => {
              const query = recipeSearchQuery.trim().toLowerCase();
              const categoriesToRender = RECIPE_CATEGORIES.filter(cat => {
                if (!query) return true;
                return recipes.some(r => r.category === cat && r.name.toLowerCase().includes(query));
              });

              if (categoriesToRender.length === 0) {
                return (
                  <div className="bg-stone-900 border border-stone-800 rounded-2xl p-8 text-center text-xs text-stone-400">
                    По запросу «{recipeSearchQuery}» в базе ТТК ничего не найдено.
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {categoriesToRender.map(cat => {
                    const catRecipes = recipes.filter(
                      r => r.category === cat && (!query || r.name.toLowerCase().includes(query))
                    );
                    const isExpanded = query ? true : Boolean(expandedTtkCategories[cat]);

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
                                  onClick={() => {
                                    setDefaultNewRecipeCategory(cat);
                                    setIsNewRecipeModalOpen(true);
                                  }}
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
                                              <th className="p-3.5 border-r border-stone-800 w-2/5">Раскладка продуктов (на 1 кг)</th>
                                              <th className="p-3.5 border-r border-stone-800 w-1/5">Вес</th>
                                              <th className="p-3.5 text-center w-36">Действия</th>
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-stone-800 text-stone-200">
                                            <tr className="align-top">
                                              <td className="p-4 border-r border-stone-800 bg-stone-950/40">
                                                <div className="font-bold text-white text-base mb-1.5">{recipe.name}</div>
                                                <div className="mb-3">
                                                  <span className="text-[11px] px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20 font-semibold inline-block">
                                                    {recipe.category}
                                                  </span>
                                                </div>
                                                <div className="text-[11px] text-stone-400 space-y-1 bg-stone-900 p-2.5 rounded-xl border border-stone-800 mb-2">
                                                  <div>Себест/кг: <strong className="text-stone-200">{Math.round(cost)} ₽</strong></div>
                                                  <div>Цена/кг: <strong className="text-amber-400">{recipe.sellingPrice} ₽</strong></div>
                                                  <div>Фудкост: <strong className={fc > 32 ? 'text-red-400' : 'text-emerald-400'}>{fc}%</strong></div>
                                                </div>
                                                {renderFoodCostProgressBar(fc)}
                                              </td>
                                              <td className="p-0 border-r border-stone-800">
                                                <table className="w-full text-xs">
                                                  <tbody className="divide-y divide-stone-800/60">
                                                    {recipe.items.map((it, idx) => (
                                                      <tr key={idx} className="hover:bg-stone-800/20">
                                                        <td className="p-3.5 text-stone-200 font-medium">{getRecipeItemName(it)}</td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </td>
                                              <td className="p-0 border-r border-stone-800">
                                                <table className="w-full text-xs">
                                                  <tbody className="divide-y divide-stone-800/60">
                                                    {recipe.items.map((it, idx) => (
                                                      <tr key={idx} className="hover:bg-stone-800/20">
                                                        <td className="p-3.5 text-stone-300 font-mono">
                                                          <span className="text-amber-400 font-semibold">{formatWeightNumber(getRecipeItemQty(it))}</span> {getRecipeItemUnit(it)}
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </td>
                                              <td className="p-4 text-center align-middle">
                                                <div className="flex flex-col gap-2 items-center justify-center">
                                                  <button
                                                    onClick={() => {
                                                      setSelectedRecipe(recipe);
                                                      setDesiredTotalYield(1);
                                                      setIsEditingRecipeItems(false);
                                                      setEditableRecipeItems(toEditableItems(recipe.items));
                                                    }}
                                                    className="w-full bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl text-xs font-semibold transition text-center shadow-sm"
                                                  >
                                                    Открыть ТТК
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
                                      {recipe.imageUrl ? (
                                        <div className="h-48 w-full overflow-hidden relative bg-stone-950">
                                          <img src={recipe.imageUrl} alt={recipe.name} className="w-full h-full object-cover" />
                                          <span className="absolute top-3 left-3 text-[11px] font-semibold px-2.5 py-1 bg-stone-950/80 backdrop-blur-md text-amber-400 rounded-full border border-amber-500/20">
                                            {recipe.category}
                                          </span>
                                        </div>
                                      ) : (
                                        <div className="p-5 pb-0">
                                          <span className="text-[11px] font-semibold px-2.5 py-1 bg-amber-500/10 text-amber-400 rounded-full border border-amber-500/20">
                                            {recipe.category}
                                          </span>
                                        </div>
                                      )}

                                      <div className="p-5">
                                        <h3 className="font-bold text-white text-base mb-2">{recipe.name}</h3>
                                        <div className="text-xs text-stone-400 space-y-1 mb-4">
                                          <div>База ТТК: <strong className="text-amber-400">на 1 кг готовой продукции</strong></div>
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
                                              onClick={() => { 
                                                setSelectedRecipe(recipe); 
                                                setDesiredTotalYield(1); 
                                                setIsEditingRecipeItems(false);
                                                setEditableRecipeItems(toEditableItems(recipe.items));
                                              }}
                                              className="flex-1 bg-stone-800 hover:bg-stone-700 text-stone-200 py-2 rounded-xl text-xs font-semibold transition text-center"
                                            >
                                              Открыть ТТК
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
              Загрузите фото страницы рецепта из кулинарной книги, скриншот меню или снимок блюда. ИИ (Gemini Vision) распознает название, категорию, выход и технологию приготовления (с расчетом на 1 кг).
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

      {/* RECIPE DETAIL / TTK MODAL WITH 1 KG BASIS & RECALCULATION */}
      {selectedRecipe && (() => {
        const baseYield = selectedRecipe.yieldQty || 1; // 1 kg
        const scaleMult = desiredTotalYield > 0 ? desiredTotalYield / baseYield : 1;

        const costPerKg = calculateRecipeCost(selectedRecipe); // стоимость на 1 кг
        const fc = getRecipeFoodCostPercent(selectedRecipe);
        const scaledCost = costPerKg * scaleMult;
        const scaledPrice = selectedRecipe.sellingPrice * scaleMult;

        return (
          <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
              <div className="p-5 bg-stone-950 border-b border-stone-800 flex justify-between items-center">
                <div>
                  <span className="text-[11px] px-2.5 py-0.5 bg-amber-500/20 text-amber-400 rounded-full font-semibold">
                    {selectedRecipe.category}
                  </span>
                  <h3 className="text-lg font-bold text-white mt-1">{selectedRecipe.name}</h3>
                </div>
                <button 
                  onClick={() => setSelectedRecipe(null)}
                  className="text-stone-400 hover:text-white p-1.5 rounded-lg bg-stone-800"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs sm:text-sm">
                
                {/* Recipe Image & Generation Button */}
                <div className="bg-stone-950 p-4 rounded-2xl border border-stone-800 flex flex-col sm:flex-row items-center gap-4">
                  {selectedRecipe.imageUrl ? (
                    <div className="w-full sm:w-40 h-32 rounded-xl overflow-hidden bg-stone-900 flex-shrink-0 relative">
                      <img src={selectedRecipe.imageUrl} alt={selectedRecipe.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <div className="w-full sm:w-40 h-32 rounded-xl bg-stone-900 border border-stone-800 flex flex-col items-center justify-center text-stone-500 flex-shrink-0">
                      <ImageIcon className="w-8 h-8 mb-1 opacity-50" />
                      <span className="text-[10px]">Нет фото</span>
                    </div>
                  )}

                  <div className="flex-1 space-y-2 text-center sm:text-left">
                    <h4 className="font-semibold text-white">Визуализация ТТК (Фото блюда)</h4>
                    <p className="text-stone-400 text-xs">
                      Создайте профессиональное фото готового блюда с помощью встроенного инструмента генерации изображений.
                    </p>
                    <button
                      onClick={() => handleGenerateRecipePhoto(selectedRecipe)}
                      disabled={isGeneratingImage}
                      className="bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-stone-950 font-semibold px-4 py-2 rounded-xl text-xs transition inline-flex items-center gap-2 shadow-md shadow-amber-500/20"
                    >
                      {isGeneratingImage ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Генерация фото...</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4" />
                          <span>Сгенерировать фото блюда</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Desired Total Yield Recalculation Input (Basis 1 kg) */}
                <div className="bg-stone-950 p-4 rounded-xl border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white flex items-center gap-1.5">
                      <Calculator className="w-4 h-4 text-amber-500" />
                      <span>Пересчет граммовок (База ТТК: на 1 кг)</span>
                    </div>
                    <div className="text-stone-400 text-xs mt-0.5">Ниже указаны граммовки на 1 кг. Введите нужный общий вес готовой партии:</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={desiredTotalYield}
                      onChange={e => setDesiredTotalYield(parseFloat(e.target.value) || 0)}
                      className="w-28 bg-stone-900 border border-stone-700 text-amber-400 font-bold rounded-xl px-3 py-2 text-sm text-center outline-none focus:border-amber-500"
                    />
                    <span className="text-stone-300 font-semibold text-xs">кг</span>
                  </div>
                </div>

                {/* Financial Summary */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-stone-950 p-3 rounded-xl border border-stone-800 text-center">
                    <div className="text-[10px] text-stone-400 uppercase">Себестоимость партии</div>
                    <div className="text-base font-bold text-stone-100">{Math.round(scaledCost)} ₽</div>
                  </div>
                  <div className="bg-stone-950 p-3 rounded-xl border border-stone-800 text-center">
                    <div className="text-[10px] text-stone-400 uppercase">Цена продажи партии</div>
                    <div className="text-base font-bold text-amber-400">{Math.round(scaledPrice)} ₽</div>
                  </div>
                  <div className="bg-stone-950 p-3 rounded-xl border border-stone-800 text-center">
                    <div className="text-[10px] text-stone-400 uppercase">Фудкост / Маржа</div>
                    <div className={`text-base font-bold ${fc > 32 ? (fc > 38 ? 'text-red-400' : 'text-amber-400') : 'text-emerald-400'}`}>
                      {fc}% ({Math.round(scaledPrice - scaledCost)} ₽)
                    </div>
                  </div>
                </div>

                {renderFoodCostProgressBar(fc)}

                {/* Ingredients Table with Editable Rows */}
                <div>
                  <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
                    <h4 className="font-semibold text-white">
                      {isEditingRecipeItems 
                        ? 'Редактирование строк ТТК (база на 1 кг):' 
                        : `Раскладка продуктов (на ${desiredTotalYield} кг готовой продукции):`}
                    </h4>
                    <button
                      onClick={() => {
                        if (isEditingRecipeItems) {
                          const cleanedItems: RecipeItem[] = editableRecipeItems
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
                          const updatedRecipes = recipes.map(r => r.id === selectedRecipe.id ? { ...r, items: cleanedItems } : r);
                          setRecipes(updatedRecipes);
                          setSelectedRecipe({ ...selectedRecipe, items: cleanedItems });
                          setIsEditingRecipeItems(false);
                        } else {
                          setEditableRecipeItems(toEditableItems(selectedRecipe.items));
                          setIsEditingRecipeItems(true);
                        }
                      }}
                      className="bg-stone-800 hover:bg-stone-700 text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-xl font-semibold text-xs transition flex items-center gap-1.5"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>{isEditingRecipeItems ? 'Сохранить ТТК' : 'Редактировать строки'}</span>
                    </button>
                  </div>

                  {isEditingRecipeItems ? (
                    <div className="space-y-3 bg-stone-950 p-3 sm:p-4 rounded-xl border border-stone-800">
                      <p className="text-[11px] text-stone-400">
                        Введите продукт вручную (или выберите подсказку со склада), укажите вес на 1 кг готовой продукции и единицу измерения (кг, г, шт, л, мл).
                      </p>
                      <datalist id="ttk-ingredients-datalist">
                        {ingredients.map(ing => (
                          <option key={ing.id} value={ing.name} />
                        ))}
                      </datalist>
                      <div className="space-y-2.5">
                        {editableRecipeItems.map((item, idx) => (
                          <div key={idx} className="flex flex-col sm:flex-row sm:items-end gap-2 bg-stone-900 p-2.5 rounded-xl border border-stone-800">
                            <div className="flex-1 min-w-0">
                              <label className="block text-[10px] text-stone-400 mb-1">Продукт</label>
                              <input
                                type="text"
                                list="ttk-ingredients-datalist"
                                value={item.name}
                                placeholder="Например: Колбаса докторская"
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
                                }}
                                className="w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg px-2.5 py-2 text-stone-100 text-xs outline-none"
                              />
                            </div>
                            <div className="flex items-end gap-2 shrink-0">
                              <div className="flex-1 sm:w-24">
                                <label className="block text-[10px] text-stone-400 mb-1">Вес</label>
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="0"
                                  value={item.quantityInput}
                                  onChange={e => {
                                    const raw = e.target.value;
                                    const parsed = parseFloat(raw.replace(',', '.')) || 0;
                                    setEditableRecipeItems(prev =>
                                      prev.map((it, i) =>
                                        i === idx ? { ...it, quantityInput: raw, quantity: parsed } : it
                                      )
                                    );
                                  }}
                                  className="w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg px-2 py-2 text-xs text-stone-100 text-center outline-none"
                                />
                              </div>
                              <div className="w-20">
                                <label className="block text-[10px] text-stone-400 mb-1">Ед. изм.</label>
                                <select
                                  value={item.unit}
                                  onChange={e => {
                                    const unit = e.target.value as RecipeItemUnit;
                                    setEditableRecipeItems(prev =>
                                      prev.map((it, i) => (i === idx ? { ...it, unit } : it))
                                    );
                                  }}
                                  className="w-full bg-stone-950 border border-stone-700 focus:border-amber-500 rounded-lg px-2 py-2 text-xs text-stone-100 outline-none"
                                >
                                  {RECIPE_ITEM_UNITS.map(u => (
                                    <option key={u} value={u}>{u}</option>
                                  ))}
                                </select>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditableRecipeItems(prev => prev.filter((_, i) => i !== idx));
                                }}
                                className="text-stone-500 hover:text-red-400 p-2 rounded-lg hover:bg-stone-800 transition shrink-0"
                                title="Удалить строку"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setEditableRecipeItems(prev => [
                            ...prev,
                            { name: '', quantity: 0, quantityInput: '', unit: 'г' }
                          ]);
                        }}
                        className="w-full bg-stone-900 hover:bg-stone-800 text-amber-400 border border-stone-700/80 py-2.5 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Добавить продукт в ТТК</span>
                      </button>
                    </div>
                  ) : (
                    <div className="border border-stone-800 rounded-xl overflow-hidden">
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
                    </div>
                  )}
                </div>

                {/* Steps */}
                <div>
                  <h4 className="font-semibold text-white mb-2">Технология приготовления:</h4>
                  <ol className="space-y-2 text-stone-300 list-decimal list-inside bg-stone-950 p-4 rounded-xl border border-stone-800">
                    {selectedRecipe.steps.map((step, idx) => (
                      <li key={idx} className="leading-relaxed">{step}</li>
                    ))}
                  </ol>
                </div>

              </div>

              <div className="p-4 bg-stone-950 border-t border-stone-800 flex flex-wrap items-center justify-between gap-2">
                <button
                  onClick={() => setRecipeToDelete(selectedRecipe)}
                  className="bg-red-950/50 hover:bg-red-950/80 text-red-400 border border-red-900/50 px-3.5 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Удалить ТТК</span>
                </button>
                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={() => window.print()}
                    className="bg-stone-800 hover:bg-stone-700 text-stone-200 px-4 py-2 rounded-xl font-semibold text-xs transition flex items-center gap-2"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Печать ТТК</span>
                  </button>
                  <button
                    onClick={() => setSelectedRecipe(null)}
                    className="bg-amber-500 hover:bg-amber-400 text-stone-950 px-5 py-2 rounded-xl font-semibold text-xs transition"
                  >
                    Закрыть
                  </button>
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

      {/* NEW RECIPE MODAL */}
      {isNewRecipeModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 border border-stone-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Создание ТТК (Граммовки на 1 кг)</h3>
            <form onSubmit={e => {
              e.preventDefault();
              const form = e.currentTarget;
              const formData = new FormData(form);
              const newRec: Recipe = {
                id: `rec-${Date.now()}`,
                name: formData.get('name') as string,
                category: formData.get('category') as any,
                yieldQty: 1, // расчет строго на 1 кг
                yieldUnit: 'кг',
                prepTimeMin: parseInt(formData.get('prepTimeMin') as string) || 30,
                sellingPrice: parseFloat(formData.get('sellingPrice') as string) || 700,
                shelfLifeHours: parseInt(formData.get('shelfLifeHours') as string) || 48,
                imageUrl: '/src/assets/images/pelmeni_dumplings_1794987230090.jpg',
                items: [
                  {
                    ingredientId: ingredients[0]?.id,
                    name: ingredients[0]?.name || 'Мука пшеничная в/с',
                    quantity: 0.45,
                    unit: ingredients[0]?.unit || 'кг',
                  },
                  {
                    ingredientId: ingredients[1]?.id,
                    name: ingredients[1]?.name || 'Масло сливочное 82.5%',
                    quantity: 0.2,
                    unit: ingredients[1]?.unit || 'кг',
                  }
                ],
                steps: [
                  '1. Подготовить все необходимые ингредиенты из расчета на 1 кг готовой продукции.',
                  '2. Произвести первичную и тепловую обработку согласно техпроцессу.',
                  '3. Оформить и охладить готовую продукцию до температуры хранения.'
                ]
              };
              setRecipes(prev => [newRec, ...prev]);
              setExpandedTtkCategories(prev => ({ ...prev, [newRec.category]: true }));
              setIsNewRecipeModalOpen(false);
            }} className="space-y-4 text-xs">
              <div>
                <label className="block text-stone-400 mb-1">Название блюда</label>
                <input required name="name" placeholder="Например: Борщ классический" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">Категория</label>
                  <select name="category" defaultValue={defaultNewRecipeCategory} className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none">
                    {RECIPE_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">Цена за 1 кг (₽)</label>
                  <input required name="sellingPrice" type="number" placeholder="700" className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-stone-400 mb-1">База расчета</label>
                  <input disabled value="1 кг готовой продукции" className="w-full bg-stone-900 border border-stone-800 rounded-xl px-3 py-2 text-amber-400 font-semibold" />
                </div>
                <div>
                  <label className="block text-stone-400 mb-1">Время (мин)</label>
                  <input required name="prepTimeMin" type="number" defaultValue={45} className="w-full bg-stone-950 border border-stone-700 rounded-xl px-3 py-2 text-stone-100 outline-none" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setIsNewRecipeModalOpen(false)} className="bg-stone-800 text-stone-300 px-4 py-2 rounded-xl">Отмена</button>
                <button type="submit" className="bg-amber-500 text-stone-950 font-semibold px-5 py-2 rounded-xl">Создать ТТК</button>
              </div>
            </form>
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
                    <option value="г">г</option>
                    <option value="л">л</option>
                    <option value="мл">мл</option>
                    <option value="шт">шт</option>
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
                    <option value="г">г</option>
                    <option value="л">л</option>
                    <option value="шт">шт</option>
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
                            if (pickerCategory) {
                              setDefaultNewRecipeCategory(pickerCategory);
                            }
                            setActiveMenuRowId(null);
                            setPickerCategory(null);
                            setActiveTab('recipes');
                            setIsNewRecipeModalOpen(true);
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
