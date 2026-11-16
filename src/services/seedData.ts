import { AppDatabaseState, FlavorCategory } from '../types';
import { DEFAULT_REFV_POS_SETTINGS } from './posSync';

export const REFV_BASE_FLAVORS: { name: string; category: FlavorCategory; image: string }[] = [
  { name: 'Holy Cow!', category: 'Original', image: '/images/holy-cow.png' },
  { name: 'Thai Tea', category: 'Original', image: '/images/thai-tea.png' },
  { name: "Pecan't Sleep", category: 'Premium', image: '/images/pecan-sleep.png' },
  { name: '70% Into Dark Side', category: 'Premium', image: '/images/dark-side.png' },
  { name: 'Weirdly Wonderful', category: 'Signature', image: '/images/weirdly-wonderful.png' },
  { name: 'Grapest of All Time', category: 'Premium', image: '/images/grapest.png' },
  { name: 'Nutting to Prove', category: 'Signature', image: '/images/nutting.png' },
  { name: 'Matcha Snob', category: 'Signature', image: '/images/matcha-snob.png' },
  {
    name: 'Blush & Cheese',
    category: 'Premium',
    image: 'https://lh3.googleusercontent.com/d/1o-iHQCuJdp6XlHfeqSJ2b__tEpzlKjVz=w600',
  },
];

export function createInitialSeedState(): AppDatabaseState {
  return {
    settings: { ...DEFAULT_REFV_POS_SETTINGS },
    packagingItems: [
      {
        id: 'pkg-cup',
        name: 'แก้วไอติม (Cup)',
        unit: 'ใบ',
        usagePerCup: 1,
        applyToType: 'all',
      },
      {
        id: 'pkg-spoon',
        name: 'ช้อนตักไอติม (Spoon)',
        unit: 'คัน',
        usagePerCup: 1,
        applyToType: 'all',
      },
    ],
    packagingLots: [],
    ingredients: [],
    ingredientLots: [],
    recipes: REFV_BASE_FLAVORS.map((f, idx) => ({
      id: `rec-${idx + 1}`,
      name: f.name,
      category: f.category,
      image: f.image,
      mode: 'per_cup',
      batchYieldCups: 1,
      halfScoopRatio: 0.5,
      ingredients: [],
    })),
    events: [],
  };
}
