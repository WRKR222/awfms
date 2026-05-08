import { useState, ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Menu, X, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../lib/utils';
import { FlockIcon } from '../ui/icons';
import type { SidebarLinkItem } from '../ui/sidebar';

interface MobileSidebarProps {
  links: SidebarLinkItem[];
  user?: { fullName?: string };
  roleLabel: string;
  onLogout: () => void;
}

/**
 * Retractable side navigation drawer for mobile. Replaces the bottom-tab bar
 * across all role layouts so that every nav link fits regardless of count.
 */
export function MobileSidebar({ links, user, roleLabel, onLogout }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation menu"
        className="md:hidden inline-flex items-center justify-center p-1.5 -ml-1 rounded-md text-white hover:bg-white/10"
      >
        <Menu className="w-6 h-6" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="mobile-sidebar-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={close}
              className="md:hidden fixed inset-0 bg-black/50 z-40"
            />
            <motion.aside
              key="mobile-sidebar-panel"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="md:hidden fixed inset-y-0 left-0 w-72 max-w-[85%] bg-white dark:bg-dark-surface z-50 flex flex-col shadow-2xl"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-dark-border">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-brand-green flex items-center justify-center flex-shrink-0">
                    <FlockIcon className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-800 dark:text-gray-100 truncate">Anza Whole Foods</p>
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{roleLabel}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={close}
                  aria-label="Close navigation menu"
                  className="p-1 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-dark-card"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-1">
                {links.map((link) => renderLink(link, close))}
              </nav>

              <div className="border-t border-gray-200 dark:border-dark-border p-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => { onLogout(); close(); }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Logout</span>
                </button>
                <div className="flex items-center gap-3 px-2 pt-2">
                  <div className="w-8 h-8 rounded-full bg-brand-green/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-bold text-brand-green">
                      {user?.fullName?.charAt(0) ?? '?'}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">{user?.fullName}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{roleLabel}</p>
                  </div>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function renderLink(link: SidebarLinkItem, close: () => void): ReactNode {
  if (link.onClick) {
    return (
      <button
        key={link.label}
        type="button"
        onClick={() => { link.onClick?.(); close(); }}
        className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-card text-left"
      >
        <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{link.icon}</span>
        <span className="truncate">{link.label}</span>
      </button>
    );
  }
  return (
    <NavLink
      key={link.to || link.label}
      to={link.to}
      end={link.end}
      onClick={close}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium',
          isActive
            ? 'bg-brand-green/10 dark:bg-brand-green/20 text-brand-green'
            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-dark-card'
        )
      }
    >
      <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">{link.icon}</span>
      <span className="truncate">{link.label}</span>
    </NavLink>
  );
}
