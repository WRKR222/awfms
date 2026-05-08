import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { ShoppingCart, BookOpen, Users, FileCheck, ChevronRight } from 'lucide-react';
import dayjs from 'dayjs';

export default function SalesHome() {
  const navigate = useNavigate();
  const { user } = useAuthStore();

  const hour = dayjs().hour();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = user?.fullName?.split(' ')[0] ?? '';

  const tasks = [
    {
      label: 'Orders',
      sub: 'Create and manage egg sales orders',
      icon: ShoppingCart,
      color: 'bg-brand-green',
      route: '/sales/orders',
    },
    {
      label: 'Advance Bookings',
      sub: 'Manage pre-orders and reservations',
      icon: BookOpen,
      color: 'bg-brand-teal',
      route: '/sales/bookings',
    },
    {
      label: 'Clients',
      sub: 'View and manage customer records',
      icon: Users,
      color: 'bg-blue-500',
      route: '/sales/clients',
    },
    {
      label: 'Tally Verification',
      sub: 'Verify and confirm egg tally records',
      icon: FileCheck,
      color: 'bg-amber-500',
      route: '/sales/tally',
    },
  ];

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl mx-auto">

      {/* Greeting banner */}
      <div className="bg-brand-green text-white rounded-2xl p-4 md:p-6">
        <p className="text-sm opacity-75">TODAY · {dayjs().format('dddd, D MMMM YYYY').toUpperCase()}</p>
        <p className="text-xl md:text-2xl font-bold mt-1">{greeting}, {firstName}! 👋</p>
        <p className="text-sm opacity-75 mt-0.5">Sales Dashboard</p>
      </div>

      {/* Task cards */}
      <div>
        <p className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
          Today's Tasks
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {tasks.map(({ label, sub, icon: Icon, color, route }) => (
            <button
              key={route}
              onClick={() => navigate(route)}
              className="w-full bg-white dark:bg-dark-card rounded-2xl p-4 md:p-5 shadow-sm
                border border-gray-100 dark:border-dark-border
                flex items-center gap-4 text-left hover:shadow-md active:scale-[0.98]
                transition-all group"
            >
              <div className={`w-14 h-14 ${color} rounded-xl flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                <Icon className="w-7 h-7 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-gray-800 dark:text-gray-100 text-base">{label}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{sub}</p>
              </div>
              <ChevronRight className="w-5 h-5 text-gray-300 dark:text-gray-600 flex-shrink-0 group-hover:text-gray-500 group-hover:translate-x-0.5 transition-all" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
