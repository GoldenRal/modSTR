
import { User, Project, Scenario } from './types';

// MOCK_USER is removed as authentication is now handled by Supabase
// export const MOCK_USER: User = {
//   id: 'user_123',
//   name: 'Advocate Pravin Sangvikar',
//   email: 'pravin.s@example.com',
//   firmName: 'Sangvikar & Associates',
// };

export const SCENARIOS: Record<Scenario, { name: string; description: string }> = {
  CLEAR_FREEHOLD_PLOT: { name: 'Clear Freehold Plot', description: 'A standard, clear title property with no major complications.' },
  FLAT_IN_SOCIETY: { name: 'Flat in a Society', description: 'An apartment within a registered housing society.' },
  AGRICULTURAL_LAND: { name: 'Agricultural Land', description: 'Land designated for agricultural use, potentially requiring NA conversion.' },
  NA_PLOT: { name: 'NA Plot', description: 'Non-agricultural land, typically with a Collector Order.' },
  MORTGAGED_PROPERTY: { name: 'Mortgaged Property', description: 'The property currently has an active loan or mortgage against it.' },
  COURT_CASE_LITIGATION: { name: 'Court Case / Litigation', description: 'The property is involved in an ongoing legal dispute.' },
  UNDER_CONSTRUCTION: { name: 'Under Construction', description: 'The property is being developed by a builder and is not yet complete.' },
  INDUSTRIAL_PLOT: { name: 'Industrial Plot', description: 'A plot designated for industrial use, often with lease terms (e.g., MIDC).' },
  INHERITED_PROPERTY: { name: 'Inherited Property', description: 'Property acquired through succession or inheritance.' },
  JOINT_OWNERSHIP: { name: 'Joint Ownership', description: 'Property owned by multiple co-owners.' },
  REDEVELOPMENT_PROPERTY: { name: 'Redevelopment Property', description: 'An old society/building being redeveloped by a builder.' },
  UNKNOWN: { name: 'Unknown', description: 'The scenario could not be determined from the provided documents.' },
};

export const SCENARIO_BASED_DOCUMENTS: Record<Scenario, string[]> = {
  CLEAR_FREEHOLD_PLOT: ['Sale Deed', 'Mutation Entry', '7/12 Extract or Property Card', 'Encumbrance Certificate (30 years)', 'Property Tax Receipt'],
  FLAT_IN_SOCIETY: ['Sale Deed', 'Society Share Certificate', 'Society NOC for sale/mortgage', 'Building Plan Approval', 'Occupancy Certificate', 'Latest Maintenance Bill', 'Encumbrance Certificate'],
  AGRICULTURAL_LAND: ['7/12 Extract', 'Mutation Entry', 'Sale Deed', 'Encumbrance Certificate', 'Farmer Certificate'],
  NA_PLOT: ['NA Order', 'Sale Deed', 'Mutation Entry', 'Approved Layout Plan', 'Property Tax Receipt', 'Encumbrance Certificate'],
  MORTGAGED_PROPERTY: ['Original Sale Deed', 'Mortgage Deed / MODT', 'Deed of Release / Bank NOC', 'Latest Loan Statement', 'Encumbrance Certificate', 'CERSAI Report'],
  COURT_CASE_LITIGATION: ['Sale Deed', 'Plaint/Petition Copies', 'Court Orders/Stay Orders', 'Encumbrance Certificate showing Lis Pendens'],
  UNDER_CONSTRUCTION: ['Agreement for Sale', 'Builder Title Documents (for land)', 'RERA Registration Certificate', 'Approved Plans', 'Commencement Certificate', 'NA Order for land'],
  INDUSTRIAL_PLOT: ['Lease Deed', 'MIDC/GIDC Allotment Letter', 'Possession Receipt', 'No Dues Certificate from Authority', 'Approval for Transfer'],
  INHERITED_PROPERTY: ['Parent Document (e.g., Sale Deed)', 'Death Certificate of previous owner', 'Will / Probate or Succession Certificate', 'Legal Heir Certificate', 'Mutation Entry in heirs\' names'],
  JOINT_OWNERSHIP: ['Sale Deed', 'Partition Deed (if any)', 'Agreement between owners', 'Encumbrance Certificate'],
  REDEVELOPMENT_PROPERTY: ['Original Ownership Deeds', 'Registered Redevelopment Agreement', 'Members\' Consent Letters', 'Sanctioned Redevelopment Plans', 'RERA Registration Details'],
  UNKNOWN: ['Sale Deed', 'Mutation Entry', 'Property Tax Receipt', 'Encumbrance Certificate'], // A safe default
};

export const REPORT_FORMATS = [
  "Advocate Standard Format",
  "Bajaj Finance Format",
  "JM Financial Format",
  "Mahindra Rural Format",
  "HDFC Format",
  "LSR Format"
];


// Initial projects are now empty. The app will load from localStorage.
export const MOCK_PROJECTS: Project[] = [];
