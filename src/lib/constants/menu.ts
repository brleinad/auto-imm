import type { MenuItem } from '../types';
import { Home, Settings, HelpCircle, Layers, Upload } from '../icons';
import { navigateTo } from '../stores/navigation';

export const MENU_ITEMS: MenuItem[] = [
  { icon: Home, label: 'Home', action: () => navigateTo('home') },
  { icon: Upload, label: 'Dashboard', action: () => navigateTo('dashboard') },
  { icon: Layers, label: 'Components', action: () => navigateTo('components') },
  { icon: Settings, label: 'Settings', action: () => navigateTo('settings') },
  { icon: HelpCircle, label: 'Help', action: () => navigateTo('help') },
];