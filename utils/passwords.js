/**
 * Default password for staff-created accounts (admin, employee, client, superadmin).
 * Unique per username so there is no shared secret across accounts.
 */
function buildDefaultPassword(username) {
  if (!username) {
    throw new Error('username is required to build default password');
  }
  return `Trenor@${username}`;
}

module.exports = {
  buildDefaultPassword,
};
