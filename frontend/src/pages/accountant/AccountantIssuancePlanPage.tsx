// src/pages/accountant/AccountantIssuancePlanPage.tsx
// Replaces AccountantLpoPage. Accountant reviews issuance plans submitted by
// Store, approves/rejects each line item individually, edits items if needed,
// and can download a PDF of whatever items end up approved. Reuses the shared
// IssuancePlanTab so the approval chain logic lives in one place.
import { IssuancePlanTab } from '../store/IssuancePlanTab';

export function AccountantIssuancePlanPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">
          Issuance Plans
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Review and approve each item on weekly and emergency issuance plans submitted by Store.
          Approval happens per item — once you approve an item, it moves to the Director for final
          sign-off (weekly items only on Saturdays); you can see exactly which items the Director
          later approves or rejects.
        </p>
      </div>

      <IssuancePlanTab />
    </div>
  );
}

export default AccountantIssuancePlanPage;
