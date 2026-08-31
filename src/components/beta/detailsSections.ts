// The registry of the details page's sections — the single source the Details ▾
// menu and the page both read, so they can't drift. Plain names, grouped the
// way a person looks for them (BETA-MAP.md §2). `conditional` sections appear
// only when the plan uses them (RDSP / FHSA / Home Equity).

export interface DetailsSection {
  id: string;
  label: string;
  group: string;
  conditional?: 'rdsp' | 'fhsa' | 'home';
}

export const DETAILS_GROUPS = ['People', 'Accounts', 'Income', 'Spending', 'Property'] as const;

export const DETAILS_SECTIONS: DetailsSection[] = [
  { id: 'profile', label: 'Personal Profile', group: 'People' },
  { id: 'spouse', label: 'Spouse', group: 'People' },
  { id: 'accounts', label: 'Account Balances', group: 'Accounts' },
  { id: 'contributions', label: 'Contribution Rates', group: 'Accounts' },
  { id: 'rdsp', label: 'RDSP (Disability Savings)', group: 'Accounts', conditional: 'rdsp' },
  { id: 'fhsa', label: 'FHSA (First Home Savings)', group: 'Accounts', conditional: 'fhsa' },
  { id: 'income', label: 'Income', group: 'Income' },
  { id: 'benefits', label: 'Government Benefits', group: 'Income' },
  { id: 'events', label: 'Cash Events', group: 'Income' },
  { id: 'spending', label: 'Spending Phases', group: 'Spending' },
  { id: 'withdrawal', label: 'Withdrawal Strategy', group: 'Spending' },
  { id: 'debts', label: 'Debts', group: 'Spending' },
  { id: 'home', label: 'Home Equity', group: 'Property', conditional: 'home' },
];
