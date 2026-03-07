import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth.store';
import { flockApi } from '../../lib/api/flock.api';
import {
  Feather, Wheat, Egg, Thermometer, Scale, CheckCircle,
  Clock, AlertTriangle, ChevronRight, WifiOff,
} from 'lucide-react';
import { useOfflineStore } from '../../stores/offline.store';

type TaskStatus = 'done' | 'pending' | 'returned' | 'todo';

interface DailyTask {
  id: string;
  label: string;
  description: string;
  icon: typeof Feather;
  route: string;
  status: TaskStatus;
  correctionNote?: string;
}

export default function AttendantDashboard() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isOnline = useOfflineStore((s) => s.isOnline);
  const pendingCount = useOfflineStore((s) => s.getPendingCount());

  const today = new Date().toLocaleDateString('en-KE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  // In a real implementation, these would come from querying today's entries
  // Simplified for demo — status derived from API in production
  const tasks: DailyTask[] = [
    {
      id: 'morning-eggs',
      label: 'Morning Egg Collection',
      description: 'Log AM egg count and grades',
      icon: Egg,
      route: '/entry/eggs?time=AM',
      status: 'todo',
    },
    {
      id: 'morning-feed',
      label: 'Morning Feed',
      description: 'Log feed dispensed and wastage',
      icon: Wheat,
      route: '/entry/feed?time=MORNING',
      status: 'todo',
    },
    {
      id: 'mortality',
      label: 'Bird Count',
      description: 'Daily opening/closing count',
      icon: Feather,
      route: '/entry/mortality',
      status: 'done', // Example: already submitted
    },
    {
      id: 'temperature',
      label: 'Temperature & Humidity',
      description: 'Record house temperature',
      icon: Thermometer,
      route: '/entry/temperature',
      status: 'todo',
    },
    {
      id: 'afternoon-eggs',
      label: 'Afternoon Egg Collection',
      description: 'Log PM egg count and grades',
      icon: Egg,
      route: '/entry/eggs?time=PM',
      status: 'returned', // Example: returned for correction
      correctionNote: 'Total grades do not add up to total eggs collected. Please recount.',
    },
    {
      id: 'afternoon-feed',
      label: 'Afternoon Feed',
      description: 'Log afternoon feed dispensed',
      icon: Wheat,
      route: '/entry/feed?time=AFTERNOON',
      status: 'todo',
    },
    {
      id: 'weight',
      label: 'Weekly Weight Sample',
      description: 'Sample 5 birds and record weights',
      icon: Scale,
      route: '/entry/weight',
      status: 'todo',
    },
  ];

  const returnedTasks = tasks.filter((t) => t.status === 'returned');
  const doneTasks = tasks.filter((t) => t.status === 'done' || t.status === 'pending');
  const remainingTasks = tasks.filter((t) => t.status === 'todo');

  return (
    <div className="max-w-lg mx-auto p-4 pb-24">
      {/* Greeting */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">
          Good morning, {user?.username.split('.')[0].charAt(0).toUpperCase() + user?.username.split('.')[0].slice(1)} 👋
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">{today}</p>
      </div>

      {/* Offline banner */}
      {!isOnline && (
        <div className="mb-4 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <WifiOff size={20} className="text-amber-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-amber-800">You're offline</p>
            <p className="text-xs text-amber-600">
              Entries will save locally and sync when you reconnect.
              {pendingCount > 0 && ` ${pendingCount} entry waiting to sync.`}
            </p>
          </div>
        </div>
      )}

      {/* Correction alerts — MOST PROMINENT */}
      {returnedTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
            <AlertTriangle size={16} /> Needs correction ({returnedTasks.length})
          </h2>
          <div className="space-y-2">
            {returnedTasks.map((task) => (
              <button
                key={task.id}
                onClick={() => navigate(task.route)}
                className="w-full text-left bg-red-50 border border-red-200 rounded-2xl p-4 flex items-start justify-between gap-3 hover:bg-red-100 active:scale-[0.98] transition-all"
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <task.icon size={20} className="text-red-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-red-800 text-sm">{task.label}</p>
                    <p className="text-xs text-red-600 mt-0.5 line-clamp-2">{task.correctionNote}</p>
                  </div>
                </div>
                <ChevronRight size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Today's tasks */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Today's tasks</h2>
          <span className="text-xs text-gray-400">
            {doneTasks.length}/{tasks.length} done
          </span>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-gray-100 rounded-full mb-4 overflow-hidden">
          <div
            className="h-full bg-green-500 rounded-full transition-all duration-500"
            style={{ width: `${(doneTasks.length / tasks.length) * 100}%` }}
          />
        </div>

        <div className="space-y-2">
          {remainingTasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => navigate(task.route)} />
          ))}
          {doneTasks.map((task) => (
            <TaskCard key={task.id} task={task} onClick={() => {}} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task, onClick }: { task: DailyTask; onClick: () => void }) {
  const statusConfig = {
    done:    { bg: 'bg-green-50 border-green-100',  icon: <CheckCircle size={20} className="text-green-500" />, text: 'text-gray-400' },
    pending: { bg: 'bg-amber-50 border-amber-100',  icon: <Clock size={20} className="text-amber-500 animate-pulse" />, text: 'text-gray-600' },
    returned:{ bg: 'bg-red-50 border-red-200',      icon: <AlertTriangle size={20} className="text-red-500" />, text: 'text-red-700' },
    todo:    { bg: 'bg-white border-gray-200',       icon: <div className="w-5 h-5 border-2 border-gray-300 rounded-full" />, text: 'text-gray-900' },
  };

  const cfg = statusConfig[task.status];
  const isDone = task.status === 'done';

  return (
    <button
      onClick={onClick}
      disabled={isDone}
      className={`w-full text-left rounded-2xl border p-4 flex items-center justify-between gap-3 transition-all ${cfg.bg}
        ${isDone ? 'opacity-60 cursor-default' : 'hover:shadow-sm active:scale-[0.98]'}`}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0
          ${isDone ? 'bg-green-100' : 'bg-white shadow-sm'}`}>
          <task.icon size={20} className={isDone ? 'text-green-600' : 'text-green-700'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`font-medium text-sm ${cfg.text} ${isDone ? 'line-through' : ''}`}>
            {task.label}
          </p>
          <p className="text-xs text-gray-400 mt-0.5 truncate">{task.description}</p>
        </div>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {cfg.icon}
        {!isDone && <ChevronRight size={16} className="text-gray-300" />}
      </div>
    </button>
  );
}
