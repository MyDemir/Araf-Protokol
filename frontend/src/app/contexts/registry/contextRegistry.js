import { CONTEXT_LAYOUTS } from './contextLayouts';

export const contextRegistry = [
  {
    key: 'home',
    label: { TR: 'Ana Sayfa', EN: 'Home' },
    icon: '🏠',
    requiresAuth: false,
    layout: CONTEXT_LAYOUTS.FULL,
    order: 10,
  },
  {
    key: 'market',
    label: { TR: 'Pazar', EN: 'Market' },
    icon: '🛒',
    requiresAuth: false,
    layout: CONTEXT_LAYOUTS.MARKET,
    order: 20,
  },
  {
    key: 'operations',
    label: { TR: 'İşlem Takip Merkezi', EN: 'Operations Center' },
    icon: '⚙️',
    requiresAuth: true,
    layout: CONTEXT_LAYOUTS.OPERATIONS,
    order: 30,
  },
  {
    key: 'tradeRoom',
    label: { TR: 'İşlem Odası', EN: 'Trade Room' },
    icon: '💼',
    requiresAuth: true,
    layout: CONTEXT_LAYOUTS.TRADE_ROOM,
    order: 40,
  },
  {
    key: 'profile',
    label: { TR: 'Profil', EN: 'Profile' },
    icon: '👤',
    requiresAuth: true,
    layout: CONTEXT_LAYOUTS.PROFILE,
    order: 50,
  },
  {
    key: 'rewards',
    label: { TR: 'Ödüller', EN: 'Rewards' },
    icon: '🎁',
    requiresAuth: true,
    layout: CONTEXT_LAYOUTS.REWARDS,
    order: 60,
  },
  {
    key: 'help',
    label: { TR: 'Yardım', EN: 'Help' },
    icon: '❓',
    requiresAuth: false,
    layout: CONTEXT_LAYOUTS.HELP,
    order: 70,
  },
  {
    key: 'admin',
    label: { TR: 'Yönetim', EN: 'Admin' },
    icon: '🧭',
    requiresAuth: true,
    layout: CONTEXT_LAYOUTS.ADMIN,
    order: 80,
  },
];

export const contextRegistryByKey = Object.fromEntries(
  contextRegistry.map((entry) => [entry.key, entry])
);

export default contextRegistry;
