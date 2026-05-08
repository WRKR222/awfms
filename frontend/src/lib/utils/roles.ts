export const ROLE_DISPLAY_NAMES: Record<string, string> = {
  ATTENDANT:  'Lead Attendant',
  MANAGER:    'Production Manager',
  ACCOUNTANT: 'Accountant',
  OWNER:      'Director',
  SALES:      'Sales Person',
  STORE:      'Store',
  SECURITY1:  'Security — Main Gate',
  SECURITY2:  'Security — Farm Gate',
};

export function getRoleDisplayName(role: string): string {
  return ROLE_DISPLAY_NAMES[role] ?? role;
}