/* Stable keys shared by the Material Requests importer and Projects view. */

export function projectColorKey(value) {
  return String(value || '').normalize('NFKD').replace(/[’']/g, '').replace(/&/g, ' AND ')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function projectWorkOrderKey(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
