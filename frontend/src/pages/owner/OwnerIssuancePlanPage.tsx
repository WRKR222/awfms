// src/pages/owner/OwnerIssuancePlanPage.tsx
// Director/Owner — final approval step for issuance plans. Approval is per
// line item, so the Director can approve some items on a plan and reject
// others without affecting the rest. Weekly items can only be approved on
// Saturdays; emergency items can be approved any day. Reuses the shared
// IssuancePlanTab (ItemRow already enforces the Saturday gate and exposes
// per-item Approve/Reject for the OWNER role).
import { ClipboardList } from 'lucide-react';
import { IssuancePlanTab } from '../store/IssuancePlanTab';

export default function OwnerIssuancePlanPage() {
  return (
    <div className="p-4 md:p-8 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-brand-green" />
          Issuance Plan Approvals
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Final approval for each item on weekly and emergency issuance plans already approved by
          the Accountant. You can approve some items on a plan and reject others — each line is
          its own decision. Weekly items can only be approved on Saturdays; emergency items can be
          approved any day.
        </p>
      </div>

      <IssuancePlanTab />
    </div>
  );
}
