// Index of per-type boilerplate templates.
// Each type lives in its own file under ./boilerplates/.

import hebergement from './boilerplates/hebergement';
import contract from './boilerplates/contract';
import cahier_des_charges from './boilerplates/cahier_des_charges';
import maintenance from './boilerplates/maintenance';
import autre from './boilerplates/autre';

export const TEMPLATE_BOILERPLATES: Record<string, string> = {
  hebergement,
  contract,
  cahier_des_charges,
  maintenance,
  autre,
};

/** Returns the boilerplate for a given template type, falling back to 'autre'. */
export function getBoilerplate(type: string): string {
  return TEMPLATE_BOILERPLATES[type] ?? TEMPLATE_BOILERPLATES['autre'];
}
