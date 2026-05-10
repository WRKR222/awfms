// frontend/src/pages/store/StorePRPage.tsx
// Fixes GAP-02: Standalone Purchase Requests page so /store/purchase-requests
// resolves correctly (sidebar link was leading to 404).
import { PurchaseRequestsTab } from './PurchaseRequestsTab';

export default function StorePRPage() {
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-7xl mx-auto">
      <header>
        <h1 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">
          Purchase Requests
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Create and track purchase requests for stock below reorder level.
          Submitted requests are reviewed by the Accountant who generates an LPO.
        </p>
      </header>
      <PurchaseRequestsTab />
    </div>
  );
}
