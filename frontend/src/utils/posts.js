/**
 * Phase 5 helpers shared by the Global Feed, the vendor storefront and the post composer.
 */
import { Gem, Lightbulb, Tags } from 'lucide-react';

export const POST_TYPES = ['PREMIUM_CATALOG', 'INSPIRATION', 'CLEARANCE'];

export const POST_TYPE_META = {
  PREMIUM_CATALOG: { label: 'Premium Catalog', short: 'Premium', tone: 'violet', icon: Gem, blurb: 'Ready-to-order styles with a full size chart and fabric specs.' },
  INSPIRATION: { label: 'Inspiration', short: 'Inspiration', tone: 'blue', icon: Lightbulb, blurb: 'Past work and ideas to spark your next design.' },
  CLEARANCE: { label: 'Clearance Stock', short: 'Clearance', tone: 'amber', icon: Tags, blurb: 'Ready stock at a guide price, while it lasts.' },
};

/** Configurator link with optional Direct-RFQ vendor and prefilled garment details. */
export function configuratorLink({ vendorId, garmentType, fabric, gsm, quantity, postId } = {}) {
  const params = new URLSearchParams();
  if (vendorId) params.set('vendorId', vendorId);
  if (garmentType) params.set('garment', garmentType);
  if (fabric) params.set('fabric', fabric);
  if (gsm) params.set('gsm', String(gsm));
  if (quantity) params.set('qty', String(quantity));
  if (postId) params.set('post', postId);
  const query = params.toString();
  return `/buyer/rfqs/new${query ? `?${query}` : ''}`;
}

/**
 * The call to action changes with the post type. Every path leads into the configurator, so any deal
 * still becomes an RFQ that is paid through escrow and released with the O2O PIN.
 */
export function postCta(post, role) {
  const vendorId = post.vendor?._id;
  if (role !== 'buyer') return { label: 'View storefront', to: `/vendors/${vendorId}`, kind: 'storefront' };
  switch (post.postType) {
    case 'PREMIUM_CATALOG':
      return {
        label: 'Get a direct quote',
        to: configuratorLink({ vendorId, garmentType: post.garmentType, fabric: post.fabricSpecs?.fabric, gsm: post.fabricSpecs?.gsm, postId: post._id }),
        kind: 'direct',
      };
    case 'CLEARANCE':
      return {
        label: 'Request this stock',
        to: configuratorLink({ vendorId, garmentType: post.garmentType, quantity: Math.min(post.clearance?.availableQuantity || 0, 1000) || undefined, postId: post._id }),
        kind: 'direct',
      };
    default:
      return { label: 'Design something similar', to: configuratorLink({ garmentType: post.garmentType, postId: post._id }), kind: 'open' };
  }
}
