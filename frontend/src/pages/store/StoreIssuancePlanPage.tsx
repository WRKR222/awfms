// frontend/src/pages/store/StoreIssuancePlanPage.tsx
// Standalone page so /store/issuance-plans resolves directly from the sidebar,
// separate from the Inventory tab group (mirrors the old GAP-02 PR page pattern).
import { IssuancePlanTab } from './IssuancePlanTab';

export default function StoreIssuancePlanPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">
          Issuance Plans
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Weekly plans are drafted and submitted on Saturday for the following Mon–Sun cycle.
          Emergency plans can be raised mid-week for urgent needs.
          Stock can only be issued against an approved plan.
        </p>
      </header>
      <IssuancePlanTab />
    </div>
  );
}
