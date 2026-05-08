"use client";

import { cn } from '../../lib/utils';
import { NavLink } from 'react-router-dom';
import React, { useState, createContext, useContext } from 'react';
import { motion } from 'framer-motion';

// ── Types ──────────────────────────────────────────────────────────────────────
export interface SidebarLinkItem {
  label: string;
  to: string;
  icon: React.ReactNode;
  end?: boolean;
  onClick?: () => void;
}

interface SidebarContextProps {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  animate: boolean;
}

// ── Context ────────────────────────────────────────────────────────────────────
const SidebarContext = createContext<SidebarContextProps | undefined>(undefined);

export const useSidebar = () => {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within a SidebarProvider');
  return ctx;
};

export const SidebarProvider = ({
  children,
  open: openProp,
  setOpen: setOpenProp,
  animate = true,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => {
  const [openState, setOpenState] = useState(false);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = setOpenProp !== undefined ? setOpenProp : setOpenState;

  return (
    <SidebarContext.Provider value={{ open, setOpen, animate }}>
      {children}
    </SidebarContext.Provider>
  );
};

export const Sidebar = ({
  children,
  open,
  setOpen,
  animate,
}: {
  children: React.ReactNode;
  open?: boolean;
  setOpen?: React.Dispatch<React.SetStateAction<boolean>>;
  animate?: boolean;
}) => (
  <SidebarProvider open={open} setOpen={setOpen} animate={animate}>
    {children}
  </SidebarProvider>
);

// ── SidebarBody: desktop only ──────────────────────────────────────────────────
export const SidebarBody = ({
  className,
  children,
  ...props
}: React.ComponentProps<typeof motion.div>) => {
  const { open, setOpen, animate } = useSidebar();
  return (
    <motion.div
      className={cn(
        'h-full px-3 py-4 hidden md:flex md:flex-col',
        'bg-white dark:bg-dark-surface',
        'border-r border-gray-200 dark:border-dark-border',
        'flex-shrink-0 overflow-hidden',
        className
      )}
      animate={{ width: animate ? (open ? '220px' : '64px') : '220px' }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      {...props}
    >
      {children}
    </motion.div>
  );
};

// ── SidebarLink ────────────────────────────────────────────────────────────────
export const SidebarLink = ({
  link,
  className,
  accentColor = 'text-brand-green',
  accentBg = 'bg-brand-green/10 dark:bg-brand-green/20',
}: {
  link: SidebarLinkItem;
  className?: string;
  accentColor?: string;
  accentBg?: string;
}) => {
  const { open, animate } = useSidebar();

  const baseRow = cn(
    'flex items-center rounded-xl py-2.5 w-full transition-all group/sidebar',
    open ? 'gap-3 px-3' : 'justify-center px-0',
    className
  );

  if (link.onClick) {
    return (
      <button
        onClick={link.onClick}
        className={cn(
          baseRow,
          'text-gray-500 dark:text-gray-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600'
        )}
      >
        <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">{link.icon}</span>
        <motion.span
          animate={{
            display: animate ? (open ? 'inline-block' : 'none') : 'inline-block',
            opacity: animate ? (open ? 1 : 0) : 1,
          }}
          className="text-sm font-medium whitespace-pre"
        >
          {link.label}
        </motion.span>
      </button>
    );
  }

  return (
    <NavLink
      to={link.to}
      end={link.end}
      className={({ isActive }) =>
        cn(
          baseRow,
          isActive
            ? `${accentBg} ${accentColor}`
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-dark-card hover:text-gray-800 dark:hover:text-gray-200'
        )
      }
    >
      <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center">{link.icon}</span>
      <motion.span
        animate={{
          display: animate ? (open ? 'inline-block' : 'none') : 'inline-block',
          opacity: animate ? (open ? 1 : 0) : 1,
        }}
        className="text-sm font-medium whitespace-pre"
      >
        {link.label}
      </motion.span>
    </NavLink>
  );
};
